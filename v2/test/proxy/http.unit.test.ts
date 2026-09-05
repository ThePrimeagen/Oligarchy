import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Deferred, Effect, Fiber, Layer, Redacted, Stream } from "effect";
import {
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  type HttpClientResponse,
} from "effect/unstable/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/unstable/httpapi";
import { NodeHttpServer } from "@effect/platform-node";
import * as Config from "../../src/config.ts";
import * as Log from "../../src/observability/log.ts";
import * as Handlers from "../../src/proxy/handlers.ts";
import * as Api from "../../src/shared/api.ts";
import * as Contract from "../../src/shared/contract.ts";
import * as Domain from "../../src/shared/domain.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeSessions from "../support/fake-sessions.ts";
import * as FakeLog from "../support/log.ts";
import * as Reporter from "../support/reporter.ts";
import * as Stores from "../support/stores.ts";

const TOKEN = "test-token";
const { SESSION_ID, AGENT_ID, OTHER_AGENT_ID, STARTED_ID, IMAGE_ID } = FakeSessions;

const ProxyConfigLive = Layer.succeed(Config.ProxyConfig)({
  token: Redacted.make(TOKEN),
  databaseUrl: Redacted.make("postgres://unused"),
});

const bearer = (token: string) =>
  HttpApiMiddleware.layerClient(Api.BearerAuth, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, token)),
  );

type Fixture = {
  readonly sessions: FakeSessions.FakeSessions;
  readonly log: FakeLog.FakeLog;
  readonly actions: Stores.FakeActionStore;
  readonly reporter: Reporter.Collector;
};

const fixture = (overrides: Partial<Fixture> = {}): Fixture => ({
  sessions: FakeSessions.fakeSessions(),
  log: FakeLog.fakeLog(),
  actions: Stores.fakeActionStore(),
  reporter: Reporter.collect(),
  ...overrides,
});

// The proxy's routes on a real loopback server; the HttpClient in scope points at it.
const serve = (fixed: Fixture, log: Layer.Layer<Log.Log> = fixed.log.layer) =>
  HttpRouter.serve(Handlers.routes("none", false), {
    disableLogger: true,
    disableListenLog: true,
  }).pipe(
    Layer.provide(Layer.mergeAll(fixed.sessions.layer, log, fixed.actions.layer, ProxyConfigLive)),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(fixed.reporter.layer),
    Layer.provideMerge(bearer(TOKEN)),
  );

const client = HttpApiClient.make(Api.ProxyApi);

const decoder = new TextDecoder();

const bodyOf = (response: HttpClientResponse.HttpClientResponse) => response.json;

const stopBody = Contract.StopBody.make({ id: SESSION_ID, agent: AGENT_ID });

