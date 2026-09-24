import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Redacted, Schema } from "effect";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import * as Handlers from "../../src/automation-client/handlers.ts";
import * as Driver from "../../src/automation-client/driver.ts";
import * as OpenCode from "../../src/automation-client/opencode.ts";
import * as Sessions from "../../src/automation-client/sessions.ts";
import * as Config from "../../src/config.ts";
import * as HarnessConfig from "../../src/harness/config.ts";
import * as Log from "../../src/observability/log.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeLog from "../support/log.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";
import * as Reporter from "../support/reporter.ts";

const TOKEN = "test-token";
const TICKET = "OLI-42";
const MODEL = "opencode/muse-spark-1.3-contributor-free";
const RESULT = "22222222-2222-4222-8222-222222222222";

const prompted = (args: ReadonlyArray<string> | undefined): string | undefined => {
  if (args === undefined) {
    return undefined;
  }
  const index = args.indexOf("--prompt");
  return index < 0 ? undefined : args[index + 1];
};

const ProxyConfigLive = Layer.succeed(Config.ProxyConfig)({
  token: Redacted.make(TOKEN),
  databaseUrl: Redacted.make("postgres://unused"),
});

type Fixture = {
  readonly spawner: FakeSpawner.FakeSpawner;
  readonly log: FakeLog.FakeLog;
  readonly reporter: Reporter.Collector;
  readonly maxJobs: number;
  // Every ticket the client asked QEMU a slot for, in order.
  readonly qemu: Array<string>;
  // When set, each QEMU reserve waits on it, so a test can hold one /reserve in flight.
  readonly holdQemu?: Deferred.Deferred<void>;
  // Completed once a QEMU reserve is asked. The request crosses a real socket, so yielding
  // is no promise it has arrived.
  readonly reachedQemu?: Deferred.Deferred<void>;
  // When set, each QEMU reserve fails with it once asked.
  readonly qemuFailure?: Errors.Internal;
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
  qemu: [],
});

const qemuRecording =
  (fixed: Fixture): Sessions.ReserveQemu =>
  (agent, _resume, server) =>
    Effect.gen(function* () {
      fixed.qemu.push(server === undefined ? agent : `${agent} ${server}`);
      if (fixed.reachedQemu !== undefined) {
        yield* Deferred.succeed(fixed.reachedQemu, undefined);
      }
      if (fixed.holdQemu !== undefined) {
        yield* Deferred.await(fixed.holdQemu);
      }
      if (fixed.qemuFailure !== undefined) {
        return yield* fixed.qemuFailure;
      }
      return yield* Effect.void;
    });

const appConfig = JSON.stringify({
  models: { drive: MODEL, diagnose: MODEL, mint: MODEL },
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  timeouts: { header: "3 minutes", chunk: "3 minutes" },
  runCeiling: "1.5 hours",
  stepLimit: 200,
  harness: { defaultRetry: "1 second" },
});

const configFs = FileSystem.layerNoop({
  exists: (path) => Effect.succeed(path === HarnessConfig.PATH),
  readFileString: (path) =>
    path === HarnessConfig.PATH ? Effect.succeed(appConfig) : Effect.die(`unexpected read ${path}`),
});

const serve = (fixed: Fixture) =>
  HttpRouter.serve(Handlers.routes, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provide(Sessions.Sessions.layer(fixed.maxJobs, qemuRecording(fixed), () => Effect.void)),
    Layer.provide(Layer.mergeAll(fixed.spawner.layer, fixed.log.layer, ProxyConfigLive, configFs)),
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
  action: "drive" | "diagnose" = "drive",
) =>
  http.post("/reserve", {
    headers: extraHeaders,
    body: HttpBody.text(JSON.stringify({ ticket, action }), "application/json"),
  });

