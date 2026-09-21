import { Context, Effect, Layer, Option, Result, Schema, Semaphore, Stream } from "effect";
import type * as Headers from "effect/unstable/http/Headers";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as HttpMethod from "effect/unstable/http/HttpMethod";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as ProxyClient from "../client/proxy-client.ts";
import * as Config from "../config.ts";
import * as Servers from "../db/servers.ts";
import * as SessionStore from "../db/sessions.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Contract from "../shared/contract.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

// A server that has not answered its /stats in this long is skipped for the reserve that asked and
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
const MintedAnswer = Schema.fromJsonString(Schema.toCodecJson(Contract.Minted));
const decodeMintedAnswer = Schema.decodeUnknownEffect(MintedAnswer);

export type RouterService = {
  // Probes GET /stats on the url, then remembers it; a url already registered is probed again.
  readonly register: (url: string) => Effect.Effect<void, Errors.ServerFailed | Errors.Internal>;
  // Forgets the url; sessions routed to it stay routed until they end.
  readonly unregister: (url: string) => Effect.Effect<void, Errors.NotFound | Errors.Internal>;
  // Every registered server with its stats, null for one whose probe failed.
  readonly servers: Effect.Effect<Contract.Servers, Errors.Internal>;
  // Every registered server asked whether it holds the iso's minted disk; unreachable for one
  // that gave no answer of its own.
  readonly minted: (iso: string) => Effect.Effect<Contract.MintedServers, Errors.Internal>;
  // Places a reserve on an answering server with a free slot and remembers the agent. A body
  // naming a server goes to that server and nowhere else. A resume lands on the least-busy
  // server that holds that iso's minted disk; when none can and one with a free slot does
  // not, SetupNeeded names that server and the max-jobs setting it up would add.
  readonly reserve: (
    request: HttpServerRequest.HttpServerRequest,
    body: Contract.ReserveAgentBody,
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    | Errors.BadRequest
    | Errors.NotFound
    | Errors.NoServer
    | Errors.SetupNeeded
    | Errors.ServerFailed
    | Errors.Internal
  >;
  // Forwards relinquish to the server that reserved this agent and forgets the agent when
  // that server accepts it or already holds nothing for it. There is no placement here:
  // /reserve already chose.
  readonly relinquish: (
    request: HttpServerRequest.HttpServerRequest,
    agent: string,
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    Errors.BadRequest | Errors.ServerFailed | Errors.Internal
  >;
  // Forwards start to the server that reserved this agent. There is no placement here:
  // /reserve already chose.
  readonly start: (
    request: HttpServerRequest.HttpServerRequest,
    agent: string,
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    Errors.BadRequest | Errors.ServerFailed | Errors.Internal
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

// A qemu server's own 409: it has room, and no minted disk for this resume. The number is
// the slots setting that machine up would add, which is its max-jobs, not its idle count.
const SETUP_NEEDED = /^setup needed: max-jobs is (\d+)$/;

const maxJobsGained = (text: string): number | undefined => {
  const matched = SETUP_NEEDED.exec(ProxyClient.apiError(text));
  if (matched === null) {
    return undefined;
  }
  const jobs = Number(matched[1]);
  return Number.isSafeInteger(jobs) ? jobs : undefined;
};

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
  const sessionStore = yield* SessionStore.SessionStore;
  const log = yield* Log.Log;
  const http = yield* HttpClient.HttpClient;
  const { token } = yield* Config.ProxyConfig;
  // One reserve at a time: two requests for the same agent must not both place.
  const reserveGate = yield* Semaphore.make(1);

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

  // A server's own GET /minted answer as a state. Everything short of a decodable 200 — no
  // connection, a refusal, a body that is not a Minted, nothing within the probe timeout — is
  // `unreachable`: the row is the report, as `stats: null` is for /servers, so nothing is logged.
  const askMinted = (url: string, iso: string): Effect.Effect<Contract.MintedState> =>
    Effect.gen(function* () {
      const response = yield* http.execute(
        HttpClientRequest.get("/minted").pipe(
          HttpClientRequest.prependUrl(url),
          HttpClientRequest.setUrlParam("iso", iso),
          HttpClientRequest.bearerToken(token),
        ),
      );
      if (response.status !== 200) {
        return "unreachable" as const;
      }
      const answer = yield* decodeMintedAnswer(yield* response.text);
      return answer.minted ? ("minted" as const) : ("unminted" as const);
    }).pipe(
      Effect.timeoutOrElse({
        duration: PROBE_TIMEOUT,
        orElse: () => Effect.succeed("unreachable" as const),
      }),
      Effect.orElseSucceed((): Contract.MintedState => "unreachable"),
    );

  const minted = (iso: string): Effect.Effect<Contract.MintedServers, Errors.Internal> =>
    Effect.gen(function* () {
      const urls = yield* store
        .listServers(SERVER_TYPE)
        .pipe(Effect.mapError((cause) => internal(cause)));
      const asked = yield* Effect.forEach(
        urls,
        (url) =>
          Effect.map(askMinted(url, iso), (state) => Contract.MintedServer.make({ url, state })),
        { concurrency: "unbounded" },
      );
      return Contract.MintedServers.make({ iso, servers: asked });
    });

  const commitStart = (
    url: string,
    request: HttpServerRequest.HttpServerRequest,
    agent: string,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, Errors.ServerFailed | Errors.Internal> =>
    Effect.gen(function* () {
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
      yield* store
        .routeSession(id, url)
        .pipe(Effect.mapError((cause) => internal(cause, id, agent)));
      yield* store.clearAgent(agent).pipe(Effect.mapError((cause) => internal(cause, id, agent)));
      yield* log.info(`routed; ${url}`, { location: id, agentId: agent });
      return HttpServerResponse.text(text, { status: 200, headers });
    });

  const start = Effect.fn("Router.start")(function* (
    request: HttpServerRequest.HttpServerRequest,
    agent: string,
  ) {
    const reserved = yield* store
      .serverForAgent(agent)
      .pipe(Effect.mapError((cause) => internal(cause, undefined, agent)));
    if (Option.isNone(reserved)) {
      return yield* Errors.BadRequest.make({ message: "no reservation", agentId: agent });
    }
    return yield* commitStart(reserved.value, request, agent);
  });

  // One server's answer to the reserve, sent as it came and passed back as it came; a 200 routes
  // the agent there.
  const askToReserve = (
    url: string,
    request: HttpServerRequest.HttpServerRequest,
    agent: string,
  ): Effect.Effect<
    { readonly status: number; readonly text: string; readonly headers: Headers.Input },
    Errors.ServerFailed | Errors.Internal
  > =>
    Effect.gen(function* () {
      const who = { agentId: agent };
      const response = yield* send(url, request).pipe(
        Effect.mapError((error) => unreachable(url, error, who)),
      );
      const text = yield* response.text.pipe(
        Effect.mapError((error) => unreachable(url, error, who)),
      );
      const headers = forwardedHeaders(response.headers);
      if (response.status === 200) {
        yield* store
          .routeAgent(agent, url)
          .pipe(Effect.mapError((cause) => internal(cause, undefined, agent)));
        yield* log.info(`reserved; ${url}`, { location: Log.Locations.server, agentId: agent });
      }
      return { status: response.status, text, headers };
    });

  const reserve = Effect.fn("Router.reserve")(function* (
    request: HttpServerRequest.HttpServerRequest,
    body: Contract.ReserveAgentBody,
  ) {
    const agent = body.agent;
    return yield* reserveGate.withPermits(1)(
      Effect.gen(function* () {
        const existing = yield* store
          .serverForAgent(agent)
          .pipe(Effect.mapError((cause) => internal(cause, undefined, agent)));
        if (Option.isSome(existing)) {
          return yield* Errors.BadRequest.make({ message: "already reserved", agentId: agent });
        }
        const urls = yield* store
          .listServers(SERVER_TYPE)
          .pipe(Effect.mapError((cause) => internal(cause, undefined, agent)));
        // A pin is a pin: that server is probed and asked, and its answer, a 503 included, is the
        // client's. Nothing falls back to another server.
        if (body.server !== undefined) {
          const pinned = body.server;
          if (!urls.includes(pinned)) {
            return yield* Errors.NotFound.make({ message: `no server ${pinned}`, agentId: agent });
          }
          yield* probe(pinned, { agentId: agent });
          const answer = yield* askToReserve(pinned, request, agent);
          return HttpServerResponse.text(answer.text, {
            status: answer.status,
            headers: answer.headers,
          });
        }
        if (urls.length === 0) {
          return yield* Errors.NoServer.make({ message: "no server registered", agentId: agent });
        }
        const probed = yield* Effect.forEach(
          urls,
          (url) =>
            Effect.map(Effect.result(probe(url, { agentId: agent })), (result) => ({
              url,
              result,
            })),
          { concurrency: "unbounded" },
        );
        const ranked: Array<{ readonly url: string; readonly qemus: number }> = [];
        for (const { url, result } of probed) {
          if (Result.isFailure(result)) {
            yield* log.warning(`server skipped; ${result.failure.message}`, {
              location: Log.Locations.server,
              agentId: agent,
            });
            continue;
          }
          ranked.push({ url, qemus: result.success.qemus });
        }
        ranked.sort((left, right) => left.qemus - right.qemus);
        const resume = body.resume !== undefined;
        // The least-busy server that has room and no disk. A later server that holds the disk
        // still wins; this one is the answer only when none does.
        let setup: { readonly url: string; readonly maxJobs: number } | undefined;
        let lastCapacity:
          | { readonly status: number; readonly text: string; readonly headers: Headers.Input }
          | undefined;
        for (const { url } of ranked) {
          const answer = yield* askToReserve(url, request, agent);
          if (answer.status === 503) {
            lastCapacity = answer;
            continue;
          }
          const gained = resume && answer.status === 409 ? maxJobsGained(answer.text) : undefined;
          if (gained !== undefined) {
            if (setup === undefined) {
              setup = { url, maxJobs: gained };
            }
            continue;
          }
          return HttpServerResponse.text(answer.text, {
            status: answer.status,
            headers: answer.headers,
          });
        }
        if (setup !== undefined) {
          return yield* Errors.SetupNeeded.make({
            message: `setup needed: ${setup.url} max-jobs is ${String(setup.maxJobs)}`,
            agentId: agent,
          });
        }
        if (lastCapacity !== undefined) {
          return HttpServerResponse.text(lastCapacity.text, {
            status: lastCapacity.status,
            headers: lastCapacity.headers,
          });
        }
        return yield* Errors.NoServer.make({ message: "no server available", agentId: agent });
      }),
    );
  });

  const relinquish = Effect.fn("Router.relinquish")(function* (
    request: HttpServerRequest.HttpServerRequest,
    agent: string,
  ) {
    // The agent holds a reservation on the server /reserve chose, or the session it started on
    // the server /start routed it to: start forgets the agent's route in favour of the session's.
    // Whichever it is, that server answers the relinquish (a running session is stopped there).
    const reserved = yield* store
      .serverForAgent(agent)
      .pipe(Effect.mapError((cause) => internal(cause, undefined, agent)));
    const session = Option.isSome(reserved)
      ? Option.none<string>()
      : yield* sessionStore
          .sessionForAgent(agent)
          .pipe(Effect.mapError((cause) => internal(cause, undefined, agent)));
    const routed = Option.isNone(session)
      ? Option.none<string>()
      : yield* store
          .serverForSession(session.value)
          .pipe(Effect.mapError((cause) => internal(cause, session.value, agent)));
    const held = Option.orElse(reserved, () => routed);
    if (Option.isNone(held)) {
      return yield* Errors.BadRequest.make({ message: "no reservation", agentId: agent });
    }
    const who: Log.Attribution = Option.isSome(session)
      ? { location: session.value, agentId: agent }
      : { agentId: agent };
    const url = held.value;
    const response = yield* send(url, request).pipe(
      Effect.mapError((error) => unreachable(url, error, who)),
    );
    // Status is on the wire before the body: a 200 means the slot is already free, even if
    // the stream then dies. A 400 means the server holds nothing for this agent: it let the
    // reservation go on its own (ten minutes unused) or restarted, so the route is stale too.
    // Either way forget the agent before passing the answer through, so a fresh reserve places.
    if (response.status === 200 || response.status === 400) {
      yield* store
        .clearAgent(agent)
        .pipe(Effect.mapError((cause) => internal(cause, undefined, agent)));
      yield* log.info(
        response.status === 200 ? `relinquished; ${url}` : `reservation gone; ${url}`,
        { location: Log.Locations.server, agentId: agent },
      );
    }
    return passthrough(url, response, who);
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

  const service: RouterService = {
    register,
    unregister,
    servers,
    minted,
    reserve,
    relinquish,
    start,
    forward,
  };
  return service;
});

export class Router extends Context.Service<Router>()("@oligarchy/qemu-reverse-proxy/Router", {
  make,
}) {
  static readonly layer: Layer.Layer<
    Router,
    never,
    | Servers.ServerStore
    | SessionStore.SessionStore
    | Log.Log
    | HttpClient.HttpClient
    | Config.ProxyConfig
  > = Layer.effect(this)(this.make);
}