describe("Sessions endpoints happy path", () => {
  it.effect("POST /start answers the new id and hands display and automation to Sessions", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        const [started, response] = yield* api.Sessions.start({
          payload: Contract.StartBody.make({ iso: "omarchy.iso", agent: AGENT_ID }),
          responseMode: "decoded-and-response",
        });
        expect(started.id).toBe(STARTED_ID);
        expect(response.headers["content-type"]).toContain("application/json");
        expect(yield* response.text).toBe(`{"id":"${STARTED_ID}"}`);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.sessions.calls).toEqual([
        {
          method: "start",
          args: [Contract.StartBody.make({ iso: "omarchy.iso", agent: AGENT_ID }), "none", false],
        },
      ]);
      expect(fixed.log.lines).toEqual([]);
    }),
  );

  it.effect("GET /image returns image/png bytes with x-image-url after a lookup", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        const [image, response] = yield* api.Sessions.image({
          query: { id: SESSION_ID, agent: AGENT_ID },
          responseMode: "decoded-and-response",
        });
        expect([...image.body]).toEqual([...FakeSessions.PNG]);
        expect(image.headers["x-image-url"]).toBe(Contract.StoredImageUrl(IMAGE_ID));
        expect(response.headers["content-type"]).toBe("image/png");
        expect(response.headers["x-image-url"]).toBe(Contract.StoredImageUrl(IMAGE_ID));
      }).pipe(Effect.provide(serve(fixed)));
      expect(FakeSessions.methods(fixed.sessions)).toEqual(["lookup", "image"]);
      expect(fixed.sessions.calls[0]?.args).toEqual([SESSION_ID, AGENT_ID]);
    }),
  );

  it.effect("GET /serial returns text/plain bytes", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        const [serial, response] = yield* api.Sessions.serial({
          query: { id: SESSION_ID, agent: AGENT_ID },
          responseMode: "decoded-and-response",
        });
        expect(decoder.decode(serial)).toBe("omarchy login: ");
        expect(response.headers["content-type"]).toBe("text/plain");
      }).pipe(Effect.provide(serve(fixed)));
      expect(FakeSessions.methods(fixed.sessions)).toEqual(["lookup", "serial"]);
    }),
  );

  it.effect("GET /dump returns text/plain bytes without a lookup", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        const [dump, response] = yield* api.Sessions.dump({
          query: { id: SESSION_ID },
          responseMode: "decoded-and-response",
        });
        expect(decoder.decode(dump)).toBe("[    0.000000] Linux version 6.12\n");
        expect(response.headers["content-type"]).toBe("text/plain");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.sessions.calls).toEqual([{ method: "dump", args: [SESSION_ID] }]);
    }),
  );

  it.effect("GET /follow streams one NDJSON line per event without a lookup", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        const [stream, response] = yield* api.Sessions.follow({
          query: { id: SESSION_ID },
          responseMode: "decoded-and-response",
        });
        const text = yield* Stream.mkString(Stream.decodeText(stream));
        expect(text).toBe(FakeSessions.FOLLOW_EVENTS.map(Domain.encodeFollowLine).join(""));
        expect(text.split("\n")).toEqual([
          '{"type":"session","status":"running"}',
          '{"type":"action","id":1,"name":"send-keys","state":"running"}',
          '{"type":"session","status":"succeeded"}',
          "",
        ]);
        expect(response.headers["content-type"]).toBe("application/x-ndjson");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.sessions.calls).toEqual([{ method: "follow", args: [SESSION_ID] }]);
    }),
  );

  it.effect("GET /stats answers the Stats shape", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        const [stats, response] = yield* api.Sessions.stats({
          responseMode: "decoded-and-response",
        });
        expect(stats).toEqual(FakeSessions.STATS);
        expect(yield* bodyOf(response)).toEqual({
          qemus: 1,
          memory: { totalBytes: 16_000, usedBytes: 4_000, freeBytes: 12_000 },
          cpu: { cores: 4, mean: 20.5, p10: 19.8, p25: 20.1, p75: 20.9, p90: 21.1 },
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(FakeSessions.methods(fixed.sessions)).toEqual(["stats"]);
    }),
  );

  it.effect("POST /stop answers the string ok and forwards status and reason", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        const [ok, response] = yield* api.Sessions.stop({
          payload: Contract.StopBody.make({
            id: SESSION_ID,
            agent: AGENT_ID,
            status: "succeeded",
            reason: "done",
          }),
          responseMode: "decoded-and-response",
        });
        expect(ok.ok).toBe("true");
        expect(yield* response.text).toBe('{"ok":"true"}');
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.sessions.calls[1]).toEqual({
        method: "stop",
        args: [SESSION_ID, "succeeded", "done"],
      });
    }),
  );

  it.effect("POST /stop without a verdict forwards undefined status and reason", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        yield* api.Sessions.stop({ payload: stopBody });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.sessions.calls[1]).toEqual({
        method: "stop",
        args: [SESSION_ID, undefined, undefined],
      });
    }),
  );

  it.effect("POST /send-keys hands the keys and the encoding, present or absent, to Sessions", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        const ok = yield* api.Sessions.sendKeys({
          payload: Contract.SendKeysBody.make({
            id: SESSION_ID,
            keys: "ls<ENTER>",
            agent: AGENT_ID,
          }),
        });
        expect(ok).toEqual(Contract.Ok.make({}));
        yield* api.Sessions.sendKeys({
          payload: Contract.SendKeysBody.make({
            id: SESSION_ID,
            keys: "a",
            encoding: "OLIGARCHY",
            agent: AGENT_ID,
          }),
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.sessions.calls[1]).toEqual({
        method: "sendKeys",
        args: [SESSION_ID, "ls<ENTER>", undefined],
      });
      expect(fixed.sessions.calls[3]).toEqual({
        method: "sendKeys",
        args: [SESSION_ID, "a", "OLIGARCHY"],
      });
    }),
  );

  it.effect("POST /send-mouse forwards the whole body", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const body = Contract.SendMouseBody.make({
        id: SESSION_ID,
        x: 0.5,
        y: 0.25,
        button: "left",
        clicks: 2,
        agent: AGENT_ID,
      });
      yield* Effect.gen(function* () {
        const api = yield* client;
        const ok = yield* api.Sessions.sendMouse({ payload: body });
        expect(ok.ok).toBe("true");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.sessions.calls[1]).toEqual({ method: "sendMouse", args: [SESSION_ID, body] });
    }),
  );

  it.effect("POST /intent/start and /intent/end forward their fields", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        yield* api.Sessions.intentStart({
          payload: Contract.IntentStartBody.make({
            id: SESSION_ID,
            agent: AGENT_ID,
            test_result_id: "result-1",
            message: "open a terminal",
          }),
        });
        yield* api.Sessions.intentEnd({
          payload: Contract.IntentEndBody.make({ id: SESSION_ID, agent: AGENT_ID }),
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(FakeSessions.methods(fixed.sessions)).toEqual([
        "lookup",
        "intentStart",
        "lookup",
        "intentEnd",
      ]);
      expect(fixed.sessions.calls[1]?.args).toEqual([SESSION_ID, "result-1", "open a terminal"]);
      expect(fixed.sessions.calls[3]?.args).toEqual([SESSION_ID]);
    }),
  );
});

