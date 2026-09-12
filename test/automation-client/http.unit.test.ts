import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Layer, Redacted, Schema } from "effect";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import * as Handlers from "../../src/automation-client/handlers.ts";
import * as OpenCode from "../../src/automation-client/opencode.ts";
import * as Sessions from "../../src/automation-client/sessions.ts";
import * as Config from "../../src/config.ts";
import * as Log from "../../src/observability/log.ts";
import * as FakeLog from "../support/log.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";
import * as Reporter from "../support/reporter.ts";

const TOKEN = "test-token";
const TICKET = "OLI-42";

const ProxyConfigLive = Layer.succeed(Config.ProxyConfig)({
  token: Redacted.make(TOKEN),
  databaseUrl: Redacted.make("postgres://unused"),
});

type Fixture = {
  readonly spawner: FakeSpawner.FakeSpawner;
  readonly log: FakeLog.FakeLog;
  readonly reporter: Reporter.Collector;
  readonly maxJobs: number;
};

// Room for the two runs some tests hold at once; the capacity test passes 1.
const MAX_JOBS = 2;

const fixture = (
  script: FakeSpawner.Script = () => ({ exitCode: 0 }),
  maxJobs = MAX_JOBS,
): Fixture => ({
  spawner: FakeSpawner.fakeSpawner(script),
  log: FakeLog.fakeLog(),
  reporter: Reporter.collect(),
  maxJobs,
});

const qemuOk = (): Sessions.ReserveQemu => () => Effect.void;

const serve = (fixed: Fixture) =>
  HttpRouter.serve(Handlers.routes, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provide(Sessions.Sessions.layer(fixed.maxJobs, qemuOk(), () => Effect.void)),
    Layer.provide(Layer.mergeAll(fixed.spawner.layer, fixed.log.layer, ProxyConfigLive)),
    Layer.provide(Layer.succeed(Log.ProcessAttribution)(Log.AutomationClientProcessAttribution)),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(fixed.reporter.layer),
  );

const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

const decodeErrorBody = Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String }));

const reserve = (
  http: HttpClient.HttpClient,
  ticket = TICKET,
  extraHeaders: Record<string, string> = headers,
) =>
  http.post("/reserve", {
    headers: extraHeaders,
    body: HttpBody.text(JSON.stringify({ ticket }), "application/json"),
  });

const run = (
  http: HttpClient.HttpClient,
  prompt = "do the work",
  extraHeaders: Record<string, string> = headers,
  ticket = TICKET,
) =>
  http.post("/run", {
    headers: extraHeaders,
    body: HttpBody.text(JSON.stringify({ prompt, ticket }), "application/json"),
  });

const abort = (
  http: HttpClient.HttpClient,
  ticket = TICKET,
  extraHeaders: Record<string, string> = headers,
) =>
  http.post("/abort", {
    headers: extraHeaders,
    body: HttpBody.text(JSON.stringify({ ticket }), "application/json"),
  });

const reservedRun = (
  http: HttpClient.HttpClient,
  prompt = "do the work",
  extraHeaders: Record<string, string> = headers,
  ticket = TICKET,
) =>
  Effect.gen(function* () {
    const reserved = yield* reserve(http, ticket, extraHeaders);
    expect(reserved.status).toBe(200);
    return yield* run(http, prompt, extraHeaders, ticket);
  });

describe("POST /reserve happy path", () => {
  it.effect("answers ok and does not spawn opencode", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({ exitCode: 0 }));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* reserve(http);
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toEqual([]);
      expect(fixed.log.lines).toEqual([]);
    }),
  );
});