const run = (
  http: HttpClient.HttpClient,
  prompt = "do the work",
  extraHeaders: Record<string, string> = headers,
  ticket = TICKET,
) =>
  http.post("/run", {
    headers: extraHeaders,
    body: HttpBody.text(
      JSON.stringify({
        prompt,
        ticket,
        testResultId: RESULT,
        testDefinition: prompt,
        testProof: "none",
        serverUrl: "",
      }),
      "application/json",
    ),
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
  it.effect("a drive answers ok, asks QEMU for the ticket, and does not spawn the driver", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({ exitCode: 0 }));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* reserve(http);
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.qemu).toEqual([TICKET]);
      expect(fixed.spawner.spawned).toEqual([]);
      expect(fixed.log.lines).toEqual([]);
    }),
  );

  it.effect("a diagnose answers ok and never asks QEMU: it boots no guest", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({ exitCode: 0 }));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* reserve(http, TICKET, headers, "diagnose");
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
        // The slot is this client's: the run it reserved proceeds.
        expect((yield* run(http, "diagnose the session")).status).toBe(200);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.qemu).toEqual([]);
      expect(fixed.spawner.spawned).toMatchObject([
        {
          command: OpenCode.BIN,
          args: OpenCode.args("diagnose the session", MODEL),
          options: { env: OpenCode.ENV },
        },
      ]);
      expect(fixed.log.lines).toEqual([]);
    }),
  );

  it.effect(
    "a second reserve of the same ticket and action answers ok, asks QEMU once, and logs nothing",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          expect((yield* reserve(http)).status).toBe(200);
          const again = yield* reserve(http);
          expect(again.status).toBe(200);
          expect(yield* again.json).toEqual({ ok: "true" });
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.qemu).toEqual([TICKET]);
        expect(fixed.spawner.spawned).toEqual([]);
        expect(fixed.log.lines).toEqual([]);
      }),
  );
});

describe("POST /reserve mint pin", () => {
  const PIN = "http://127.0.0.1:55332";

  it.effect("a mint with its server reserves that server", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/reserve", {
          headers,
          body: HttpBody.text(
            JSON.stringify({ ticket: TICKET, action: "mint", server: PIN }),
            "application/json",
          ),
        });
        expect(response.status).toBe(200);
        expect(fixed.qemu).toEqual([`${TICKET} ${PIN}`]);
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );

  it.effect("a mint without a server is refused and reserves nothing (unhappy)", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/reserve", {
          headers,
          body: HttpBody.text(
            JSON.stringify({ ticket: TICKET, action: "mint" }),
            "application/json",
          ),
        });
        expect(response.status).toBe(400);
        expect(decodeErrorBody(yield* response.json)).toEqual({
          error: "a mint reserves its pinned server",
        });
        expect(fixed.qemu).toEqual([]);
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );
});

describe("POST /reserve decoding", () => {
  it.effect("a body without action is 400 and asks QEMU nothing", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/reserve", {
          headers,
          body: HttpBody.text(JSON.stringify({ ticket: TICKET }), "application/json"),
        });
        expect(response.status).toBe(400);
        const body = decodeErrorBody(yield* response.json);
        expect(body.error).toContain("action");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.qemu).toEqual([]);
      expect(fixed.spawner.spawned).toEqual([]);
    }),
  );

  it.effect("an action that is neither drive nor diagnose is 400 and asks QEMU nothing", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/reserve", {
          headers,
          body: HttpBody.text(
            JSON.stringify({ ticket: TICKET, action: "review" }),
            "application/json",
          ),
        });
        expect(response.status).toBe(400);
        const body = decodeErrorBody(yield* response.json);
        expect(body.error).toContain("action");
        // Nothing was reserved: a run for the ticket is refused.
        const refused = yield* run(http);
        expect(refused.status).toBe(400);
        expect(yield* refused.json).toEqual({ error: "no reservation" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.qemu).toEqual([]);
      expect(fixed.spawner.spawned).toEqual([]);
    }),
  );
});

