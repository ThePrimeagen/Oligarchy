import { Context, Effect, Layer, Option, Result, Schema, Stream } from "effect";
import {
  type Headers,
  HttpBody,
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
  type HttpClientResponse,
  HttpMethod,
  type HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import * as ProxyClient from "../client/proxy-client.ts";
import * as Config from "../config.ts";
import * as Servers from "../db/servers.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Contract from "../shared/contract.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

// A server that has not answered its /stats in this long is skipped for the start that asked and
// is null in GET /servers; the request that probed it does not wait longer.
export const PROBE_TIMEOUT = "10 seconds";

// This reverse proxy fronts the servers that boot QEMU: the probe is their /stats, the placement
// their qemus. It registers a server as one and reads only those rows, whatever else is in the
// table.
const SERVER_TYPE: Servers.ServerType = "qemu";

// What a server's /start answers with a 200: the id it minted, a uuid as servers mint them and
// as the session_servers column stores them.
const StartAnswer = Schema.fromJsonString(
  Schema.toCodecJson(Schema.Struct({ id: Domain.SessionId })),
);
const decodeStartAnswer = Schema.decodeUnknownEffect(StartAnswer);
const StatsAnswer = Schema.fromJsonString(Schema.toCodecJson(Contract.Stats));
const decodeStatsAnswer = Schema.decodeUnknownEffect(StatsAnswer);

export type RouterService = {
  // Probes GET /stats on the url, then remembers it; a url already registered is probed again.
  readonly register: (url: string) => Effect.Effect<void, Errors.ServerFailed | Errors.Internal>;
  // Forgets the url; sessions routed to it stay routed until they end.
  readonly unregister: (url: string) => Effect.Effect<void, Errors.NotFound | Errors.Internal>;
  // Every registered server with its stats, null for one whose probe failed.
  readonly servers: Effect.Effect<Contract.Servers, Errors.Internal>;
  // Places the start on the answering server with the fewest qemus and routes the id it mints.
  readonly start: (
    request: HttpServerRequest.HttpServerRequest,
    agent: string,
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    Errors.NoServer | Errors.ServerFailed | Errors.Internal
  >;
  // Sends the request as it came to the server that started the session; the answer as it came.
  readonly forward: (
    request: HttpServerRequest.HttpServerRequest,
    id: string,
    agent?: string,
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    Errors.UnknownSession | Errors.ServerFailed | Errors.Internal
  >;
};

const internal = (cause: unknown, sessionId?: string, agentId?: string): Errors.Internal =>
  Errors.Internal.make(
    Object.assign(
      { cause },
      sessionId === undefined ? undefined : { sessionId },
      agentId === undefined ? undefined : { agentId },
    ),
  );

const serverFailed = (
  url: string,
  message: string,
  cause: unknown,
  who: Log.Attribution,
): Errors.ServerFailed =>
  Errors.ServerFailed.make(
    Object.assign(
      { message, url },
      cause === undefined ? undefined : { cause },
      who.location === undefined ? undefined : { sessionId: who.location },
      who.agentId === undefined ? undefined : { agentId: who.agentId },
    ),
  );

// node:http buries the reason (ECONNREFUSED, a reset) in the reason's cause; the error's own
// message is the request it was making.
const unreachable = (
  url: string,
  error: HttpClientError.HttpClientError,
  who: Log.Attribution,
): Errors.ServerFailed => {
  const cause = error.reason.cause ?? error;
  return serverFailed(url, `server ${url} unreachable: ${Render.errorDetail(cause)}`, cause, who);
};

// The contract names two response headers; the rest (date, connection, length) are this server's.
const forwardedHeaders = (headers: Headers.Headers): Headers.Input => ({
  "content-type": headers["content-type"],
  "x-image-url": headers["x-image-url"],
});

const make = Effect.gen(function* () {
  const store = yield* Servers.ServerStore;
  const log = yield* Log.Log;
  const http = yield* HttpClient.HttpClient;
  const { token } = yield* Config.ProxyConfig;

  // prependUrl joins with exactly one slash, so `http://host/` and `http://host` reach the same
  // /stats, as the generated client's baseUrl does.
  const probe = (
    url: string,
    who: Log.Attribution,
  ): Effect.Effect<Contract.Stats, Errors.ServerFailed> =>
    Effect.gen(function* () {
      const response = yield* http
        .execute(
          HttpClientRequest.get("/stats").pipe(
            HttpClientRequest.prependUrl(url),
            HttpClientRequest.bearerToken(token),
          ),
        )
        .pipe(Effect.mapError((error) => unreachable(url, error, who)));
      if (response.status !== 200) {
        // The status alone is the refusal; an unreadable body only loses its text.
        const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
        return yield* serverFailed(
          url,
          `server ${url} answered ${String(response.status)}: ${ProxyClient.apiError(text)}`,
          undefined,
          who,
        );
      }
      const text = yield* response.text.pipe(
        Effect.mapError((error) => unreachable(url, error, who)),
      );
      return yield* decodeStatsAnswer(text).pipe(
        Effect.mapError((cause) =>
          serverFailed(url, `server ${url} answered 200 without stats`, cause, who),
        ),
      );
    }).pipe(
      Effect.timeoutOrElse({
        duration: PROBE_TIMEOUT,
        orElse: () =>
          serverFailed(
            url,
            `server ${url} unreachable: no response within ${PROBE_TIMEOUT}`,
            undefined,
            who,
          ),
      }),
    );

  // The request as it came: the same method, path and query, the body text under
  // application/json when the method carries one, and the bearer the servers share.
  const send = (
    url: string,
    request: HttpServerRequest.HttpServerRequest,
  ): Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError> =>
    Effect.gen(function* () {
      // HttpApi decoded this body before the handler ran and the platform caches the text: it
      // cannot fail a second time.
      const body = HttpMethod.hasBody(request.method)
        ? HttpBody.text(yield* Effect.orDie(request.text), "application/json")
        : HttpBody.empty;
      return yield* http.execute(
        HttpClientRequest.make(request.method)(request.url).pipe(
          HttpClientRequest.prependUrl(url),
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.setBody(body),
        ),
      );
    });

  // The server's answer as it came: its status, its two headers, its body streamed unread. The
  // headers are on the wire before the body can fail, so a server that dies mid-stream ends the
  // client's response short; the one line here is the record of it.
  const passthrough = (
    url: string,
    response: HttpClientResponse.HttpClientResponse,
    who: Log.Attribution,
  ): HttpServerResponse.HttpServerResponse =>
    HttpServerResponse.stream(
      response.stream.pipe(
        Stream.tapError((error) => {
          const failure = unreachable(url, error, who);
          return log.error(`forward cut short; ${failure.message}`, {
            ...who,
            cause: failure.cause,
          });
        }),
      ),
      { status: response.status, headers: forwardedHeaders(response.headers) },
    );

  const register = Effect.fn("Router.register")(function* (url: string) {
    yield* probe(url, {});
    yield* store.addServer(url, SERVER_TYPE).pipe(Effect.mapError((cause) => internal(cause)));
    yield* log.info(`server registered; ${url}`, { location: Log.Locations.server });
  });

  const unregister = Effect.fn("Router.unregister")(function* (url: string) {
    const removed = yield* store
      .removeServer(url)
      .pipe(Effect.mapError((cause) => internal(cause)));
    if (!removed) {
      return yield* Errors.NotFound.make({});
    }
    return yield* log.info(`server removed; ${url}`, { location: Log.Locations.server });
  });

  const servers: Effect.Effect<Contract.Servers, Errors.Internal> = Effect.gen(function* () {
    const urls = yield* store
      .listServers(SERVER_TYPE)
      .pipe(Effect.mapError((cause) => internal(cause)));
    const probed = yield* Effect.forEach(
      urls,
      (url) =>
        Effect.map(Effect.option(probe(url, {})), (stats) =>
          Contract.Server.make({ url, stats: Option.getOrNull(stats) }),
        ),
      { concurrency: "unbounded" },
    );
    return Contract.Servers.make({ servers: probed });
  });

  // The answering server with the fewest machines, ties to the earliest registered.
  const place = (agent: string): Effect.Effect<string, Errors.NoServer | Errors.Internal> =>
    Effect.gen(function* () {
      const urls = yield* store
        .listServers(SERVER_TYPE)
        .pipe(Effect.mapError((cause) => internal(cause, undefined, agent)));
      if (urls.length === 0) {
        return yield* Errors.NoServer.make({ message: "no server registered", agentId: agent });
      }
      const probed = yield* Effect.forEach(
        urls,
        (url) =>
          Effect.map(Effect.result(probe(url, { agentId: agent })), (result) => ({ url, result })),
        { concurrency: "unbounded" },
      );
      let chosen: { readonly url: string; readonly qemus: number } | undefined;
      for (const { url, result } of probed) {
        if (Result.isFailure(result)) {
          yield* log.warning(`server skipped; ${result.failure.message}`, {
            location: Log.Locations.server,
            agentId: agent,
          });
          continue;
        }
        if (chosen === undefined || result.success.qemus < chosen.qemus) {
          chosen = { url, qemus: result.success.qemus };
        }
      }
      if (chosen === undefined) {
        return yield* Errors.NoServer.make({ message: "no server available", agentId: agent });
      }
      return chosen.url;
    });

  const start = Effect.fn("Router.start")(function* (
    request: HttpServerRequest.HttpServerRequest,
    agent: string,
  ) {
    const url = yield* place(agent);
    const who = { agentId: agent };
    const response = yield* send(url, request).pipe(
      Effect.mapError((error) => unreachable(url, error, who)),
    );
    const text = yield* response.text.pipe(
      Effect.mapError((error) => unreachable(url, error, who)),
    );
    const headers = forwardedHeaders(response.headers);
    if (response.status !== 200) {
      // The server refused the start and has logged why; its answer is the client's.
      return HttpServerResponse.text(text, { status: response.status, headers });
    }
    const { id } = yield* decodeStartAnswer(text).pipe(
      Effect.mapError((cause) =>
        serverFailed(url, `server ${url} answered 200 without an id`, cause, who),
      ),
    );
    yield* store.routeSession(id, url).pipe(Effect.mapError((cause) => internal(cause, id, agent)));
    yield* log.info(`routed; ${url}`, { location: id, agentId: agent });
    return HttpServerResponse.text(text, { status: 200, headers });
  });

  const forward = Effect.fn("Router.forward")(function* (
    request: HttpServerRequest.HttpServerRequest,
    id: string,
    agent?: string,
  ) {
    // The column is uuid and servers mint nothing else: a non-uuid has no row to look for.
    const route = Domain.isSessionId(id)
      ? yield* store
          .serverForSession(id)
          .pipe(Effect.mapError((cause) => internal(cause, id, agent)))
      : Option.none<string>();
    if (Option.isNone(route)) {
      return yield* Errors.unknownSession(id, agent);
    }
    const who = agent === undefined ? { location: id } : { location: id, agentId: agent };
    const response = yield* send(route.value, request).pipe(
      Effect.mapError((error) => unreachable(route.value, error, who)),
    );
    return passthrough(route.value, response, who);
  });

  const service: RouterService = { register, unregister, servers, start, forward };
  return service;
});

export class Router extends Context.Service<Router>()("@oligarchy/reverse-proxy/Router", { make }) {
  static readonly layer: Layer.Layer<
    Router,
    never,
    Servers.ServerStore | Log.Log | HttpClient.HttpClient | Config.ProxyConfig
  > = Layer.effect(this)(this.make);
}