describe("POST /run happy path", () => {
  it.effect("answers ok after opencode exits 0 and ignores its printout", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({ exitCode: 0, stdout: "the written result" }));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* reservedRun(http, "fix the bug");
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toMatchObject([
        { command: OpenCode.BIN, args: ["run", "--", "fix the bug"] },
      ]);
      expect(fixed.log.lines).toEqual([]);
    }),
  );

  it.effect("waits until opencode exits before answering 200", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({}));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* reserve(http)).status).toBe(200);
        const pending = yield* Effect.forkChild(run(http));
        for (let i = 0; i < 100 && fixed.spawner.spawned[0] === undefined; i++) {
          yield* Effect.yieldNow;
        }
        expect(fixed.spawner.spawned[0]).toBeDefined();
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
          body: HttpBody.text(JSON.stringify({ ticket: TICKET }), "application/json"),
        });
        expect(response.status).toBe(400);
        const body = decodeErrorBody(yield* response.json);
        expect(body.error).toContain("prompt");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toEqual([]);
    }),
  );

  it.effect("a body without ticket is 400", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/run", {
          headers,
          body: HttpBody.text(JSON.stringify({ prompt: "do the work" }), "application/json"),
        });
        expect(response.status).toBe(400);
        const body = decodeErrorBody(yield* response.json);
        expect(body.error).toContain("ticket");
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
        const response = yield* reservedRun(http);
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
        const response = yield* reservedRun(http);
        expect(response.status).toBe(500);
        expect(yield* response.json).toEqual({ error: "out of token credits" });
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );

  it.effect("a reserve past --max-jobs is 503 at capacity and spawns nothing", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({}), 1);
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* reserve(http)).status).toBe(200);
        const refused = yield* reserve(http, "OLI-99");
        expect(refused.status).toBe(503);
        expect(yield* refused.json).toEqual({ error: "at capacity: max-jobs is 1" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toEqual([]);
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: "POST /reserve failed: at capacity: max-jobs is 1",
          location: "automation-client",
          agentId: "OLI-99",
          skipSentry: false,
          cause: undefined,
        },
      ]);
      expect(fixed.reporter.reported).toEqual([]);
    }),
  );

  it.effect("a run without a reservation is 400 no reservation and spawns nothing", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({}), 1);
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const refused = yield* run(http, "first");
        expect(refused.status).toBe(400);
        expect(yield* refused.json).toEqual({ error: "no reservation" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toEqual([]);
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: "POST /run failed: no reservation",
          location: "automation-client",
          agentId: TICKET,
          skipSentry: true,
          cause: undefined,
        },
      ]);
    }),
  );

  it.effect(
    "a reserve past --max-jobs is 503 at capacity while a reserved run is in flight, and is taken once it ends",
    () =>
      Effect.gen(function* () {
        const fixed = fixture(() => ({}), 1);
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          expect((yield* reserve(http)).status).toBe(200);
          const pending = yield* Effect.forkChild(run(http, "first"));
          for (let i = 0; i < 100 && fixed.spawner.spawned[0] === undefined; i++) {
            yield* Effect.yieldNow;
          }
          const refused = yield* reserve(http, "OLI-99");
          expect(refused.status).toBe(503);
          expect(yield* refused.json).toEqual({ error: "at capacity: max-jobs is 1" });
          expect((yield* run(http, "second", headers, "OLI-99")).status).toBe(400);
          expect(fixed.spawner.spawned).toHaveLength(1);
          yield* fixed.spawner.spawned[0]?.exit(0) ?? Effect.void;
          expect((yield* Fiber.join(pending)).status).toBe(200);
          expect((yield* reserve(http, "OLI-99")).status).toBe(200);
          const accepted = yield* Effect.forkChild(run(http, "second", headers, "OLI-99"));
          for (let i = 0; i < 100 && fixed.spawner.spawned.length < 2; i++) {
            yield* Effect.yieldNow;
          }
          expect(fixed.spawner.spawned.map((spawned) => spawned.args[2])).toEqual([
            "first",
            "second",
          ]);
          yield* fixed.spawner.spawned[1]?.exit(0) ?? Effect.void;
          expect((yield* Fiber.join(accepted)).status).toBe(200);
        }).pipe(Effect.provide(serve(fixed)));
        // The refusal names the ticket it turned away; a 503 is the dispatcher's problem to place
        // elsewhere, so unlike a 4xx it reaches Sentry.
        expect(fixed.log.lines).toEqual([
          {
            level: "error",
            text: "POST /reserve failed: at capacity: max-jobs is 1",
            location: "automation-client",
            agentId: "OLI-99",
            skipSentry: false,
            cause: undefined,
          },
          {
            level: "error",
            text: "POST /run failed: no reservation",
            location: "automation-client",
            agentId: "OLI-99",
            skipSentry: true,
            cause: undefined,
          },
        ]);
        expect(fixed.reporter.reported).toEqual([]);
      }),
  );
});