describe("Images endpoint", () => {
  it.effect("GET /images/<uuid> serves the stored PNG without a token", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      fixed.actions.images.push({ id: IMAGE_ID, actionId: 1, data: FakeSessions.PNG });
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.get(`/images/${IMAGE_ID}`);
        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toBe("image/png");
        expect([...new Uint8Array(yield* response.arrayBuffer)]).toEqual([...FakeSessions.PNG]);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([]);
    }),
  );

  it.effect("GET /images/<non-uuid> and an unknown uuid are 404 not found", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        for (const id of ["nope", "00000000-0000-4000-8000-000000000000"]) {
          const response = yield* http.get(`/images/${id}`);
          expect(response.status).toBe(404);
          expect(yield* response.json).toEqual({ error: "not found" });
        }
        const api = yield* client;
        const error = yield* Effect.flip(api.Images.storedImage({ params: { id: "nope" } }));
        expect(error._tag).toBe("NotFound");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines.map((line) => line.text)).toEqual([
        "GET /images/nope failed: not found",
        "GET /images/00000000-0000-4000-8000-000000000000 failed: not found",
        "GET /images/nope failed: not found",
      ]);
      expect(fixed.log.lines.every((line) => line.skipSentry)).toBe(true);
    }),
  );
});

describe("authentication", () => {
  const sessionsRoutes: ReadonlyArray<readonly [string, string, boolean]> = [
    ["POST", "/start", true],
    ["GET", "/image?id=x&agent=y", false],
    ["GET", "/serial?id=x&agent=y", false],
    ["GET", "/dump?id=x", false],
    ["GET", "/follow?id=x", false],
    ["GET", "/stats", false],
    ["POST", "/stop", true],
    ["POST", "/send-keys", true],
    ["POST", "/send-mouse", true],
    ["POST", "/intent/start", true],
    ["POST", "/intent/end", true],
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
    return method === "POST" ? http.post(path, options) : http.get(path, options);
  };

  it.effect("every Sessions endpoint refuses a missing bearer with 401 and one error line", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        for (const [method, path, hasBody] of sessionsRoutes) {
          const response = yield* request(http, method, path, hasBody, {});
          expect(response.status).toBe(401);
          expect(yield* response.json).toEqual({ error: "unauthorized" });
        }
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual(
        sessionsRoutes.map(([method, path]) => ({
          level: "error",
          text: `${method} ${path} failed: unauthorized`,
          sessionId: undefined,
          agentId: undefined,
          skipSentry: true,
          cause: undefined,
        })),
      );
      expect(fixed.sessions.calls).toEqual([]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect("a wrong bearer and a non-bearer scheme are 401 too", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        for (const authorization of ["Bearer wrong", "Basic dGVzdC10b2tlbg==", "test-token"]) {
          const response = yield* http.get("/stats", { headers: { authorization } });
          expect(response.status).toBe(401);
          expect(yield* response.json).toEqual({ error: "unauthorized" });
        }
        const api = yield* client.pipe(Effect.provide(bearer("wrong")));
        const error = yield* Effect.flip(api.Sessions.stats());
        expect(error._tag).toBe("Unauthorized");
        expect(error.message).toBe("unauthorized");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines.map((line) => line.text)).toEqual([
        "GET /stats failed: unauthorized",
        "GET /stats failed: unauthorized",
        "GET /stats failed: unauthorized",
        "GET /stats failed: unauthorized",
      ]);
    }),
  );

  it.effect("the exact token is accepted with any scheme casing", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.get("/stats", {
          headers: { authorization: `bearer ${TOKEN}` },
        });
        expect(response.status).toBe(200);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([]);
    }),
  );
});

