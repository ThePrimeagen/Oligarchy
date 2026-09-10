import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Layer, Redacted } from "effect";
import { HttpBody, HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/unstable/httpapi";
import { NodeHttpServer } from "@effect/platform-node";
import * as Handlers from "../../src/automation-client/handlers.ts";
import * as Runner from "../../src/automation-client/runner.ts";
import * as Runs from "../../src/automation-client/runs.ts";
import * as Config from "../../src/config.ts";
import * as Stats from "../../src/host/stats.ts";
import * as Log from "../../src/observability/log.ts";
import * as Api from "../../src/shared/api.ts";
import * as Contract from "../../src/shared/contract.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeRunner from "../support/fake-runner.ts";
import * as FakeStats from "../support/fake-stats.ts";
import * as FakeLog from "../support/log.ts";
import * as Reporter from "../support/reporter.ts";

const TOKEN = "test-token";
const KEY = "OLI-45";
const PROMPT = "drive the guest to the lock screen";
const BODY = Contract.RunBody.make({ key: KEY, prompt: PROMPT });

const ProxyConfigLive = Layer.succeed(Config.ProxyConfig)({
  token: Redacted.make(TOKEN),
  databaseUrl: Redacted.make("postgres://unused"),
});

const bearer = (token: string) =>
  HttpApiMiddleware.layerClient(Api.BearerAuth, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, token)),
  );

type Fixture = {
  readonly runner: FakeRunner.FakeRunner;
  readonly log: FakeLog.FakeLog;
  readonly reporter: Reporter.Collector;
};

const fixture = (options: { readonly runner?: FakeRunner.FakeRunner } = {}): Fixture => ({
  runner: options.runner ?? FakeRunner.fakeRunner({ name: "opencode", model: "fake-model" }),
  log: FakeLog.fakeLog(),
  reporter: Reporter.collect(),
});

const serve = (
  fixed: Fixture,
  runs: Layer.Layer<Runs.Runs, never, Runner.AgentRunner | Log.Log | Stats.Stats> = Runs.Runs.layer,
) =>
  HttpRouter.serve(Handlers.routes, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provide(runs),
    Layer.provide(
      Layer.mergeAll(fixed.runner.layer, FakeStats.fakeStats, fixed.log.layer, ProxyConfigLive),
    ),
    Layer.provide(Layer.succeed(Log.ProcessAttribution)(Log.AutomationClientProcessAttribution)),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(fixed.reporter.layer),
    Layer.provideMerge(bearer(TOKEN)),
  );

const client = HttpApiClient.make(Api.AutomationClientApi);