describe("POST /run happy path", () => {
  it.effect("answers ok after the driver exits 0, run as the reserved action", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({ exitCode: 0, stdout: "the written result" }));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* reservedRun(http, "fix the bug");
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toMatchObject([
        {
          command: Driver.BIN,
          args: Driver.args({
            prompt: "fix the bug",
            testDefinition: "fix the bug",
            testProof: "none",
            agentId: TICKET,
            serverUrl: "",
            action: "drive",
            testResultId: RESULT,
          }),
          // The transcript the driver prints is the operator's to watch; this process keeps none of it.
          options: { stdout: "inherit" },
        },
      ]);
      expect(fixed.log.lines).toEqual([]);
    }),
  );

  it.effect("waits until the driver exits before answering 200", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({}));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* reserve(http)).status).toBe(200);
        const pending = yield* Effect.forkChild(run(http));
        const spawned = yield* fixed.spawner.nextSpawn;
        expect(pending.pollUnsafe()).toBeUndefined();
        yield* spawned.exit(0);
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
          body: HttpBody.text(
            JSON.stringify({
              ticket: TICKET,
              testResultId: RESULT,
              testDefinition: "do the work",
              testProof: "none",
              serverUrl: "",
            }),
            "application/json",
          ),
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
          body: HttpBody.text(
            JSON.stringify({
              prompt: "do the work",
              testResultId: RESULT,
              testDefinition: "do the work",
              testProof: "none",
              serverUrl: "",
            }),
            "application/json",
          ),
        });
        expect(response.status).toBe(400);
        const body = decodeErrorBody(yield* response.json);
        expect(body.error).toContain("ticket");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toEqual([]);
    }),
  );

  it.effect("a body that names a model does not pass it to the driver", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({ exitCode: 0 }));
      const sent = "openrouter/deepseek/deepseek-v4.1-flash";
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* reserve(http)).status).toBe(200);
        const response = yield* http.post("/run", {
          headers,
          body: HttpBody.text(
            JSON.stringify({
              prompt: "do the work",
              ticket: TICKET,
              model: sent,
              testResultId: RESULT,
              testDefinition: "do the work",
              testProof: "none",
              serverUrl: "",
            }),
            "application/json",
          ),
        });
        expect(response.status).toBe(200);
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned[0]?.args).toEqual(
        Driver.args({
          prompt: "do the work",
          testDefinition: "do the work",
          testProof: "none",
          agentId: TICKET,
          serverUrl: "",
          action: "drive",
          testResultId: RESULT,
        }),
      );
      expect(fixed.spawner.spawned[0]?.args).not.toContain(sent);
    }),
  );

  it.effect("a body without testResultId is 400 and spawns nothing", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/run", {
          headers,
          body: HttpBody.text(
            JSON.stringify({
              prompt: "do the work",
              ticket: TICKET,
              testDefinition: "do the work",
              testProof: "none",
              serverUrl: "",
            }),
            "application/json",
          ),
        });
        expect(response.status).toBe(400);
        const body = decodeErrorBody(yield* response.json);
        expect(body.error).toContain("testResultId");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toEqual([]);
    }),
  );

  it.effect("a body without testDefinition is 400 and spawns nothing (unhappy)", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/run", {
          headers,
          body: HttpBody.text(
            JSON.stringify({
              prompt: "do the work",
              ticket: TICKET,
              testResultId: RESULT,
              testProof: "none",
              serverUrl: "",
            }),
            "application/json",
          ),
        });
        expect(response.status).toBe(400);
        const body = decodeErrorBody(yield* response.json);
        expect(body.error).toContain("testDefinition");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toEqual([]);
    }),
  );

  it.effect("a body without testProof is 400 and spawns nothing (unhappy)", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/run", {
          headers,
          body: HttpBody.text(
            JSON.stringify({
              prompt: "do the work",
              ticket: TICKET,
              testResultId: RESULT,
              testDefinition: "do the work",
              serverUrl: "",
            }),
            "application/json",
          ),
        });
        expect(response.status).toBe(400);
        const body = decodeErrorBody(yield* response.json);
        expect(body.error).toContain("testProof");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toEqual([]);
    }),
  );

  it.effect("a body without serverUrl is 400 and spawns nothing (unhappy)", () =>
    Effect.gen(function* () {
      const fixed = fixture();
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* http.post("/run", {
          headers,
          body: HttpBody.text(
            JSON.stringify({
              prompt: "do the work",
              ticket: TICKET,
              testResultId: RESULT,
              testDefinition: "do the work",
              testProof: "none",
            }),
            "application/json",
          ),
        });
        expect(response.status).toBe(400);
        const body = decodeErrorBody(yield* response.json);
        expect(body.error).toContain("serverUrl");
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.spawner.spawned).toEqual([]);
    }),
  );
});

