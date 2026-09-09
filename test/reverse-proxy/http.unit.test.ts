import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Redacted, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  HttpBody,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpRouter,
} from "effect/unstable/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/unstable/httpapi";
import { NodeHttpServer } from "@effect/platform-node";
import * as Config from "../../src/config.ts";
import * as Handlers from "../../src/reverse-proxy/handlers.ts";
import * as Router from "../../src/reverse-proxy/router.ts";
import * as Api from "../../src/shared/api.ts";
import * as Contract from "../../src/shared/contract.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as FakeLog from "../support/log.ts";
import * as Reporter from "../support/reporter.ts";
import * as Stores from "../support/stores.ts";

const TOKEN = "test-token";
const SERVER_A = "http://10.0.0.5:42069";
const SERVER_B = "http://10.0.0.6:42069";
const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";
const STARTED_ID = "8f4e2c1a-6b7d-4e5f-9a0b-1c2d3e4f5a6b";
const IMAGE_ID = "3c9b2f80-5a1e-4d6c-8b7a-9e0f1a2b3c4d";
const AGENT_ID = "OLI-61";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const AUTHORIZATION = `Bearer ${TOKEN}`;

const stats = (qemus: number) => ({
  qemus,
  memory: { totalBytes: 16_000, usedBytes: 4_000, freeBytes: 12_000 },
  cpu: {
    cores: 4,
    mean: 20.5,
    mean1m: 22.3,
    mean2m: 21.4,
    mean3m: 20.9,
    p10: 19.8,
    p25: 20.1,
    p75: 20.9,
    p90: 21.1,
  },
});

const ProxyConfigLive = Layer.succeed(Config.ProxyConfig)({
  token: Redacted.make(TOKEN),
  databaseUrl: Redacted.make("postgres://unused"),
});

const bearer = (token: string) =>
  HttpApiMiddleware.layerClient(Api.BearerAuth, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, token)),
  );

// A server that refuses the connection: what node:http reports for a host that is down.
const refused = (request: HttpClientRequest.HttpClientRequest, url: URL) =>
  Effect.fail(
    new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({
        request,
        cause: new Error(`connect ECONNREFUSED ${url.host}`),
      }),
    }),
  );

// The fleet as most tests see it: both servers answer their /stats, A holds two machines and B
// one, and every routed request is answered ok.
const fleet: FakeHttp.Respond = (_, url) =>
  url.pathname === "/stats"
    ? FakeHttp.json(stats(url.origin === SERVER_A ? 2 : 1))
    : FakeHttp.json({ ok: "true" });

type Fixture = {
  readonly store: Stores.FakeServerStore;
  readonly upstream: FakeHttp.Recorder;
  readonly log: FakeLog.FakeLog;
  readonly reporter: Reporter.Collector;
};

const fixture = (respond: FakeHttp.Respond = fleet, overrides: Partial<Fixture> = {}): Fixture => ({
  store: Stores.fakeServerStore(),
  upstream: FakeHttp.recordRequests(respond),
  log: FakeLog.fakeLog(),
  reporter: Reporter.collect(),
  ...overrides,
});

// The reverse proxy's routes on a loopback server; the upstream servers are the recorder's
// HttpClient, given to the Router alone, so the HttpClient in scope still points at the server.
const serve = (fixed: Fixture) =>
  HttpRouter.serve(Handlers.routes, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provide(
      Router.Router.layer.pipe(
        Layer.provide(
          Layer.mergeAll(fixed.store.layer, fixed.log.layer, fixed.upstream.layer, ProxyConfigLive),
        ),
      ),
    ),
    Layer.provide(Layer.mergeAll(fixed.log.layer, ProxyConfigLive)),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(fixed.reporter.layer),
    Layer.provideMerge(bearer(TOKEN)),
  );

// What ./client speaks: the server's own contract, unchanged.
const proxyClient = HttpApiClient.make(Api.ProxyApi);
// What an operator speaks to the reverse proxy alone.
const reverseClient = HttpApiClient.make(Api.ReverseProxyApi);

const decoder = new TextDecoder();

const serverBody = (url: string) => Contract.ServerBody.make({ url });

const upstreamCalls = (fixed: Fixture) =>
  fixed.upstream.requests.map((request) => `${request.method} ${request.url}`);