describe("POST /run happy path", () => {
  it.effect("answers 200 with model, session, text and elapsedMs", () =>
    Effect.gen(function* () {
      const fixed = fixture({
        runner: FakeRunner.fakeRunner({
          name: "opencode",
          model: "fake-model",
          script: () => ({ _tag: "succeed", outcome: { session: "ses_1", text: "done" } }),
        }),
      });
      yield* Effect.gen(function* () {
        const api = yield* client;
        const [body, response] = yield* api.Runs.run({
          payload: BODY,
          responseMode: "decoded-and-response",
        });
        expect(body).toEqual({
          model: "fake-model",
          session: "ses_1",
          text: "done",
          elapsedMs: 0,
        });
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual(body);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.runner.inputs).toEqual([{ key: KEY, prompt: PROMPT }]);
    }),
  );
});

describe("POST /run unhappy path", () => {
  it.effect(
    "a missing or wrong bearer is 401 unauthorized, attributed automation-client, skipSentry",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const missing = yield* http.post("/run", {
            body: HttpBody.jsonUnsafe(BODY),
          });
          expect(missing.status).toBe(401);
          expect(yield* missing.json).toEqual({ error: "unauthorized" });
          const wrong = yield* http.post("/run", {
            headers: { authorization: "Bearer wrong" },
            body: HttpBody.jsonUnsafe(BODY),
          });
          expect(wrong.status).toBe(401);
          expect(yield* wrong.json).toEqual({ error: "unauthorized" });
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.log.lines).toEqual([
          {
            level: "error",
            text: "POST /run failed: unauthorized",
            location: "automation-client",
            agentId: "automation-client",
            skipSentry: true,
            cause: undefined,
          },
          {
            level: "error",
            text: "POST /run failed: unauthorized",
            location: "automation-client",
            agentId: "automation-client",
            skipSentry: true,
            cause: undefined,
          },
        ]);
        expect(fixed.runner.inputs).toEqual([]);
        expect(fixed.reporter.reported).toEqual([]);
      }),
  );

  it.effect("an empty prompt or an empty key is 400", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const emptyPrompt = yield* http.post("/run", {
          headers: { authorization: `Bearer ${TOKEN}` },
          body: HttpBody.jsonUnsafe({ key: KEY, prompt: "" }),
        });
        expect(emptyPrompt.status).toBe(400);
        expect(yield* emptyPrompt.json).toMatchObject({ error: expect.stringContaining("prompt") });
        const emptyKey = yield* http.post("/run", {
          headers: { authorization: `Bearer ${TOKEN}` },
          body: HttpBody.jsonUnsafe({ key: "", prompt: PROMPT }),
        });
        expect(emptyKey.status).toBe(400);
        expect(yield* emptyKey.json).toMatchObject({ error: expect.stringContaining("key") });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.runner.inputs).toEqual([]);
      expect(fixed.log.lines.every((line) => line.skipSentry)).toBe(true);
    }),
  );

  it.effect("a RunFailed is 502 and one line under the run bucket with the cause reported", () =>
    Effect.gen(function* () {
      const cause = new Error("boom");
      const fixed = fixture({
        runner: FakeRunner.fakeRunner({
          script: () => ({
            _tag: "fail",
            error: Errors.RunFailed.make({
              message: "opencode: exited 1: boom",
              agentId: KEY,
              cause,
            }),
          }),
        }),
      });
      yield* Effect.gen(function* () {
        const api = yield* client;
        const error = yield* Effect.flip(api.Runs.run({ payload: BODY }));
        expect(error).toMatchObject({ _tag: "RunFailed", message: "opencode: exited 1: boom" });
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.post("/run", {
          headers: { authorization: `Bearer ${TOKEN}` },
          body: HttpBody.jsonUnsafe(BODY),
        });
        expect(raw.status).toBe(502);
        expect(yield* raw.json).toEqual({ error: "opencode: exited 1: boom" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines.filter((line) => line.text.startsWith("POST /run failed"))).toEqual([
        {
          level: "error",
          text: "POST /run failed: opencode: exited 1: boom",
          location: "automation-OLI-45",
          agentId: KEY,
          skipSentry: false,
          cause,
        },
        {
          level: "error",
          text: "POST /run failed: opencode: exited 1: boom",
          location: "automation-OLI-45",
          agentId: KEY,
          skipSentry: false,
          cause,
        },
      ]);
    }),
  );

  it.effect("a RunTimedOut is 504, attributed the same way", () =>
    Effect.gen(function* () {
      const timedOut = Errors.RunTimedOut.make({
        message: "opencode: no result within 2 hours",
        agentId: KEY,
      });
      const fixed = fixture();
      const stub = Layer.succeed(Runs.Runs)(
        Runs.Runs.of({
          run: () => timedOut,
          stats: Effect.die("Unexpected stats"),
        }),
      );
      yield* Effect.gen(function* () {
        const api = yield* client;
        const error = yield* Effect.flip(api.Runs.run({ payload: BODY }));
        expect(error).toMatchObject({
          _tag: "RunTimedOut",
          message: "opencode: no result within 2 hours",
        });
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.post("/run", {
          headers: { authorization: `Bearer ${TOKEN}` },
          body: HttpBody.jsonUnsafe(BODY),
        });
        expect(raw.status).toBe(504);
        expect(yield* raw.json).toEqual({ error: "opencode: no result within 2 hours" });
      }).pipe(Effect.provide(serve(fixed, stub)));
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: "POST /run failed: opencode: no result within 2 hours",
          location: "automation-OLI-45",
          agentId: KEY,
          skipSentry: false,
          cause: undefined,
        },
        {
          level: "error",
          text: "POST /run failed: opencode: no result within 2 hours",
          location: "automation-OLI-45",
          agentId: KEY,
          skipSentry: false,
          cause: undefined,
        },
      ]);
    }),
  );

  it.effect("/linear, /stats, /start, /servers and GET /run are 404 and never logged", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        for (const [method, path] of [
          ["POST", "/linear"],
          ["GET", "/stats"],
          ["POST", "/start"],
          ["GET", "/servers"],
          ["GET", "/run"],
        ] as const) {
          const response =
            method === "POST"
              ? yield* http.post(path, {
                  headers: { authorization: `Bearer ${TOKEN}` },
                  body: HttpBody.jsonUnsafe({}),
                })
              : yield* http.get(path, { headers: { authorization: `Bearer ${TOKEN}` } });
          expect(response.status, `${method} ${path}`).toBe(404);
          expect(yield* response.json).toEqual({ error: "not found" });
        }
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([]);
      expect(fixed.runner.inputs).toEqual([]);
    }),
  );

  it.effect("a runner defect is 500 internal error logged with its cause", () =>
    Effect.gen(function* () {
      const defect = new Error("boom");
      const fixed = fixture({
        runner: FakeRunner.fakeRunner({
          script: () => ({ _tag: "die", defect }),
        }),
      });
      yield* Effect.gen(function* () {
        const api = yield* client;
        const error = yield* Effect.flip(api.Runs.run({ payload: BODY }));
        expect(error).toMatchObject({ _tag: "Internal", message: "internal error" });
        const http = yield* HttpClient.HttpClient;
        const raw = yield* http.post("/run", {
          headers: { authorization: `Bearer ${TOKEN}` },
          body: HttpBody.jsonUnsafe(BODY),
        });
        expect(raw.status).toBe(500);
        expect(yield* raw.json).toEqual({ error: "internal error" });
      }).pipe(Effect.provide(serve(fixed)));
      const failed = fixed.log.lines.filter((line) => line.text.startsWith("POST /run failed"));
      expect(failed).toHaveLength(2);
      expect(failed[0]?.text).toBe(`POST /run failed: ${Cause.pretty(Cause.die(defect))}`);
      expect(failed[0]?.cause).toBe(defect);
      expect(failed[0]?.location).toBe("automation-client");
    }),
  );
});