describe("POST /run unhappy path", () => {
  it.effect("returns 500 with the spawn error when the driver cannot be opened", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({ spawnError: "spawn ./driver ENOENT" }));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const response = yield* reservedRun(http);
        expect(response.status).toBe(500);
        expect(yield* response.json).toEqual({ error: "spawn ./driver ENOENT" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.log.lines.map((line) => [line.level, line.text, line.skipSentry])).toEqual([
        ["error", "POST /run failed: spawn ./driver ENOENT", false],
      ]);
    }),
  );

  it.effect("returns 500 with the error the driver printed when it exits non-zero", () =>
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

  it.effect(
    "a second reserve of the same ticket under the other action is 400 already reserved and reaches Sentry",
    () =>
      Effect.gen(function* () {
        const fixed = fixture();
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          expect((yield* reserve(http, TICKET, headers, "diagnose")).status).toBe(200);
          const refused = yield* reserve(http);
          expect(refused.status).toBe(400);
          expect(yield* refused.json).toEqual({ error: "already reserved" });
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.qemu).toEqual([]);
        expect(fixed.spawner.spawned).toEqual([]);
        expect(fixed.log.lines).toEqual([
          {
            level: "error",
            text: "POST /reserve failed: already reserved",
            location: "automation-client",
            agentId: TICKET,
            skipSentry: false,
            cause: undefined,
          },
        ]);
      }),
  );

  it.effect("a reserve whose QEMU call fails is 500 and reaches Sentry with its cause", () =>
    Effect.gen(function* () {
      const unreachable = Errors.ProxyUnreachable.make({
        message: "POST http://127.0.0.1:55555/reserve failed",
        cause: new Error("connect ECONNREFUSED 127.0.0.1:55555"),
      });
      const fixed: Fixture = {
        ...fixture(),
        qemuFailure: Errors.Internal.make({ cause: unreachable, agentId: TICKET }),
      };
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const refused = yield* reserve(http);
        expect(refused.status).toBe(500);
        expect(yield* refused.json).toEqual({ error: "internal error" });
      }).pipe(Effect.provide(serve(fixed)));
      expect(fixed.qemu).toEqual([TICKET]);
      expect(fixed.spawner.spawned).toEqual([]);
      expect(fixed.log.lines).toEqual([
        {
          level: "error",
          text: "POST /reserve failed: connect ECONNREFUSED 127.0.0.1:55555",
          location: "automation-client",
          agentId: TICKET,
          skipSentry: false,
          cause: unreachable,
        },
      ]);
    }),
  );

  it.effect(
    "a second reserve while one is in flight on this server is 503, does not ask QEMU and skips Sentry",
    () =>
      Effect.gen(function* () {
        const holdQemu = yield* Deferred.make<void>();
        const reachedQemu = yield* Deferred.make<void>();
        const fixed = { ...fixture(() => ({}), 2), holdQemu, reachedQemu };
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const pending = yield* Effect.forkChild(reserve(http));
          yield* Deferred.await(reachedQemu);
          expect(fixed.qemu).toEqual([TICKET]);
          const refused = yield* reserve(http, "OLI-99");
          expect(refused.status).toBe(503);
          expect(yield* refused.json).toEqual({ error: "a reserve is already in flight" });
          expect(fixed.qemu).toEqual([TICKET]);
          yield* Deferred.succeed(holdQemu, undefined);
          expect((yield* Fiber.join(pending)).status).toBe(200);
          expect((yield* reserve(http, "OLI-99")).status).toBe(200);
          expect(fixed.qemu).toEqual([TICKET, "OLI-99"]);
        }).pipe(Effect.provide(serve(fixed)));
        expect(fixed.spawner.spawned).toEqual([]);
        expect(fixed.log.lines).toEqual([
          {
            level: "error",
            text: "POST /reserve failed: a reserve is already in flight",
            location: "automation-client",
            agentId: "OLI-99",
            skipSentry: true,
            cause: undefined,
          },
        ]);
        expect(fixed.reporter.reported).toEqual([]);
      }),
  );

  it.effect("a reserve that has answered does not block the next reserve on this server", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({}), 2);
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* reserve(http)).status).toBe(200);
        expect((yield* reserve(http, "OLI-99")).status).toBe(200);
        expect(fixed.qemu).toEqual([TICKET, "OLI-99"]);
        const firstRun = yield* Effect.forkChild(run(http, "first"));
        const secondRun = yield* Effect.forkChild(run(http, "second", headers, "OLI-99"));
        const first = yield* fixed.spawner.nextSpawn;
        const second = yield* fixed.spawner.nextSpawn;
        expect(fixed.spawner.spawned.map((spawned) => prompted(spawned.args))).toEqual([
          "first",
          "second",
        ]);
        yield* first.exit(0);
        yield* second.exit(0);
        expect((yield* Fiber.join(firstRun)).status).toBe(200);
        expect((yield* Fiber.join(secondRun)).status).toBe(200);
      }).pipe(Effect.provide(serve(fixed)));
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
          const first = yield* fixed.spawner.nextSpawn;
          const refused = yield* reserve(http, "OLI-99");
          expect(refused.status).toBe(503);
          expect(yield* refused.json).toEqual({ error: "at capacity: max-jobs is 1" });
          expect((yield* run(http, "second", headers, "OLI-99")).status).toBe(400);
          expect(fixed.spawner.spawned).toHaveLength(1);
          yield* first.exit(0);
          expect((yield* Fiber.join(pending)).status).toBe(200);
          expect((yield* reserve(http, "OLI-99")).status).toBe(200);
          const accepted = yield* Effect.forkChild(run(http, "second", headers, "OLI-99"));
          const second = yield* fixed.spawner.nextSpawn;
          expect(fixed.spawner.spawned.map((spawned) => prompted(spawned.args))).toEqual([
            "first",
            "second",
          ]);
          yield* second.exit(0);
          expect((yield* Fiber.join(accepted)).status).toBe(200);
        }).pipe(Effect.provide(serve(fixed)));
        // The refusal names the ticket it turned away; a full client is an answer the dispatcher
        // places elsewhere, so it skips Sentry.
        expect(fixed.log.lines).toEqual([
          {
            level: "error",
            text: "POST /reserve failed: at capacity: max-jobs is 1",
            location: "automation-client",
            agentId: "OLI-99",
            skipSentry: true,
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
  // The automation server's shutdown relies on this: dropping /run stops nothing, /abort does.
  it.effect("a dropped POST /run leaves the driver running until POST /abort stops it", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({}));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* reserve(http)).status).toBe(200);
        const pending = yield* Effect.forkChild(run(http));
        const spawned = yield* fixed.spawner.nextSpawn;
        yield* Fiber.interrupt(pending);
        const exit = yield* Fiber.await(pending);
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        expect(yield* spawned.isRunning).toBe(true);
        expect(spawned.kills).toEqual([]);
        const response = yield* abort(http);
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
        expect(spawned.kills).toEqual(["SIGTERM"]);
        expect(yield* spawned.isRunning).toBe(false);
      }).pipe(Effect.provide(serve(fixed)));
    }),
  );
});

describe("POST /abort happy path", () => {
  it.effect("kills the matching driver and answers ok, and its /run answers 409 run aborted", () =>
    Effect.gen(function* () {
      const fixed = fixture(() => ({}));
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        expect((yield* reserve(http)).status).toBe(200);
        const pending = yield* Effect.forkChild(run(http));
        const spawned = yield* fixed.spawner.nextSpawn;
        const response = yield* abort(http);
        expect(response.status).toBe(200);
        expect(yield* response.json).toEqual({ ok: "true" });
        expect(spawned.kills).toEqual(["SIGTERM"]);
        const runResponse = yield* Fiber.join(pending);
        expect(runResponse.status).toBe(409);
        expect(yield* runResponse.json).toEqual({ error: "run aborted" });
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
          const spawned = yield* fixed.spawner.nextSpawn;
          const response = yield* abort(http);
          expect(response.status).toBe(500);
          expect(yield* response.json).toEqual({
            error: "Unknown: ChildProcess.kill: Failed to kill child process",
          });
          const again = yield* abort(http);
          expect(again.status).toBe(500);
          yield* spawned.exit(0);
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