describe("interruption", () => {
  it.effect("POST /run finishes opencode even when the client disconnects mid-run", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({}));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* reserve(http)).status).toBe(200);
        const pending = yield* Effect.forkChild(run(http));
        for (let i = 0; i < 100 && fixed.spawner.spawned[0] === undefined; i++) {
          yield* Effect.yieldNow;
        }
        const spawned = fixed.spawner.spawned[0];
        expect(spawned).toBeDefined();
        yield* Fiber.interrupt(pending);
        const exit = yield* Fiber.await(pending);
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        expect(yield* spawned?.isRunning ?? Effect.succeed(false)).toBe(true);
        yield* spawned?.exit(0) ?? Effect.void;
        for (let i = 0; i < 100 && (yield* spawned?.isRunning ?? Effect.succeed(false)); i++) {
          yield* Effect.yieldNow;
        }
        expect(yield* spawned?.isRunning ?? Effect.succeed(true)).toBe(false);
        expect(spawned?.kills).toEqual([]);
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );
});

describe("POST /abort happy path", () => {
  it.effect("kills the matching opencode and answers ok", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({}));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* reserve(http)).status).toBe(200);
        const pending = yield* Effect.forkChild(run(http));
        for (let i = 0; i < 100 && fixed.spawner.spawned[0] === undefined; i++) {
          yield* Effect.yieldNow;
        }
        expect(fixed.spawner.spawned[0]).toBeDefined();
        const response = yield* abort(http);
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
        expect(fixed.spawner.spawned[0]?.kills).toEqual(["SIGTERM"]);
        const runResponse = yield* Fiber.join(pending);
        expect(runResponse.status).toBe(500);
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );
});

describe("POST /abort authentication and decoding", () => {
  it.effect("refuses a missing bearer with 401 and one error line", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* abort(http, TICKET, { "content-type": "application/json" });
        expect(response.status).toBe(401);
        expect(yield* response.json).toEqual({ error: "unauthorized" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toEqual([]);
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: "POST /abort failed: unauthorized",
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
        const response = yield* abort(http, TICKET, {
          authorization: "Bearer wrong",
          "content-type": "application/json",
        });
        expect(response.status).toBe(401);
        expect(yield* response.json).toEqual({ error: "unauthorized" });
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );

  it.effect("a body without ticket is 400", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/abort", {
          headers,
          body: HttpBody.text("{}", "application/json"),
        });
        expect(response.status).toBe(400);
        const body = decodeErrorBody(yield* response.json);
        expect(body.error).toContain("ticket");
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );
});

describe("POST /abort unhappy path", () => {
  it.effect(
    "a kill that fails while the child still runs is 500 and the ticket stays abortable",
    () =>
      Effect.gen(function* () {
        const fixed = fixture(() => ({ killError: "Failed to kill child process" }));
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          expect((yield* reserve(http)).status).toBe(200);
          const pending = yield* Effect.forkChild(run(http));
          for (let i = 0; i < 100 && fixed.spawner.spawned[0] === undefined; i++) {
            yield* Effect.yieldNow;
          }
          const response = yield* abort(http);
          expect(response.status).toBe(500);
          expect(yield* response.json).toEqual({
            error: "Unknown: ChildProcess.kill: Failed to kill child process",
          });
          const again = yield* abort(http);
          expect(again.status).toBe(500);
          yield* fixed.spawner.spawned[0]?.exit(0) ?? Effect.void;
          expect((yield* Fiber.join(pending)).status).toBe(200);
        }).pipe(Effect.provide(serve(fixed)));
      }),
  );

  it.effect("an unknown ticket is 404 and one error line", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* abort(http);
        expect(response.status).toBe(404);
        expect(yield* response.json).toEqual({ error: `unknown session "${TICKET}"` });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: `POST /abort failed: unknown session "${TICKET}"`,
          location: "automation-client",
          agentId: TICKET,
          skipSentry: true,
          cause: undefined,
        },
      ]);
    }),
  );
});

describe("catch-all", () => {
  it.effect("GET /run, GET /abort and GET /nope are 404 not found and never logged", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        for (const path of ["/run", "/abort", "/nope"]) {
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
