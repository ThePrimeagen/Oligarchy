import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import * as Handlers from "../../src/automation-client/handlers.ts";
import * as OpenCode from "../../src/automation-client/opencode.ts";
import * as Log from "../../src/observability/log.ts";
import * as Support from "../support/config.ts";
import * as FakeLog from "../support/log.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";
import * as Reporter from "../support/reporter.ts";

const TOKEN = "test-token";

type Fixture = {
  readonly spawner: FakeSpawner.FakeSpawner;
  readonly log: FakeLog.FakeLog;
  readonly reporter: Reporter.Collector;
};

const fixture = (script: FakeSpawner.Script = () => ({ exitCode: 0 })): Fixture => ({
  spawner: FakeSpawner.fakeSpawner(script),
  log: FakeLog.fakeLog(),
  reporter: Reporter.collect(),
});

const serve = (fixed: Fixture) =>
  HttpRouter.serve(Handlers.routes, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provide(Layer.mergeAll(fixed.spawner.layer, fixed.log.layer, Handlers.BearerAuthLive)),
    Layer.provide(Layer.succeed(Log.ProcessAttribution)(Log.AutomationClientProcessAttribution)),
    Layer.provide(Support.withEnv({ OLIGARCHY_TOKEN: TOKEN })),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(fixed.reporter.layer),
  );

const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

const run = (http: HttpClient.HttpClient, prompt = "do the work", extraHeaders = headers) =>
  http.post("/run", {
    headers: extraHeaders,
    body: HttpBody.text(JSON.stringify({ prompt }), "application/json"),
  });

describe("POST /run happy path", () => {
  it.effect("answers ok after opencode exits 0 and ignores its printout", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({ exitCode: 0, stdout: "the written result" }));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* run(http, "fix the bug");
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toMatchObject([
        { command: OpenCode.BIN, args: ["run", "fix the bug"] },
      ]);
      expect(fixed.log.lines).toEqual([]);
    }),
  );

  it.effect("waits until opencode exits before answering 200", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({}));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const pending = yield* Effect.forkChild(run(http));
        yield* Effect.yieldNow;
        expect(pending.pollUnsafe()).toBeUndefined();
        yield* fixed.spawner.spawned[0]?.exit(0) ?? Effect.void;
        const response = yield* Fiber.join(pending);
        expect(response.status).toBe(200);
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );
});

describe("POST /run authentication and decoding", () => {
  it.effect("refuses a missing bearer with 401 and one error line", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* run(http, "do the work", {
          "content-type": "application/json",
        });
        expect(response.status).toBe(401);
        expect(yield* response.json).toEqual({ error: "unauthorized" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toEqual([]);
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: "POST /run failed: unauthorized",
          location: "automation-client",
          agentId: "automation-client",
          skipSentry: true,
          cause: undefined,
        },
      ]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect("a wrong bearer is 401 too", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* run(http, "do the work", {
          authorization: "Bearer wrong",
          "content-type": "application/json",
        });
        expect(response.status).toBe(401);
        expect(yield* response.json).toEqual({ error: "unauthorized" });
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );

  it.effect("a body without prompt is 400", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/run", {
          headers,
          body: HttpBody.text("{}", "application/json"),
        });
        expect(response.status).toBe(400);
        expect((yield* response.json) as { error: string }).toMatchObject({
          error: expect.stringContaining("prompt") as string,
        });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toEqual([]);
    }),
  );
});

describe("POST /run unhappy path", () => {
  it.effect("returns 500 with the spawn error when opencode cannot be opened", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({ spawnError: "spawn opencode ENOENT" }));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* run(http);
        expect(response.status).toBe(500);
        expect(yield* response.json).toEqual({ error: "spawn opencode ENOENT" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines.map((line) => [line.level, line.text, line.skipSentry])).toEqual([
        ["error", "POST /run failed: spawn opencode ENOENT", false],
      ]);
    }),
  );

  it.effect("returns 500 with the error opencode printed when it exits non-zero", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({ exitCode: 1, stderr: "out of token credits\n" }));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* run(http);
        expect(response.status).toBe(500);
        expect(yield* response.json).toEqual({ error: "out of token credits" });
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );
});

describe("catch-all", () => {
  it.effect("GET /run and GET /nope are 404 not found and never logged", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        for (const path of ["/run", "/nope"]) {
          const response = yield* http.get(path, { headers: { authorization: `Bearer ${TOKEN}` } });
          expect(response.status).toBe(404);
          expect(yield* response.json).toEqual({ error: "not found" });
        }
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([]);
      expect(fixed.spawner.spawned).toEqual([]);
    }),
  );
});