describe("server registration", () => {
  it.effect("POST /servers probes GET /stats with the bearer, stores the url and logs it", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* reverseClient;
        const ok = yield* api.Servers.register({ payload: serverBody(SERVER_A) });
        expect(ok).toEqual(Contract.Ok.make({}));
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.upstream.requests).toEqual([
        {
          method: "GET",
          url: `${SERVER_A}/stats`,
          headers: expect.objectContaining({ authorization: AUTHORIZATION }),
          body: "",
        },
      ]);
      expect(fixed.store.servers).toEqual([SERVER_A]);
      expect(fixed.log.lines).toEqual([
        {
          level: "info",
          text: `server registered; ${SERVER_A}`,
          sessionId: undefined,
          agentId: undefined,
          skipSentry: false,
          cause: undefined,
        },
      ]);
    }),
  );

  it.effect("a url with a trailing slash probes /stats with one slash and is stored as given", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* reverseClient;
        yield* api.Servers.register({ payload: serverBody(`${SERVER_A}/`) });
      }).pipe(Effect.provide(serve(fixed)));
      expect(upstreamCalls(fixed)).toEqual([`GET ${SERVER_A}/stats`]);
      expect(fixed.store.servers).toEqual([`${SERVER_A}/`]);
    }),
  );

  it.effect("registering a url twice probes twice and keeps it once", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* reverseClient;
        yield* api.Servers.register({ payload: serverBody(SERVER_A) });
        yield* api.Servers.register({ payload: serverBody(SERVER_A) });
      }).pipe(Effect.provide(serve(fixed)));
      expect(upstreamCalls(fixed)).toEqual([`GET ${SERVER_A}/stats`, `GET ${SERVER_A}/stats`]);
      expect(fixed.store.servers).toEqual([SERVER_A]);
      expect(FakeLog.texts(fixed.log)).toEqual([
        `server registered; ${SERVER_A}`,
        `server registered; ${SERVER_A}`,
      ]);
    }),
  );

  it.effect("DELETE /servers removes the server, logs it, and never probes", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      fixed.store.servers.push(SERVER_A, SERVER_B);
      yield* Effect.gen(function* () {
        const api = yield* reverseClient;
        const ok = yield* api.Servers.unregister({ payload: serverBody(SERVER_A) });
        expect(ok.ok).toBe("true");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.store.servers).toEqual([SERVER_B]);
      expect(fixed.upstream.requests).toEqual([]);
      expect(fixed.log.lines).toEqual([
        {
          level: "info",
          text: `server removed; ${SERVER_A}`,
          sessionId: undefined,
          agentId: undefined,
          skipSentry: false,
          cause: undefined,
        },
      ]);
    }),
  );

  it.effect("DELETE /servers for a url never registered is 404 not found", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* reverseClient;
        const error = yield* Effect.flip(api.Servers.unregister({ payload: serverBody(SERVER_A) }));
        expect(error).toMatchObject({ _tag: "NotFound", message: "not found" });
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.del("/servers", {
          headers: { authorization: AUTHORIZATION },
          body: HttpBody.jsonUnsafe({ url: SERVER_A }),
        });
        expect(raw.status).toBe(404);
        expect(yield* raw.json).toEqual({ error: "not found" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: "DELETE /servers failed: not found",
          sessionId: undefined,
          agentId: undefined,
          skipSentry: true,
          cause: undefined,
        },
        {
          level: "error",
          text: "DELETE /servers failed: not found",
          sessionId: undefined,
          agentId: undefined,
          skipSentry: true,
          cause: undefined,
        },
      ]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect(
    "GET /servers answers every server with its stats in registration order, null for one that does not answer, and logs nothing",
    () =>
      Effect.gen(function* () {
        const fixed = fixture((request, url) =>
          url.origin === SERVER_B ? refused(request, url) : FakeHttp.json(stats(2)),
        );
        fixed.store.servers.push(SERVER_A, SERVER_B);
        yield* Effect.gen(function* () {
          const api = yield* reverseClient;
          const [servers, response] = yield* api.Servers.servers({
            responseMode: "decoded-and-response",
          });
          expect(servers.servers).toHaveLength(2);
          expect(servers.servers[0]).toMatchObject({ url: SERVER_A, stats: stats(2) });
          expect(servers.servers[1]).toEqual(Contract.Server.make({ url: SERVER_B, stats: null }));
          expect(yield* response.json).toEqual({
            servers: [
              { url: SERVER_A, stats: stats(2) },
              { url: SERVER_B, stats: null },
            ],
          });
        }).pipe(Effect.provide(serve(fixed)));
        expect(upstreamCalls(fixed).sort()).toEqual([
          `GET ${SERVER_A}/stats`,
          `GET ${SERVER_B}/stats`,
        ]);
        expect(fixed.log.lines).toEqual([]);
      }),
  );

  it.effect("GET /servers with nothing registered is an empty list", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.get("/servers", { headers: { authorization: AUTHORIZATION } });
        expect(raw.status).toBe(200);
        expect(yield* raw.json).toEqual({ servers: [] });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.upstream.requests).toEqual([]);
    }),
  );
});