describe("catch-all", () => {
  it.effect("GET /nope and DELETE /start are 404 not found and never logged", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const headers = { authorization: `Bearer ${TOKEN}` };
        const missing = yield* http.get("/nope", { headers });
        expect(missing.status).toBe(404);
        expect(yield* missing.json).toEqual({ error: "not found" });
        const wrongMethod = yield* http.del("/start", { headers });
        expect(wrongMethod.status).toBe(404);
        expect(yield* wrongMethod.json).toEqual({ error: "not found" });
        const noToken = yield* http.get("/nope");
        expect(noToken.status).toBe(404);
        expect(yield* noToken.json).toEqual({ error: "not found" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([]);
      expect(fixed.sessions.calls).toEqual([]);
    }),
  );
});

describe("request decoding", () => {
  const headers = { authorization: `Bearer ${TOKEN}` };

  it.effect("a malformed JSON body is 400 Expected a valid JSON body", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/start", {
          headers,
          body: HttpBody.text("{bad", "application/json"),
        });
        expect(response.status).toBe(400);
        expect(yield* response.json).toEqual({ error: "Expected a valid JSON body" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: "POST /start failed: Expected a valid JSON body",
          sessionId: undefined,
          agentId: undefined,
          skipSentry: true,
          cause: undefined,
        },
      ]);
      expect(fixed.sessions.calls).toEqual([]);
    }),
  );

  it.effect("a body failing the schema is 400 with the schema message", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/start", {
          headers,
          body: HttpBody.jsonUnsafe({ iso: "omarchy.iso" }),
        });
        expect(response.status).toBe(400);
        expect(yield* response.json).toMatchObject({
          error: expect.stringContaining('["agent"]'),
        });
        const mouse = yield* http.post("/send-mouse", {
          headers,
          body: HttpBody.jsonUnsafe({ id: SESSION_ID, x: "half", y: 0.5, agent: AGENT_ID }),
        });
        expect(mouse.status).toBe(400);
        expect(yield* mouse.json).toMatchObject({ error: expect.stringContaining('["x"]') });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toHaveLength(2);
      expect(fixed.log.lines[0]?.text).toMatch(/^POST \/start failed: .*\["agent"\]/s);
      expect(fixed.log.lines[1]?.text).toMatch(/^POST \/send-mouse failed: .*\["x"\]/s);
      expect(fixed.log.lines.every((line) => line.skipSentry)).toBe(true);
      expect(fixed.sessions.calls).toEqual([]);
    }),
  );

  it.effect("a query without agent is 400 before any lookup", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        for (const path of [`/image?id=${SESSION_ID}`, `/serial?id=${SESSION_ID}`]) {
          const response = yield* http.get(path, { headers });
          expect(response.status).toBe(400);
          expect(yield* response.json).toMatchObject({
            error: expect.stringContaining('["agent"]'),
          });
        }
        const empty = yield* http.get(`/image?id=${SESSION_ID}&agent=`, { headers });
        expect(empty.status).toBe(400);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.sessions.calls).toEqual([]);
      expect(fixed.log.lines).toHaveLength(3);
      expect(fixed.log.lines[0]?.text.startsWith(`GET /image?id=${SESSION_ID} failed: `)).toBe(
        true,
      );
    }),
  );

  it.effect("an empty id reaches Sessions.lookup and is 400 session id is required", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        const error = yield* Effect.flip(
          api.Sessions.serial({ query: { id: "", agent: AGENT_ID } }),
        );
        expect(error).toMatchObject({ _tag: "BadRequest", message: "session id is required" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: `GET /serial?id=&agent=${AGENT_ID} failed: session id is required`,
          sessionId: undefined,
          agentId: AGENT_ID,
          skipSentry: true,
          cause: undefined,
        },
      ]);
    }),
  );
});

describe("Sessions failures", () => {
  it.effect("an unknown session is 404 with the id attributed only when it is a uuid", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      const unknown = "00000000-0000-4000-8000-000000000000";
      yield* Effect.gen(function* () {
        const api = yield* client;
        const byUuid = yield* Effect.flip(
          api.Sessions.serial({ query: { id: unknown, agent: AGENT_ID } }),
        );
        expect(byUuid).toMatchObject({
          _tag: "UnknownSession",
          message: `unknown session "${unknown}"`,
        });
        const byName = yield* Effect.flip(
          api.Sessions.stop({
            payload: Contract.StopBody.make({ id: "garbage", agent: AGENT_ID }),
          }),
        );
        expect(byName).toMatchObject({
          _tag: "UnknownSession",
          message: 'unknown session "garbage"',
        });
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.get(`/dump?id=${unknown}`, {
          headers: { authorization: `Bearer ${TOKEN}` },
        });
        expect(raw.status).toBe(404);
        expect(yield* raw.json).toEqual({ error: `unknown session "${unknown}"` });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: `GET /serial?id=${unknown}&agent=${AGENT_ID} failed: unknown session "${unknown}"`,
          sessionId: unknown,
          agentId: AGENT_ID,
          skipSentry: true,
          cause: undefined,
        },
        {
          level: "error",
          text: 'POST /stop failed: unknown session "garbage"',
          sessionId: undefined,
          agentId: AGENT_ID,
          skipSentry: true,
          cause: undefined,
        },
        {
          level: "error",
          text: `GET /dump?id=${unknown} failed: unknown session "${unknown}"`,
          sessionId: unknown,
          agentId: undefined,
          skipSentry: true,
          cause: undefined,
        },
      ]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect("another agent's session is 403 attributed to both", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const api = yield* client;
        const error = yield* Effect.flip(
          api.Sessions.sendKeys({
            payload: Contract.SendKeysBody.make({
              id: SESSION_ID,
              keys: "a",
              agent: OTHER_AGENT_ID,
            }),
          }),
        );
        expect(error).toMatchObject({
          _tag: "Forbidden",
          message: `agent "${OTHER_AGENT_ID}" does not own session "${SESSION_ID}"`,
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: `POST /send-keys failed: agent "${OTHER_AGENT_ID}" does not own session "${SESSION_ID}"`,
          sessionId: SESSION_ID,
          agentId: OTHER_AGENT_ID,
          skipSentry: true,
          cause: undefined,
        },
      ]);
      expect(FakeSessions.methods(fixed.sessions)).toEqual(["lookup"]);
    }),
  );

  it.effect("a Conflict from follow or dump is 409 with its message", () =>
    Effect.gen(function* () {
      const conflict = Errors.Conflict.make({
        message: `session "${SESSION_ID}" is not running on this proxy`,
        sessionId: SESSION_ID,
      });
      const fixed = fixture({
        sessions: FakeSessions.fakeSessions({
          follow: () => Effect.fail(conflict),
          dump: () =>
            Effect.fail(
              Errors.Conflict.make({
                message: `session "${SESSION_ID}" has no console on this proxy`,
                sessionId: SESSION_ID,
              }),
            ),
        }),
      });
      yield* Effect.gen(function* () {
        const api = yield* client;
        const followed = yield* Effect.flip(api.Sessions.follow({ query: { id: SESSION_ID } }));
        expect(followed).toMatchObject({ _tag: "Conflict", message: conflict.message });
        const dumped = yield* Effect.flip(api.Sessions.dump({ query: { id: SESSION_ID } }));
        expect(dumped).toMatchObject({
          _tag: "Conflict",
          message: `session "${SESSION_ID}" has no console on this proxy`,
        });
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.get(`/follow?id=${SESSION_ID}`, {
          headers: { authorization: `Bearer ${TOKEN}` },
        });
        expect(raw.status).toBe(409);
        expect(yield* raw.json).toEqual({ error: conflict.message });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines.map((line) => [line.text, line.sessionId, line.skipSentry])).toEqual([
        [`GET /follow?id=${SESSION_ID} failed: ${conflict.message}`, SESSION_ID, true],
        [
          `GET /dump?id=${SESSION_ID} failed: session "${SESSION_ID}" has no console on this proxy`,
          SESSION_ID,
          true,
        ],
        [`GET /follow?id=${SESSION_ID} failed: ${conflict.message}`, SESSION_ID, true],
      ]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect("a BadRequest from a driving method is 400 and skips Sentry", () =>
    Effect.gen(function* () {
      const fixed = fixture({
        sessions: FakeSessions.fakeSessions({
          sendMouse: (live) =>
            Effect.fail(
              Errors.BadRequest.make({
                message: "mouse: x and y must be in 0..1",
                sessionId: live.id,
                agentId: live.agent,
              }),
            ),
          intentEnd: (live) =>
            Effect.fail(
              Errors.BadRequest.make({
                message: "no active intent",
                sessionId: live.id,
                agentId: live.agent,
              }),
            ),
        }),
      });
      yield* Effect.gen(function* () {
        const api = yield* client;
        const mouse = yield* Effect.flip(
          api.Sessions.sendMouse({
            payload: Contract.SendMouseBody.make({ id: SESSION_ID, x: 2, y: 0.5, agent: AGENT_ID }),
          }),
        );
        expect(mouse).toMatchObject({
          _tag: "BadRequest",
          message: "mouse: x and y must be in 0..1",
        });
        const intent = yield* Effect.flip(
          api.Sessions.intentEnd({
            payload: Contract.IntentEndBody.make({ id: SESSION_ID, agent: AGENT_ID }),
          }),
        );
        expect(intent).toMatchObject({ _tag: "BadRequest", message: "no active intent" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: "POST /send-mouse failed: mouse: x and y must be in 0..1",
          sessionId: SESSION_ID,
          agentId: AGENT_ID,
          skipSentry: true,
          cause: undefined,
        },
        {
          level: "error",
          text: "POST /intent/end failed: no active intent",
          sessionId: SESSION_ID,
          agentId: AGENT_ID,
          skipSentry: true,
          cause: undefined,
        },
      ]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect("an ExchangeFailed is 502 with its cause on the log line; the log line reports", () =>
    Effect.gen(function* () {
      const timeout = Errors.QmpTimeout.make({ command: "screendump" });
      const fixed = fixture({
        sessions: FakeSessions.fakeSessions({
          image: (live) =>
            Effect.fail(
              Errors.ExchangeFailed.make({
                message: timeout.message,
                cause: timeout,
                sessionId: live.id,
                agentId: live.agent,
              }),
            ),
        }),
      });
      yield* Effect.gen(function* () {
        const api = yield* client;
        const error = yield* Effect.flip(
          api.Sessions.image({ query: { id: SESSION_ID, agent: AGENT_ID } }),
        );
        expect(error).toMatchObject({
          _tag: "ExchangeFailed",
          message: "qemu: screendump timed out",
        });
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.get(`/image?id=${SESSION_ID}&agent=${AGENT_ID}`, {
          headers: { authorization: `Bearer ${TOKEN}` },
        });
        expect(raw.status).toBe(502);
        expect(yield* raw.json).toEqual({ error: "qemu: screendump timed out" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: `GET /image?id=${SESSION_ID}&agent=${AGENT_ID} failed: qemu: screendump timed out`,
          sessionId: SESSION_ID,
          agentId: AGENT_ID,
          skipSentry: false,
          cause: timeout,
        },
        {
          level: "error",
          text: `GET /image?id=${SESSION_ID}&agent=${AGENT_ID} failed: qemu: screendump timed out`,
          sessionId: SESSION_ID,
          agentId: AGENT_ID,
          skipSentry: false,
          cause: timeout,
        },
      ]);
      // Every API error is ErrorReporter.ignore'd; the Log line above is the one report (see the
      // real-Log test below), so a faked Log leaves the reporter untouched.
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect("a StartFailed without a cause is 502 and logged without a cause", () =>
    Effect.gen(function* () {
      const fixed = fixture({
        sessions: FakeSessions.fakeSessions({
          start: (body) =>
            Effect.fail(
              Errors.StartFailed.make({
                message: "qemu: disk not found: /tmp/nope.qcow2",
                sessionId: STARTED_ID,
                agentId: body.agent,
              }),
            ),
        }),
      });
      yield* Effect.gen(function* () {
        const api = yield* client;
        const error = yield* Effect.flip(
          api.Sessions.start({
            payload: Contract.StartBody.make({
              iso: "omarchy.iso",
              disk: "/tmp/nope.qcow2",
              agent: AGENT_ID,
            }),
          }),
        );
        expect(error).toMatchObject({
          _tag: "StartFailed",
          message: "qemu: disk not found: /tmp/nope.qcow2",
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: "POST /start failed: qemu: disk not found: /tmp/nope.qcow2",
          sessionId: STARTED_ID,
          agentId: AGENT_ID,
          skipSentry: false,
          cause: undefined,
        },
      ]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect(
    "an Internal raised by Sessions is 500 internal error with the cause's message logged",
    () =>
      Effect.gen(function* () {
        const failure = Errors.DatabaseError.make({
          operation: "endSession",
          message: "Failed query: update sessions",
          cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        });
        const fixed = fixture({
          sessions: FakeSessions.fakeSessions({
            stop: (live) =>
              Effect.fail(
                Errors.Internal.make({
                  message: "internal error",
                  cause: failure,
                  sessionId: live.id,
                  agentId: live.agent,
                }),
              ),
          }),
        });
        yield* Effect.gen(function* () {
          const api = yield* client;
          const error = yield* Effect.flip(api.Sessions.stop({ payload: stopBody }));
          expect(error).toMatchObject({ _tag: "Internal", message: "internal error" });
          const http = yield* HttpClient.HttpClient;
          const raw = yield* http.post("/stop", {
            headers: { authorization: `Bearer ${TOKEN}` },
            body: HttpBody.jsonUnsafe(stopBody),
          });
          expect(raw.status).toBe(500);
          expect(yield* raw.json).toEqual({ error: "internal error" });
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.log.lines[0]).toEqual({
          level: "error",
          text: "POST /stop failed: Failed query: update sessions",
          sessionId: SESSION_ID,
          agentId: AGENT_ID,
          skipSentry: false,
          cause: failure,
        });
        expect(fixed.reporter.reported).toEqual([]);
      }),
  );
});

describe("defects", () => {
  it.effect("a handler defect is 500 internal error, logged with the pretty cause", () =>
    Effect.gen(function* () {
      const defect = new Error("boom");
      const fixed = fixture({
        sessions: FakeSessions.fakeSessions({ stats: Effect.die(defect) }),
      });
      yield* Effect.gen(function* () {
        const api = yield* client;
        const error = yield* Effect.flip(api.Sessions.stats());
        expect(error).toMatchObject({ _tag: "Internal", message: "internal error" });
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.get("/stats", { headers: { authorization: `Bearer ${TOKEN}` } });
        expect(raw.status).toBe(500);
        expect(yield* raw.json).toEqual({ error: "internal error" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toHaveLength(2);
      expect(fixed.log.lines[0]).toEqual({
        level: "error",
        text: `GET /stats failed: ${Cause.pretty(Cause.die(defect))}`,
        sessionId: undefined,
        agentId: undefined,
        skipSentry: false,
        cause: defect,
      });
      expect(fixed.log.lines[0]?.text).toContain("Error: boom");
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect("the real Log reports a 5xx cause and a defect to the reporter, never a 4xx", () =>
    Effect.gen(function* () {
      const defect = new Error("kaboom");
      const failure = new Error("connect ECONNREFUSED 127.0.0.1:5432");
      const fixed = fixture({
        sessions: FakeSessions.fakeSessions({
          stats: Effect.die(defect),
          serial: (live) =>
            Effect.fail(
              Errors.Internal.make({
                message: "internal error",
                cause: failure,
                sessionId: live.id,
                agentId: live.agent,
              }),
            ),
        }),
      });
      const stdout = Log.Log.layerStdout.pipe(Layer.provide(fixed.reporter.layer));
      yield* Effect.gen(function* () {
        const api = yield* client;
        yield* Effect.flip(api.Sessions.stats());
        yield* Effect.flip(api.Sessions.serial({ query: { id: SESSION_ID, agent: AGENT_ID } }));
        yield* Effect.flip(api.Sessions.serial({ query: { id: "nope", agent: AGENT_ID } }));
        const wrong = yield* client.pipe(Effect.provide(bearer("wrong")));
        yield* Effect.flip(wrong.Sessions.serial({ query: { id: SESSION_ID, agent: AGENT_ID } }));
      }).pipe(Effect.provide(serve(fixed, stdout)));
      const messages = fixed.reporter.reported.map((report) => report.error.message);
      expect(messages).toContain("kaboom");
      expect(messages).toContain("connect ECONNREFUSED 127.0.0.1:5432");
      expect(messages).not.toContain('unknown session "nope"');
      expect(messages).not.toContain("unauthorized");
      const withSession = fixed.reporter.reported.find(
        (report) => report.error.message === "connect ECONNREFUSED 127.0.0.1:5432",
      );
      expect(withSession?.annotations).toMatchObject({
        session_id: SESSION_ID,
        agent_id: AGENT_ID,
      });
    }),
  );
});

describe("interruption", () => {
  it.live("POST /start completes even when the client disconnects mid-start", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const finished = yield* Deferred.make<void>();
      const fixed = fixture({
        sessions: FakeSessions.fakeSessions({
          start: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
              yield* Deferred.succeed(finished, undefined);
              return STARTED_ID;
            }),
        }),
      });
      yield* Effect.gen(function* () {
        const api = yield* client;
        const request = yield* Effect.forkChild(
          api.Sessions.start({
            payload: Contract.StartBody.make({ iso: "omarchy.iso", agent: AGENT_ID }),
          }),
        );
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(request);
        yield* Effect.sleep("50 millis");
        yield* Deferred.succeed(release, undefined);
        yield* Deferred.await(finished);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([]);
    }),
  );
});