describe("registration refusals", () => {
  it.effect("a url that is not http or https is 400 with the url rule and is never probed", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        for (const url of ["qemu.example.com:42069", "ftp://qemu.example.com", ""]) {
          const raw = yield* http.post("/servers", {
            headers: { authorization: AUTHORIZATION },
            body: HttpBody.jsonUnsafe({ url }),
          });
          expect(raw.status).toBe(400);
          expect(yield* raw.json).toMatchObject({
            error: expect.stringContaining("url must be an http or https url"),
          });
        }
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.upstream.requests).toEqual([]);
      expect(fixed.store.servers).toEqual([]);
      expect(fixed.log.lines).toHaveLength(3);
      expect(fixed.log.lines.every((line) => line.skipSentry)).toBe(true);
    }),
  );

  it.effect(
    "a server that refuses the connection is 502 server <url> unreachable: <cause>, stored nowhere, logged with the cause",
    () =>
      Effect.gen(function* () {
        const fixed = fixture(refused);
        yield* Effect.gen(function* () {
          const api = yield* reverseClient;
          const error = yield* Effect.flip(api.Servers.register({ payload: serverBody(SERVER_A) }));
          expect(error).toMatchObject({
            _tag: "ServerFailed",
            message: `server ${SERVER_A} unreachable: connect ECONNREFUSED 10.0.0.5:42069`,
          });
          const http = yield* HttpClient.HttpClient;
          const raw = yield* http.post("/servers", {
            headers: { authorization: AUTHORIZATION },
            body: HttpBody.jsonUnsafe({ url: SERVER_A }),
          });
          expect(raw.status).toBe(502);
          expect(yield* raw.json).toEqual({
            error: `server ${SERVER_A} unreachable: connect ECONNREFUSED 10.0.0.5:42069`,
          });
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.store.servers).toEqual([]);
        expect(fixed.log.lines).toHaveLength(2);
        expect(fixed.log.lines[0]).toMatchObject({
          level: "error",
          text: `POST /servers failed: server ${SERVER_A} unreachable: connect ECONNREFUSED 10.0.0.5:42069`,
          sessionId: undefined,
          agentId: undefined,
          skipSentry: false,
        });
        expect(fixed.log.lines[0]?.cause).toBeInstanceOf(Error);
      }),
  );

  it.effect("a server answering 401 is 502 server <url> answered 401: unauthorized", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => FakeHttp.json({ error: "unauthorized" }, 401));
      yield* Effect.gen(function* () {
        const api = yield* reverseClient;
        const error = yield* Effect.flip(api.Servers.register({ payload: serverBody(SERVER_A) }));
        expect(error).toMatchObject({
          _tag: "ServerFailed",
          message: `server ${SERVER_A} answered 401: unauthorized`,
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.store.servers).toEqual([]);
    }),
  );

  it.effect("a 404 with a non-json body carries the body raw, an empty one request failed", () =>
    Effect.gen(function* () {
      const fixed = fixture((_, url) =>
        url.origin === SERVER_A
          ? new Response("<html>nope</html>", { status: 404 })
          : new Response(null, { status: 503 }),
      );
      yield* Effect.gen(function* () {
        const api = yield* reverseClient;
        const first = yield* Effect.flip(api.Servers.register({ payload: serverBody(SERVER_A) }));
        expect(first.message).toBe(`server ${SERVER_A} answered 404: <html>nope</html>`);
        const second = yield* Effect.flip(api.Servers.register({ payload: serverBody(SERVER_B) }));
        expect(second.message).toBe(`server ${SERVER_B} answered 503: request failed`);
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );

  it.effect("a 200 whose body cannot be read is 502 unreachable with the read failure", () =>
    Effect.gen(function* () {
      const fixed = fixture(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.error(new Error("read ECONNRESET"));
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      );
      yield* Effect.gen(function* () {
        const api = yield* reverseClient;
        const error = yield* Effect.flip(api.Servers.register({ payload: serverBody(SERVER_A) }));
        expect(error).toMatchObject({
          _tag: "ServerFailed",
          message: `server ${SERVER_A} unreachable: read ECONNRESET`,
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.store.servers).toEqual([]);
    }),
  );

  it.effect("a 200 that is not stats is 502 server <url> answered 200 without stats", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => FakeHttp.json({ hello: "world" }));
      yield* Effect.gen(function* () {
        const api = yield* reverseClient;
        const error = yield* Effect.flip(api.Servers.register({ payload: serverBody(SERVER_A) }));
        expect(error).toMatchObject({
          _tag: "ServerFailed",
          message: `server ${SERVER_A} answered 200 without stats`,
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.store.servers).toEqual([]);
      expect(fixed.log.lines[0]?.skipSentry).toBe(false);
    }),
  );

  it.effect("a probe that never answers is 502 unreachable: no response within 10 seconds", () =>
    Effect.gen(function* () {
      const probing = yield* Deferred.make<void>();
      const fixed = fixture(() =>
        Deferred.succeed(probing, undefined).pipe(Effect.andThen(Effect.never)),
      );
      yield* Effect.gen(function* () {
        const api = yield* reverseClient;
        const request = yield* Effect.forkChild(
          Effect.flip(api.Servers.register({ payload: serverBody(SERVER_A) })),
        );
        yield* Deferred.await(probing);
        yield* TestClock.adjust("9 seconds");
        expect(request.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust("1 second");
        const error = yield* Fiber.join(request);
        expect(error).toMatchObject({
          _tag: "ServerFailed",
          message: `server ${SERVER_A} unreachable: no response within 10 seconds`,
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.store.servers).toEqual([]);
    }),
  );

  it.effect("a failed insert is 500 internal error logged with the driver's reason", () =>
    Effect.gen(function* () {
      const failure = Errors.DatabaseError.make({
        operation: "addServer",
        message: "Failed query: insert into servers",
        cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      });
      const fixed = fixture(fleet, {
        store: Stores.fakeServerStore({ addServer: () => Effect.fail(failure) }),
      });
      yield* Effect.gen(function* () {
        const api = yield* reverseClient;
        const error = yield* Effect.flip(api.Servers.register({ payload: serverBody(SERVER_A) }));
        expect(error).toMatchObject({ _tag: "Internal", message: "internal error" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(upstreamCalls(fixed)).toEqual([`GET ${SERVER_A}/stats`]);
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: "POST /servers failed: connect ECONNREFUSED 127.0.0.1:5432",
          sessionId: undefined,
          agentId: undefined,
          skipSentry: false,
          cause: failure,
        },
      ]);
    }),
  );
});

describe("placement", () => {
  const startBody = Contract.StartBody.make({ iso: "omarchy.iso", agent: AGENT_ID });

  // Servers answer a start with the id they minted; `null` scripts one that answers without it.
  const placing =
    (started: string | null = STARTED_ID): FakeHttp.Respond =>
    (request, url) =>
      url.pathname === "/start"
        ? FakeHttp.json(started === null ? { ok: "true" } : { id: started })
        : fleet(request, url);

  it.effect(
    "POST /start probes every server, picks the fewest qemus, forwards the body with the bearer, records the route and logs it",
    () =>
      Effect.gen(function* () {
        const fixed = fixture(placing());
        fixed.store.servers.push(SERVER_A, SERVER_B);
        yield* Effect.gen(function* () {
          const api = yield* proxyClient;
          const [started, response] = yield* api.Sessions.start({
            payload: startBody,
            responseMode: "decoded-and-response",
          });
          expect(started.id).toBe(STARTED_ID);
          expect(response.headers["content-type"]).toContain("application/json");
          expect(yield* response.text).toBe(`{"id":"${STARTED_ID}"}`);
        }).pipe(Effect.provide(serve(fixed)));
        expect(upstreamCalls(fixed).slice(0, 2).sort()).toEqual([
          `GET ${SERVER_A}/stats`,
          `GET ${SERVER_B}/stats`,
        ]);
        expect(fixed.upstream.requests[2]).toEqual({
          method: "POST",
          url: `${SERVER_B}/start`,
          headers: expect.objectContaining({
            authorization: AUTHORIZATION,
            "content-type": "application/json",
          }),
          body: '{"iso":"omarchy.iso","agent":"OLI-61"}',
        });
        expect(fixed.store.routes.get(STARTED_ID)).toBe(SERVER_B);
        expect(fixed.log.lines).toEqual([
          {
            level: "info",
            text: `routed; ${SERVER_B}`,
            sessionId: STARTED_ID,
            agentId: AGENT_ID,
            skipSentry: false,
            cause: undefined,
          },
        ]);
      }),
  );

  it.effect("ties go to the first registered server", () =>
    Effect.gen(function* () {
      const fixed = fixture((request, url) =>
        url.pathname === "/stats" ? FakeHttp.json(stats(1)) : placing()(request, url),
      );
      fixed.store.servers.push(SERVER_B, SERVER_A);
      yield* Effect.gen(function* () {
        const api = yield* proxyClient;
        yield* api.Sessions.start({ payload: startBody });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.store.routes.get(STARTED_ID)).toBe(SERVER_B);
    }),
  );

  it.effect("a server whose probe fails is skipped with a warning and the rest are placed on", () =>
    Effect.gen(function* () {
      const fixed = fixture((request, url) =>
        url.origin === SERVER_A && url.pathname === "/stats"
          ? refused(request, url)
          : placing()(request, url),
      );
      fixed.store.servers.push(SERVER_A, SERVER_B);
      yield* Effect.gen(function* () {
        const api = yield* proxyClient;
        yield* api.Sessions.start({ payload: startBody });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.store.routes.get(STARTED_ID)).toBe(SERVER_B);
      expect(fixed.log.lines).toEqual([
        {
          level: "warning",
          text: `server skipped; server ${SERVER_A} unreachable: connect ECONNREFUSED 10.0.0.5:42069`,
          sessionId: undefined,
          agentId: AGENT_ID,
          skipSentry: false,
          cause: undefined,
        },
        {
          level: "info",
          text: `routed; ${SERVER_B}`,
          sessionId: STARTED_ID,
          agentId: AGENT_ID,
          skipSentry: false,
          cause: undefined,
        },
      ]);
    }),
  );

  it.effect("no registered server is 503 no server registered, logged and reported", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        // The reverse proxy's own contract decodes the 503; ./client sees ProxyRefusal 503.
        const api = yield* reverseClient;
        const error = yield* Effect.flip(api.Sessions.start({ payload: startBody }));
        expect(error).toMatchObject({ _tag: "NoServer", message: "no server registered" });
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.post("/start", {
          headers: { authorization: AUTHORIZATION },
          body: HttpBody.jsonUnsafe(startBody),
        });
        expect(raw.status).toBe(503);
        expect(yield* raw.json).toEqual({ error: "no server registered" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.upstream.requests).toEqual([]);
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: "POST /start failed: no server registered",
          sessionId: undefined,
          agentId: AGENT_ID,
          skipSentry: false,
          cause: undefined,
        },
        {
          level: "error",
          text: "POST /start failed: no server registered",
          sessionId: undefined,
          agentId: AGENT_ID,
          skipSentry: false,
          cause: undefined,
        },
      ]);
    }),
  );

  it.effect("every server failing its probe is 503 no server available after the warnings", () =>
    Effect.gen(function* () {
      const fixed = fixture(refused);
      fixed.store.servers.push(SERVER_A, SERVER_B);
      yield* Effect.gen(function* () {
        const api = yield* reverseClient;
        const error = yield* Effect.flip(api.Sessions.start({ payload: startBody }));
        expect(error).toMatchObject({ _tag: "NoServer", message: "no server available" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.store.routes.size).toBe(0);
      expect(fixed.log.lines.map((line) => [line.level, line.text, line.agentId])).toEqual([
        [
          "warning",
          `server skipped; server ${SERVER_A} unreachable: connect ECONNREFUSED 10.0.0.5:42069`,
          AGENT_ID,
        ],
        [
          "warning",
          `server skipped; server ${SERVER_B} unreachable: connect ECONNREFUSED 10.0.0.6:42069`,
          AGENT_ID,
        ],
        ["error", "POST /start failed: no server available", AGENT_ID],
      ]);
    }),
  );

  it.effect("a start the server refuses passes through as it came, without a route or a line", () =>
    Effect.gen(function* () {
      const fixed = fixture((request, url) =>
        url.pathname === "/start"
          ? FakeHttp.json({ error: "qemu: disk not found: /tmp/nope.qcow2" }, 502)
          : fleet(request, url),
      );
      fixed.store.servers.push(SERVER_A);
      yield* Effect.gen(function* () {
        const api = yield* proxyClient;
        const error = yield* Effect.flip(api.Sessions.start({ payload: startBody }));
        expect(error).toMatchObject({
          _tag: "StartFailed",
          message: "qemu: disk not found: /tmp/nope.qcow2",
        });
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.post("/start", {
          headers: { authorization: AUTHORIZATION },
          body: HttpBody.jsonUnsafe(startBody),
        });
        expect(raw.status).toBe(502);
        expect(raw.headers["content-type"]).toContain("application/json");
        expect(yield* raw.text).toBe('{"error":"qemu: disk not found: /tmp/nope.qcow2"}');
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.store.routes.size).toBe(0);
      expect(fixed.log.lines).toEqual([]);
    }),
  );

  it.effect("a 200 without an id is 502 server <url> answered 200 without an id", () =>
    Effect.gen(function* () {
      const fixed = fixture(placing(null));
      fixed.store.servers.push(SERVER_A);
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.post("/start", {
          headers: { authorization: AUTHORIZATION },
          body: HttpBody.jsonUnsafe(startBody),
        });
        expect(raw.status).toBe(502);
        expect(yield* raw.json).toEqual({
          error: `server ${SERVER_A} answered 200 without an id`,
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.store.routes.size).toBe(0);
      expect(fixed.log.lines).toHaveLength(1);
      expect(fixed.log.lines[0]).toMatchObject({
        level: "error",
        text: `POST /start failed: server ${SERVER_A} answered 200 without an id`,
        agentId: AGENT_ID,
        skipSentry: false,
      });
      expect(fixed.log.lines[0]?.cause).toBeDefined();
    }),
  );

  it.effect("a server that dies mid-start is 502 unreachable attributed to the agent", () =>
    Effect.gen(function* () {
      const fixed = fixture((request, url) =>
        url.pathname === "/start" ? refused(request, url) : fleet(request, url),
      );
      fixed.store.servers.push(SERVER_A);
      yield* Effect.gen(function* () {
        // The proxy's client reads a 502 on /start as the proxy's StartFailed: same status, same
        // message, which is all ./client ever shows.
        const api = yield* proxyClient;
        const error = yield* Effect.flip(api.Sessions.start({ payload: startBody }));
        expect(error.message).toBe(
          `server ${SERVER_A} unreachable: connect ECONNREFUSED 10.0.0.5:42069`,
        );
        expect(error._tag).toBe("StartFailed");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toHaveLength(1);
      expect(fixed.log.lines[0]).toMatchObject({
        level: "error",
        text: `POST /start failed: server ${SERVER_A} unreachable: connect ECONNREFUSED 10.0.0.5:42069`,
        sessionId: undefined,
        agentId: AGENT_ID,
        skipSentry: false,
      });
    }),
  );

  it.effect(
    "a route that cannot be recorded is 500 internal error attributed to the new session",
    () =>
      Effect.gen(function* () {
        const failure = Errors.DatabaseError.make({
          operation: "routeSession",
          message: "Failed query: insert into session_servers",
          cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        });
        const fixed = fixture(placing(), {
          store: Stores.fakeServerStore({ routeSession: () => Effect.fail(failure) }),
        });
        fixed.store.servers.push(SERVER_A);
        yield* Effect.gen(function* () {
          const api = yield* proxyClient;
          const error = yield* Effect.flip(api.Sessions.start({ payload: startBody }));
          expect(error).toMatchObject({ _tag: "Internal", message: "internal error" });
        }).pipe(Effect.provide(serve(fixed)));
        // No compensating stop: the machine times out on its server, as the doc says.
        expect(upstreamCalls(fixed)).toEqual([`GET ${SERVER_A}/stats`, `POST ${SERVER_A}/start`]);
        expect(fixed.log.lines).toEqual([
          {
            level: "error",
            text: "POST /start failed: connect ECONNREFUSED 127.0.0.1:5432",
            sessionId: STARTED_ID,
            agentId: AGENT_ID,
            skipSentry: false,
            cause: failure,
          },
        ]);
      }),
  );

  it.effect("POST /start records the route even when the client disconnects mid-start", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const recorded = yield* Deferred.make<string>();
      const fixed = fixture(
        (request, url) =>
          url.pathname === "/start"
            ? Effect.gen(function* () {
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
                return FakeHttp.json({ id: STARTED_ID });
              })
            : fleet(request, url),
        {
          store: Stores.fakeServerStore({
            routeSession: (id, url) => Deferred.succeed(recorded, `${id} ${url}`),
          }),
        },
      );
      fixed.store.servers.push(SERVER_A);
      yield* Effect.gen(function* () {
        const api = yield* proxyClient;
        const request = yield* Effect.forkChild(api.Sessions.start({ payload: startBody }));
        yield* Deferred.await(entered);
        // The interrupt lands on the client fiber: the connection is gone, the handler is not.
        yield* Fiber.interrupt(request);
        const exit = yield* Fiber.await(request);
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        expect(Deferred.isDoneUnsafe(recorded)).toBe(false);
        yield* Deferred.succeed(release, undefined);
        expect(yield* Deferred.await(recorded)).toBe(`${STARTED_ID} ${SERVER_A}`);
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );
});

describe("forwarding", () => {
  it.effect(
    "GET /image forwards the query with the bearer and passes status, content-type, x-image-url and the bytes back",
    () =>
      Effect.gen(function* () {
        const imageUrl = Contract.StoredImageUrl(IMAGE_ID);
        const fixed = fixture(
          () =>
            new Response(PNG, {
              status: 200,
              headers: { "content-type": "image/png", "x-image-url": imageUrl, date: "never" },
            }),
        );
        fixed.store.routes.set(SESSION_ID, SERVER_A);
        yield* Effect.gen(function* () {
          const api = yield* proxyClient;
          const [image, response] = yield* api.Sessions.image({
            query: { id: SESSION_ID, agent: AGENT_ID },
            responseMode: "decoded-and-response",
          });
          expect([...image.body]).toEqual([...PNG]);
          expect(image.headers["x-image-url"]).toBe(imageUrl);
          expect(response.headers["content-type"]).toBe("image/png");
          expect(response.headers["x-image-url"]).toBe(imageUrl);
          expect(response.headers.date).not.toBe("never");
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.upstream.requests).toEqual([
          {
            method: "GET",
            url: `${SERVER_A}/image?id=${SESSION_ID}&agent=${AGENT_ID}`,
            headers: expect.objectContaining({ authorization: AUTHORIZATION }),
            body: "",
          },
        ]);
        expect(fixed.log.lines).toEqual([]);
      }),
  );

  it.effect("GET /serial passes text/plain through, a stored slash joined once", () =>
    Effect.gen(function* () {
      const fixed = fixture(
        (_, url) =>
          new Response(`${url.pathname} log\n`, {
            status: 200,
            headers: { "content-type": "text/plain" },
          }),
      );
      fixed.store.routes.set(SESSION_ID, `${SERVER_A}/`);
      yield* Effect.gen(function* () {
        const api = yield* proxyClient;
        const [serial, serialResponse] = yield* api.Sessions.serial({
          query: { id: SESSION_ID, agent: AGENT_ID },
          responseMode: "decoded-and-response",
        });
        expect(decoder.decode(serial)).toBe("/serial log\n");
        expect(serialResponse.headers["content-type"]).toBe("text/plain");
      }).pipe(Effect.provide(serve(fixed)));
      expect(upstreamCalls(fixed)).toEqual([
        `GET ${SERVER_A}/serial?id=${SESSION_ID}&agent=${AGENT_ID}`,
      ]);
    }),
  );

  it.effect("GET /follow streams the upstream body through as application/x-ndjson", () =>
    Effect.gen(function* () {
      const lines = [
        '{"type":"session","status":"running"}\n',
        '{"type":"session","status":"succeeded"}\n',
      ];
      const encoder = new TextEncoder();
      const fixed = fixture(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (const line of lines) {
                  controller.enqueue(encoder.encode(line));
                }
                controller.close();
              },
            }),
            { status: 200, headers: { "content-type": "application/x-ndjson" } },
          ),
      );
      fixed.store.routes.set(SESSION_ID, SERVER_A);
      yield* Effect.gen(function* () {
        const api = yield* proxyClient;
        const [stream, response] = yield* api.Sessions.follow({
          query: { id: SESSION_ID },
          responseMode: "decoded-and-response",
        });
        expect(response.headers["content-type"]).toBe("application/x-ndjson");
        expect(yield* Stream.mkString(Stream.decodeText(stream))).toBe(lines.join(""));
      }).pipe(Effect.provide(serve(fixed)));
      expect(upstreamCalls(fixed)).toEqual([`GET ${SERVER_A}/follow?id=${SESSION_ID}`]);
    }),
  );

  it.effect("GET /follow streams each line as the server writes it, not once it has ended", () =>
    Effect.gen(function* () {
      const first = '{"type":"session","status":"running"}\n';
      const second = '{"type":"session","status":"succeeded"}\n';
      const encoder = new TextEncoder();
      // The server writes the second line only once the test has read the first one: a proxy
      // that buffered the body would hang here until the test timeout instead of streaming.
      let releaseSecond: () => void = () => undefined;
      const secondReleased = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      const fixed = fixture(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode(first));
              },
              async pull(controller) {
                await secondReleased;
                controller.enqueue(encoder.encode(second));
                controller.close();
              },
            }),
            { status: 200, headers: { "content-type": "application/x-ndjson" } },
          ),
      );
      fixed.store.routes.set(SESSION_ID, SERVER_A);
      yield* Effect.gen(function* () {
        const api = yield* proxyClient;
        const stream = yield* api.Sessions.follow({ query: { id: SESSION_ID } });
        const received: Array<string> = [];
        yield* Stream.runForEach(Stream.decodeText(stream), (chunk) =>
          Effect.sync(() => {
            received.push(chunk);
            if (received.join("") === first) {
              releaseSecond();
            }
          }),
        );
        expect(received.join("")).toBe(first + second);
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );

  it.effect("a routed session keeps its server after that server is unregistered", () =>
    Effect.gen(function* () {
      const fixed = fixture(
        () => new Response("serial\n", { status: 200, headers: { "content-type": "text/plain" } }),
      );
      fixed.store.servers.push(SERVER_A);
      fixed.store.routes.set(SESSION_ID, SERVER_A);
      yield* Effect.gen(function* () {
        const operator = yield* reverseClient;
        yield* operator.Servers.unregister({ payload: serverBody(SERVER_A) });
        const api = yield* proxyClient;
        const serial = yield* api.Sessions.serial({ query: { id: SESSION_ID, agent: AGENT_ID } });
        expect(decoder.decode(serial)).toBe("serial\n");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.store.servers).toEqual([]);
      expect(upstreamCalls(fixed)).toEqual([
        `GET ${SERVER_A}/serial?id=${SESSION_ID}&agent=${AGENT_ID}`,
      ]);
    }),
  );

  it.effect("a body is forwarded as the text it arrived as, spacing and key order included", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      fixed.store.routes.set(SESSION_ID, SERVER_A);
      const text = `{ "agent" : "${AGENT_ID}",\n  "keys":"a b" , "id": "${SESSION_ID}" }`;
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/send-keys", {
          headers: { authorization: AUTHORIZATION },
          body: HttpBody.text(text, "application/json"),
        });
        expect(response.status).toBe(200);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.upstream.requests.map((request) => request.body)).toEqual([text]);
    }),
  );

  it.effect("every driving POST forwards its body as it came and passes the ok through", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      fixed.store.routes.set(SESSION_ID, SERVER_A);
      const sendKeys = Contract.SendKeysBody.make({
        id: SESSION_ID,
        keys: "ls<ENTER>",
        agent: AGENT_ID,
      });
      const sendMouse = Contract.SendMouseBody.make({
        id: SESSION_ID,
        x: 0.5,
        y: 0.25,
        button: "left",
        clicks: 2,
        agent: AGENT_ID,
      });
      const intentStart = Contract.IntentStartBody.make({
        id: SESSION_ID,
        agent: AGENT_ID,
        test_result_id: "result-1",
        message: "open a terminal",
      });
      const intentEnd = Contract.IntentEndBody.make({ id: SESSION_ID, agent: AGENT_ID });
      const stop = Contract.StopBody.make({
        id: SESSION_ID,
        agent: AGENT_ID,
        status: "succeeded",
        reason: "done",
      });
      yield* Effect.gen(function* () {
        const api = yield* proxyClient;
        expect(yield* api.Sessions.sendKeys({ payload: sendKeys })).toEqual(Contract.Ok.make({}));
        expect((yield* api.Sessions.sendMouse({ payload: sendMouse })).ok).toBe("true");
        expect((yield* api.Sessions.intentStart({ payload: intentStart })).ok).toBe("true");
        expect((yield* api.Sessions.intentEnd({ payload: intentEnd })).ok).toBe("true");
        const [ok, response] = yield* api.Sessions.stop({
          payload: stop,
          responseMode: "decoded-and-response",
        });
        expect(ok.ok).toBe("true");
        expect(yield* response.text).toBe('{"ok":"true"}');
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.upstream.requests).toEqual([
        {
          method: "POST",
          url: `${SERVER_A}/send-keys`,
          headers: expect.objectContaining({
            authorization: AUTHORIZATION,
            "content-type": "application/json",
          }),
          body: JSON.stringify({ id: SESSION_ID, keys: "ls<ENTER>", agent: AGENT_ID }),
        },
        {
          method: "POST",
          url: `${SERVER_A}/send-mouse`,
          headers: expect.objectContaining({ authorization: AUTHORIZATION }),
          body: JSON.stringify({
            id: SESSION_ID,
            x: 0.5,
            y: 0.25,
            button: "left",
            clicks: 2,
            agent: AGENT_ID,
          }),
        },
        {
          method: "POST",
          url: `${SERVER_A}/intent/start`,
          headers: expect.objectContaining({ authorization: AUTHORIZATION }),
          body: JSON.stringify({
            id: SESSION_ID,
            agent: AGENT_ID,
            test_result_id: "result-1",
            message: "open a terminal",
          }),
        },
        {
          method: "POST",
          url: `${SERVER_A}/intent/end`,
          headers: expect.objectContaining({ authorization: AUTHORIZATION }),
          body: JSON.stringify({ id: SESSION_ID, agent: AGENT_ID }),
        },
        {
          method: "POST",
          url: `${SERVER_A}/stop`,
          headers: expect.objectContaining({ authorization: AUTHORIZATION }),
          body: JSON.stringify({
            id: SESSION_ID,
            agent: AGENT_ID,
            status: "succeeded",
            reason: "done",
          }),
        },
      ]);
      expect(fixed.log.lines).toEqual([]);
    }),
  );

  it.effect("a server's refusal passes through unchanged and is not logged here", () =>
    Effect.gen(function* () {
      const message = `agent "OLI-99" does not own session "${SESSION_ID}"`;
      const fixed = fixture(() => FakeHttp.json({ error: message }, 403));
      fixed.store.routes.set(SESSION_ID, SERVER_A);
      yield* Effect.gen(function* () {
        const api = yield* proxyClient;
        const error = yield* Effect.flip(
          api.Sessions.sendKeys({
            payload: Contract.SendKeysBody.make({ id: SESSION_ID, keys: "a", agent: "OLI-99" }),
          }),
        );
        expect(error).toMatchObject({ _tag: "Forbidden", message });
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.get(`/serial?id=${SESSION_ID}&agent=OLI-99`, {
          headers: { authorization: AUTHORIZATION },
        });
        expect(raw.status).toBe(403);
        expect(yield* raw.json).toEqual({ error: message });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );
});

describe("forwarding refusals", () => {
  it.effect("a uuid nobody routed is 404 unknown session attributed to it and the agent", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* proxyClient;
        const error = yield* Effect.flip(
          api.Sessions.serial({ query: { id: SESSION_ID, agent: AGENT_ID } }),
        );
        expect(error).toMatchObject({
          _tag: "UnknownSession",
          message: `unknown session "${SESSION_ID}"`,
        });
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.get(`/follow?id=${SESSION_ID}`, {
          headers: { authorization: AUTHORIZATION },
        });
        expect(raw.status).toBe(404);
        expect(yield* raw.json).toEqual({ error: `unknown session "${SESSION_ID}"` });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.upstream.requests).toEqual([]);
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: `GET /serial?id=${SESSION_ID}&agent=${AGENT_ID} failed: unknown session "${SESSION_ID}"`,
          sessionId: SESSION_ID,
          agentId: AGENT_ID,
          skipSentry: true,
          cause: undefined,
        },
        {
          level: "error",
          text: `GET /follow?id=${SESSION_ID} failed: unknown session "${SESSION_ID}"`,
          sessionId: SESSION_ID,
          agentId: undefined,
          skipSentry: true,
          cause: undefined,
        },
      ]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect("an id that is not a uuid is 404 unknown session without reading the store", () =>
    Effect.gen(function* () {
      const fixed = fixture(fleet, {
        store: Stores.fakeServerStore({
          serverForSession: () => Effect.die("Unexpected ServerStore.serverForSession"),
        }),
      });
      yield* Effect.gen(function* () {
        const api = yield* proxyClient;
        const named = yield* Effect.flip(
          api.Sessions.stop({
            payload: Contract.StopBody.make({ id: "garbage", agent: AGENT_ID }),
          }),
        );
        expect(named).toMatchObject({
          _tag: "UnknownSession",
          message: 'unknown session "garbage"',
        });
        const empty = yield* Effect.flip(api.Sessions.follow({ query: { id: "" } }));
        expect(empty).toMatchObject({ _tag: "UnknownSession", message: 'unknown session ""' });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines.map((line) => [line.text, line.sessionId, line.agentId])).toEqual([
        ['POST /stop failed: unknown session "garbage"', undefined, AGENT_ID],
        ['GET /follow?id= failed: unknown session ""', undefined, undefined],
      ]);
    }),
  );

  it.effect(
    "a routed server that refuses the connection is 502 server <url> unreachable, attributed and reported",
    () =>
      Effect.gen(function* () {
        const fixed = fixture(refused);
        fixed.store.routes.set(SESSION_ID, SERVER_A);
        yield* Effect.gen(function* () {
          const api = yield* proxyClient;
          const error = yield* Effect.flip(
            api.Sessions.sendKeys({
              payload: Contract.SendKeysBody.make({ id: SESSION_ID, keys: "a", agent: AGENT_ID }),
            }),
          );
          expect(error.message).toBe(
            `server ${SERVER_A} unreachable: connect ECONNREFUSED 10.0.0.5:42069`,
          );
          expect(error._tag).toBe("ExchangeFailed");
          const http = yield* HttpClient.HttpClient;
          const raw = yield* http.get(`/follow?id=${SESSION_ID}`, {
            headers: { authorization: AUTHORIZATION },
          });
          expect(raw.status).toBe(502);
          expect(yield* raw.json).toEqual({
            error: `server ${SERVER_A} unreachable: connect ECONNREFUSED 10.0.0.5:42069`,
          });
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.log.lines).toHaveLength(2);
        expect(fixed.log.lines[0]).toMatchObject({
          level: "error",
          text: `POST /send-keys failed: server ${SERVER_A} unreachable: connect ECONNREFUSED 10.0.0.5:42069`,
          sessionId: SESSION_ID,
          agentId: AGENT_ID,
          skipSentry: false,
        });
        expect(fixed.log.lines[0]?.cause).toBeInstanceOf(Error);
        expect(fixed.log.lines[1]).toMatchObject({
          text: `GET /follow?id=${SESSION_ID} failed: server ${SERVER_A} unreachable: connect ECONNREFUSED 10.0.0.5:42069`,
          sessionId: SESSION_ID,
          agentId: undefined,
          skipSentry: false,
        });
      }),
  );

  it.effect(
    "a server that dies mid-stream ends the client's answer short and logs forward cut short",
    () =>
      Effect.gen(function* () {
        const encoder = new TextEncoder();
        const fixed = fixture(
          () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(encoder.encode('{"type":"session","status":"running"}\n'));
                  controller.error(new Error("read ECONNRESET"));
                },
              }),
              { status: 200, headers: { "content-type": "application/x-ndjson" } },
            ),
        );
        fixed.store.routes.set(SESSION_ID, SERVER_A);
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const response = yield* http.get(`/follow?id=${SESSION_ID}`, {
            headers: { authorization: AUTHORIZATION },
          });
          // The headers were on the wire before the body failed: a 200 whose body ends short.
          expect(response.status).toBe(200);
          const body = yield* Effect.exit(Stream.runCollect(Stream.decodeText(response.stream)));
          expect(Exit.isSuccess(body) ? [...body.value].join("") : "").not.toContain("succeeded");
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.log.lines).toHaveLength(1);
        expect(fixed.log.lines[0]).toMatchObject({
          level: "error",
          text: `forward cut short; server ${SERVER_A} unreachable: read ECONNRESET`,
          sessionId: SESSION_ID,
          agentId: undefined,
          skipSentry: false,
        });
        expect(fixed.log.lines[0]?.cause).toBeInstanceOf(Error);
      }),
  );

  it.effect("a route lookup that fails is 500 internal error with the driver's reason", () =>
    Effect.gen(function* () {
      const failure = Errors.DatabaseError.make({
        operation: "serverForSession",
        message: "Failed query: select from session_servers",
        cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      });
      const fixed = fixture(fleet, {
        store: Stores.fakeServerStore({ serverForSession: () => Effect.fail(failure) }),
      });
      yield* Effect.gen(function* () {
        const api = yield* proxyClient;
        const error = yield* Effect.flip(
          api.Sessions.image({ query: { id: SESSION_ID, agent: AGENT_ID } }),
        );
        expect(error).toMatchObject({ _tag: "Internal", message: "internal error" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.upstream.requests).toEqual([]);
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: `GET /image?id=${SESSION_ID}&agent=${AGENT_ID} failed: connect ECONNREFUSED 127.0.0.1:5432`,
          sessionId: SESSION_ID,
          agentId: AGENT_ID,
          skipSentry: false,
          cause: failure,
        },
      ]);
    }),
  );

  const everyRoute: ReadonlyArray<readonly [string, string, boolean]> = [
    ["POST", "/start", true],
    ["GET", `/image?id=${SESSION_ID}&agent=${AGENT_ID}`, false],
    ["GET", `/serial?id=${SESSION_ID}&agent=${AGENT_ID}`, false],
    ["GET", `/follow?id=${SESSION_ID}`, false],
    ["POST", "/stop", true],
    ["POST", "/send-keys", true],
    ["POST", "/send-mouse", true],
    ["POST", "/intent/start", true],
    ["POST", "/intent/end", true],
    ["POST", "/servers", true],
    ["DELETE", "/servers", true],
    ["GET", "/servers", false],
  ];

  const request = (
    http: HttpClient.HttpClient,
    method: string,
    path: string,
    hasBody: boolean,
    headers: Record<string, string>,
  ) => {
    const options = {
      headers,
      body: hasBody ? HttpBody.text("{}", "application/json") : undefined,
    };
    return method === "POST"
      ? http.post(path, options)
      : method === "DELETE"
        ? http.del(path, options)
        : http.get(path, options);
  };

  it.effect("every route refuses a missing or wrong bearer with 401 and one error line", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      fixed.store.servers.push(SERVER_A);
      fixed.store.routes.set(SESSION_ID, SERVER_A);
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        for (const [method, path, hasBody] of everyRoute) {
          const missing = yield* request(http, method, path, hasBody, {});
          expect(missing.status, `${method} ${path}`).toBe(401);
          expect(yield* missing.json).toEqual({ error: "unauthorized" });
          const wrong = yield* request(http, method, path, hasBody, {
            authorization: "Bearer wrong",
          });
          expect(wrong.status, `${method} ${path}`).toBe(401);
        }
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.upstream.requests).toEqual([]);
      expect(fixed.log.lines).toHaveLength(everyRoute.length * 2);
      expect(
        fixed.log.lines.every(
          (line) =>
            line.level === "error" &&
            line.text.endsWith(" failed: unauthorized") &&
            line.skipSentry,
        ),
      ).toBe(true);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect(
    "GET /stats, GET /images/:id and anything unrouted are 404 not found and never logged",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        fixed.store.servers.push(SERVER_A);
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const headers = { authorization: AUTHORIZATION };
          for (const path of ["/stats", `/images/${IMAGE_ID}`, "/nope"]) {
            const response = yield* http.get(path, { headers });
            expect(response.status, path).toBe(404);
            expect(yield* response.json).toEqual({ error: "not found" });
          }
          const noToken = yield* http.get("/stats");
          expect(noToken.status).toBe(404);
          const wrongMethod = yield* http.del("/start", { headers });
          expect(wrongMethod.status).toBe(404);
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.upstream.requests).toEqual([]);
        expect(fixed.log.lines).toEqual([]);
      }),
  );

  it.effect("a malformed body and a body failing the schema are 400 before any routing", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      fixed.store.routes.set(SESSION_ID, SERVER_A);
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const headers = { authorization: AUTHORIZATION };
        const malformed = yield* http.post("/send-keys", {
          headers,
          body: HttpBody.text("{bad", "application/json"),
        });
        expect(malformed.status).toBe(400);
        expect(yield* malformed.json).toEqual({ error: "Expected a valid JSON body" });
        const missingKeys = yield* http.post("/send-keys", {
          headers,
          body: HttpBody.jsonUnsafe({ id: SESSION_ID, agent: AGENT_ID }),
        });
        expect(missingKeys.status).toBe(400);
        expect(yield* missingKeys.json).toMatchObject({
          error: expect.stringContaining('["keys"]'),
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.upstream.requests).toEqual([]);
      expect(fixed.log.lines).toHaveLength(2);
      expect(fixed.log.lines[0]?.text).toBe("POST /send-keys failed: Expected a valid JSON body");
      expect(fixed.log.lines.every((line) => line.skipSentry)).toBe(true);
    }),
  );
});
