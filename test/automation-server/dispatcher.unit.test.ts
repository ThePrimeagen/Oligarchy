import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Option, Redacted, Scope } from "effect";
import { TestClock } from "effect/testing";
import { HttpClientError } from "effect/unstable/http";
import * as Clients from "../../src/automation-server/clients.ts";
import * as Dispatcher from "../../src/automation-server/dispatcher.ts";
import * as Config from "../../src/config.ts";
import * as Automation from "../../src/db/automation.ts";
import * as Servers from "../../src/db/servers.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as FakeLinear from "../support/fake-linear.ts";
import * as FakeLog from "../support/log.ts";
import * as Stores from "../support/stores.ts";

const TICKET = "OLI-45";
const RESULT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const CLIENT = "http://client";
const CLIENT_A = "http://client-a";
const CLIENT_B = "http://client-b";
const TOKEN = "dispatch-token";
const DESCRIPTION = "description of OLI-45";

const ATTR = { location: "automation-server", agentId: TICKET } as const;
const PROCESS = { location: "automation-server", agentId: "automation-server" } as const;

const HOST = {
  memory: { totalBytes: 16_000, usedBytes: 4_000 },
  cpu: { mean1m: 1, mean2m: 1, mean3m: 1 },
} as const;

const PromptFsLive = FileSystem.layerNoop({
  readFileString: (path) =>
    Effect.sync(() => {
      const name = path.slice(path.lastIndexOf("/") + 1);
      if (name === "diagnosing-agent.html") {
        return "{{LINEAR_TICKET}} {{RESULT_ID}} {{TEST_RESULT_ID}} {{MODEL}}\n<guide>\n{{CTRL_DIAGNOSE_MD}}\n</guide>";
      }
      if (name === "ctrl-diagnose.md") {
        return "# Control\n\nDiagnose the session.\n";
      }
      return `contents of ${name}`;
    }),
});

const ConfigLive = Layer.succeed(Config.AutomationServerConfig)(
  Config.AutomationServerConfig.of({
    linearWebhookSecret: Redacted.make("whsec"),
    token: Redacted.make(TOKEN),
    linearApiToken: Redacted.make("lin"),
    databaseUrl: Redacted.make("postgres://unused"),
  }),
);

const okRun = () =>
  FakeHttp.json({
    model: "opencode/muse-spark-1.3-contributor-free",
    session: "ses_1",
    text: "done",
    elapsedMs: 1,
  });

const seedResult = (
  tests: Stores.FakeTestStore,
  options: {
    readonly linearId?: string | null;
    readonly status?: (typeof tests.results)[number]["status"];
    readonly sessionId?: string | null;
    readonly resultId?: string;
  } = {},
) => {
  tests.results.push({
    id: options.resultId ?? RESULT_ID,
    runId: RUN_ID,
    definitionId: 1,
    sessionId: options.sessionId === undefined ? null : options.sessionId,
    model: null,
    linearId: options.linearId === undefined ? TICKET : options.linearId,
    status: options.status ?? "pending",
    reason: null,
    createdAt: new Date(),
    finishedAt: null,
  });
};

const seedSession = (sessions: Stores.FakeSessionStore, ended: boolean) => {
  sessions.sessions.push({
    id: SESSION_ID,
    config: { iso: "https://example.com/omarchy.iso" },
    status: ended ? "succeeded" : "running",
    reason: null,
    startedAt: new Date(),
    endedAt: ended ? new Date() : null,
  });
};

const world = (
  options: {
    readonly http?: FakeHttp.Recorder;
    readonly linear?: FakeLinear.FakeLinear;
    readonly automation?: Partial<typeof Automation.AutomationStore.Service>;
    readonly servers?: Partial<typeof Servers.ServerStore.Service>;
  } = {},
) => {
  const sessions = Stores.fakeSessionStore();
  const tests = Stores.fakeTestStore();
  const automation = Stores.fakeAutomationStore(options.automation ?? {}, {
    results: tests.results,
    sessions: sessions.sessions,
  });
  const servers = Stores.fakeServerStore(options.servers ?? {});
  const linear = options.linear ?? FakeLinear.fakeLinear();
  const log = FakeLog.fakeLog();
  const http = options.http ?? FakeHttp.recordRequests(okRun);
  const layer = Layer.mergeAll(
    automation.layer,
    tests.layer,
    servers.layer,
    linear.layer,
    log.layer,
    http.layer,
    ConfigLive,
    PromptFsLive,
  );
  return { tests, sessions, automation, servers, linear, log, http, layer };
};

const announce = (url: string, agents = 0) =>
  Effect.flatMap(Servers.ServerStore, (store) =>
    store.heartbeat(url, "automation", { agents, ...HOST }),
  );

const enqueue = (action: "drive" | "diagnose", resultId = RESULT_ID) =>
  Effect.flatMap(Automation.AutomationStore, (store) => store.enqueue({ resultId, action }));

const pump = (times = 32) =>
  Effect.gen(function* () {
    for (let i = 0; i < times; i++) {
      yield* Effect.yieldNow;
    }
  });

const waitUntil = (predicate: () => boolean, times = 256) =>
  Effect.gen(function* () {
    for (let i = 0; i < times; i++) {
      if (predicate()) {
        return;
      }
      yield* Effect.yieldNow;
    }
  });

const start = (fixed: ReturnType<typeof world>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Dispatcher.loop.pipe(Effect.provide(fixed.layer)));
    yield* pump();
    return fiber;
  });

const parsed = (body: string): unknown => JSON.parse(body);

describe("dispatcher happy path", () => {
  it.effect(
    "a pending drive and one fresh client: claims, fetches Linear, POSTs /run, closes succeeded",
    () =>
      Effect.gen(function* () {
        const released = yield* Deferred.make<void>();
        const http = FakeHttp.recordRequests(() =>
          Effect.flatMap(Deferred.await(released), () => Effect.succeed(okRun())),
        );
        const fixed = world({ http });
        seedResult(fixed.tests);
        yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
        yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
        const fiber = yield* start(fixed);
        expect(fixed.automation.jobs[0]?.status).toBe("running");
        expect(fixed.automation.jobs[0]?.startedAt).not.toBeNull();
        expect(fixed.linear.calls).toEqual([{ method: "issueDescription", identifier: TICKET }]);
        expect(http.requests).toHaveLength(1);
        expect(http.requests[0]?.method).toBe("POST");
        expect(http.requests[0]?.url).toBe(`${CLIENT}/run`);
        expect(http.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
        expect(parsed(http.requests[0]?.body ?? "")).toEqual({
          key: TICKET,
          prompt: DESCRIPTION,
        });
        expect(
          fixed.log.lines.map((line) => [line.level, line.text, line.location, line.agentId]),
        ).toEqual([["info", `job started; drive; ${CLIENT}`, ATTR.location, ATTR.agentId]]);
        yield* TestClock.adjust("734211 millis");
        yield* Deferred.succeed(released, undefined);
        yield* pump();
        expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
        expect(fixed.automation.jobs[0]?.reason).toBeNull();
        expect(fixed.log.lines.map((line) => [line.level, line.text])).toEqual([
          ["info", `job started; drive; ${CLIENT}`],
          ["info", "job succeeded; drive in 734211ms"],
        ]);
        expect(fixed.log.lines[1]).toMatchObject(ATTR);
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect(
    "a second job goes to the client with fewer runs in flight; ties to registration order",
    () =>
      Effect.gen(function* () {
        const first = yield* Deferred.make<void>();
        let posts = 0;
        const http = FakeHttp.recordRequests(() => {
          posts += 1;
          if (posts === 1) {
            return Effect.flatMap(Deferred.await(first), () => Effect.succeed(okRun()));
          }
          return okRun();
        });
        const fixed = world({ http });
        seedResult(fixed.tests);
        seedResult(fixed.tests, {
          resultId: "cccccccc-dddd-4eee-8fff-000000000000",
          linearId: "OLI-46",
        });
        yield* announce(CLIENT_A, 0).pipe(Effect.provide(fixed.layer));
        yield* announce(CLIENT_B, 0).pipe(Effect.provide(fixed.layer));
        yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
        const fiber = yield* start(fixed);
        expect(http.requests[0]?.url).toBe(`${CLIENT_A}/run`);
        yield* enqueue("drive", "cccccccc-dddd-4eee-8fff-000000000000").pipe(
          Effect.provide(fixed.layer),
        );
        yield* TestClock.adjust(Dispatcher.DISPATCH_INTERVAL);
        yield* pump();
        expect(http.requests).toHaveLength(2);
        expect(http.requests[1]?.url).toBe(`${CLIENT_B}/run`);
        yield* Deferred.succeed(first, undefined);
        yield* pump();
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("a diagnose whose session is open is not claimed and is claimed once it ends", () =>
    Effect.gen(function* () {
      const fixed = world();
      seedSession(fixed.sessions, false);
      seedResult(fixed.tests, { sessionId: SESSION_ID });
      yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
      yield* enqueue("diagnose").pipe(Effect.provide(fixed.layer));
      const fiber = yield* start(fixed);
      expect(fixed.automation.jobs[0]?.status).toBe("pending");
      expect(fixed.http.requests).toHaveLength(0);
      const session = fixed.sessions.sessions[0];
      if (session !== undefined) {
        session.endedAt = new Date();
        session.status = "succeeded";
      }
      yield* TestClock.adjust(Dispatcher.DISPATCH_INTERVAL);
      yield* waitUntil(() => fixed.automation.jobs[0]?.status === "succeeded");
      expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
      const diagnoseBody = parsed(fixed.http.requests[0]?.body ?? "");
      expect(diagnoseBody).toMatchObject({ key: TICKET });
      const prompt =
        diagnoseBody !== null &&
        typeof diagnoseBody === "object" &&
        "prompt" in diagnoseBody &&
        typeof diagnoseBody.prompt === "string"
          ? diagnoseBody.prompt
          : "";
      expect(prompt).toContain(TICKET);
      expect(prompt).toContain(RESULT_ID);
      expect(prompt).toContain("$OLIGARCHY_MODEL");
      expect(prompt).toContain("# Control\n");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a diagnose is claimed before an older drive", () =>
    Effect.gen(function* () {
      const fixed = world();
      seedSession(fixed.sessions, true);
      seedResult(fixed.tests, { sessionId: SESSION_ID });
      yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
      yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
      yield* enqueue("diagnose").pipe(Effect.provide(fixed.layer));
      const fiber = yield* start(fixed);
      yield* waitUntil(() => fixed.http.requests.length > 0);
      const first = parsed(fixed.http.requests[0]?.body ?? "");
      const firstPrompt =
        first !== null &&
        typeof first === "object" &&
        "prompt" in first &&
        typeof first.prompt === "string"
          ? first.prompt
          : "";
      expect(firstPrompt).toContain("$OLIGARCHY_MODEL");
      expect(fixed.automation.jobs.find((job) => job.action === "diagnose")?.status).toBe(
        "succeeded",
      );
      expect(fixed.automation.jobs.find((job) => job.action === "drive")?.status).toBe("pending");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "no fresh client writes the waiting warning once, not every tick, and again after a client came and went",
    () =>
      Effect.gen(function* () {
        const fixed = world();
        seedResult(fixed.tests);
        yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
        const fiber = yield* start(fixed);
        expect(fixed.automation.jobs[0]?.status).toBe("pending");
        expect(fixed.log.lines.map((line) => [line.level, line.text])).toEqual([
          ["warning", "no automation client available; 1 jobs waiting"],
        ]);
        expect(fixed.log.lines[0]).toMatchObject(PROCESS);
        yield* TestClock.adjust(Dispatcher.DISPATCH_INTERVAL);
        yield* pump();
        expect(fixed.log.lines).toHaveLength(1);
        yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
        yield* TestClock.adjust(Dispatcher.DISPATCH_INTERVAL);
        yield* pump();
        expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
        yield* TestClock.adjust("90 seconds");
        yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
        yield* TestClock.adjust(Dispatcher.DISPATCH_INTERVAL);
        yield* pump();
        expect(fixed.log.lines.map((line) => line.text)).toContain(
          "no automation client available; 1 jobs waiting",
        );
        expect(
          fixed.log.lines.filter((line) => line.text.startsWith("no automation client available"))
            .length,
        ).toBe(2);
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("nothing is written while the queue is empty", () =>
    Effect.gen(function* () {
      const fixed = world();
      yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
      const fiber = yield* start(fixed);
      yield* TestClock.adjust(Dispatcher.DISPATCH_INTERVAL);
      yield* pump();
      expect(fixed.log.lines).toEqual([]);
      expect(fixed.http.requests).toHaveLength(0);
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("dispatcher unhappy path", () => {
  it.effect("a 502 { error } closes the job failed with skipSentry", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: "opencode: exited 1: boom" }, 502),
      );
      const fixed = world({ http });
      seedResult(fixed.tests);
      yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
      yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
      const fiber = yield* start(fixed);
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "failed",
        reason: "opencode: exited 1: boom",
      });
      expect(fixed.tests.results[0]).toMatchObject({
        status: "aborted",
        reason: "automation: opencode: exited 1: boom",
      });
      expect(fixed.log.lines.map((line) => [line.level, line.text, line.skipSentry])).toEqual([
        ["info", `job started; drive; ${CLIENT}`, false],
        ["error", "job failed; drive; opencode: exited 1: boom", true],
      ]);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a 504 closes the job timed_out", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: "opencode: no result within 2 hours" }, 504),
      );
      const fixed = world({ http });
      seedResult(fixed.tests);
      yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
      yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
      const fiber = yield* start(fixed);
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "timed_out",
        reason: "opencode: no result within 2 hours",
      });
      expect(fixed.log.lines.map((line) => [line.level, line.text, line.skipSentry])).toEqual([
        ["info", `job started; drive; ${CLIENT}`, false],
        ["error", "job timed out; drive", true],
      ]);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a 400 or 401 closes the job failed with the body's message", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ error: "unauthorized" }, 401));
      const fixed = world({ http });
      seedResult(fixed.tests);
      yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
      yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
      const fiber = yield* start(fixed);
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "failed",
        reason: "unauthorized",
      });
      expect(fixed.log.lines[1]).toMatchObject({
        level: "error",
        text: "job failed; drive; unauthorized",
        skipSentry: true,
      });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("an unreachable client closes failed and reports", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error("connect ECONNREFUSED"),
              description: "connect ECONNREFUSED",
            }),
          }),
        ),
      );
      const fixed = world({ http });
      seedResult(fixed.tests);
      yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
      yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
      const fiber = yield* start(fixed);
      expect(fixed.automation.jobs[0]?.status).toBe("failed");
      expect(fixed.automation.jobs[0]?.reason).toMatch(
        /^automation client http:\/\/client unreachable: /,
      );
      expect(fixed.log.lines[1]).toMatchObject({
        level: "error",
        text: expect.stringMatching(
          /^job failed; drive; automation client http:\/\/client unreachable: /,
        ),
        skipSentry: false,
      });
      expect(fixed.log.lines[1]?.cause).toBeDefined();
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a diagnose failure touches no result", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: "opencode: exited 1: boom" }, 502),
      );
      const fixed = world({ http });
      seedSession(fixed.sessions, true);
      seedResult(fixed.tests, { sessionId: SESSION_ID });
      yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
      yield* enqueue("diagnose").pipe(Effect.provide(fixed.layer));
      const fiber = yield* start(fixed);
      yield* waitUntil(() => fixed.http.requests.length > 0);
      yield* waitUntil(() => fixed.automation.jobs[0]?.status === "failed");
      expect(fixed.automation.jobs[0]?.status).toBe("failed");
      expect(fixed.tests.results[0]?.status).toBe("pending");
      expect(fixed.tests.results[0]?.reason).toBeNull();
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a Linear failure while composing closes the job failed; linear: <reason>", () =>
    Effect.gen(function* () {
      const linear = FakeLinear.fakeLinear({
        overrides: {
          issueDescription: () =>
            Effect.fail(
              Errors.LinearError.make({
                operation: "issueDescription",
                message: "linear: no issue OLI-45",
              }),
            ),
        },
      });
      const fixed = world({ linear });
      seedResult(fixed.tests);
      yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
      yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
      const fiber = yield* start(fixed);
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "failed",
        reason: "linear: no issue OLI-45",
      });
      expect(fixed.http.requests).toHaveLength(0);
      expect(fixed.log.lines.map((line) => [line.level, line.text])).toEqual([
        ["error", "job failed; drive; linear: no issue OLI-45"],
      ]);
      expect(fixed.log.lines[0]?.skipSentry).toBe(false);
      expect(fixed.log.lines[0]?.cause).toBeDefined();
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a closeJob that fails is one error line and the loop goes on", () =>
    Effect.gen(function* () {
      let closes = 0;
      const refused = Errors.DatabaseError.make({
        operation: "closeJob",
        message: "Failed query: update automation_jobs",
        cause: new Error("write failed"),
      });
      const fixed = world({
        automation: {
          closeJob: (id, status, reason) =>
            Effect.gen(function* () {
              closes += 1;
              if (closes === 1) {
                return yield* Effect.fail(refused);
              }
              const row = fixed.automation.jobs.find(
                (job) => job.id === id && job.status === "running",
              );
              if (row === undefined) {
                return false;
              }
              row.status = status;
              row.reason = reason;
              row.finishedAt = new Date();
              return true;
            }),
        },
      });
      seedResult(fixed.tests);
      seedResult(fixed.tests, {
        resultId: "cccccccc-dddd-4eee-8fff-000000000000",
        linearId: "OLI-46",
      });
      yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
      yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
      const fiber = yield* start(fixed);
      const firstId = fixed.automation.jobs[0]?.id;
      expect(
        fixed.log.lines.some(
          (line) =>
            line.text ===
            `db: closing job ${firstId ?? ""} failed: Failed query: update automation_jobs`,
        ),
      ).toBe(true);
      expect(
        fixed.log.lines.find((line) => line.text.startsWith("db: closing job"))?.cause,
      ).toBeDefined();
      yield* enqueue("drive", "cccccccc-dddd-4eee-8fff-000000000000").pipe(
        Effect.provide(fixed.layer),
      );
      yield* TestClock.adjust(Dispatcher.DISPATCH_INTERVAL);
      yield* pump();
      expect(fixed.automation.jobs[1]?.status).toBe("succeeded");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a tick that dies is one error line and the next tick runs", () =>
    Effect.gen(function* () {
      let lists = 0;
      const fixed = world({
        servers: {
          listAutomationClients: Effect.suspend(() => {
            lists += 1;
            return lists === 1
              ? Effect.die(new Error("boom"))
              : Effect.succeed([{ url: CLIENT, agents: 0 }]);
          }),
        },
      });
      seedResult(fixed.tests);
      yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
      const fiber = yield* start(fixed);
      expect(fixed.log.lines[0]).toMatchObject({
        level: "error",
        text: "dispatch failed: boom",
      });
      yield* TestClock.adjust(Dispatcher.DISPATCH_INTERVAL);
      yield* pump();
      expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a tick in flight is not overlapped", () =>
    Effect.gen(function* () {
      const held = yield* Deferred.make<void>();
      let claims = 0;
      const fixed = world({
        automation: {
          claimNext: Effect.gen(function* () {
            claims += 1;
            yield* Deferred.await(held);
            const row = fixed.automation.jobs[0];
            if (row === undefined) {
              return Option.none();
            }
            row.status = "running";
            row.startedAt = new Date();
            return Option.some(row);
          }),
        },
      });
      seedResult(fixed.tests);
      yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
      yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
      const fiber = yield* start(fixed);
      expect(claims).toBe(1);
      yield* TestClock.adjust(Dispatcher.DISPATCH_INTERVAL);
      yield* pump();
      expect(claims).toBe(1);
      yield* Deferred.succeed(held, undefined);
      yield* pump();
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "interrupting the loop closes every in-flight job aborted; automation-server shutdown",
    () =>
      Effect.gen(function* () {
        const http = FakeHttp.recordRequests(() => Effect.never);
        const fixed = world({ http });
        seedResult(fixed.tests);
        yield* announce(CLIENT).pipe(Effect.provide(fixed.layer));
        yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
        const scope = yield* Scope.make();
        yield* Dispatcher.loop.pipe(
          Effect.provide(fixed.layer),
          Scope.provide(scope),
          Effect.forkChild,
        );
        yield* pump();
        expect(fixed.automation.jobs[0]?.status).toBe("running");
        expect(fixed.http.requests).toHaveLength(1);
        yield* Scope.close(scope, Exit.void);
        yield* pump();
        expect(fixed.automation.jobs[0]).toMatchObject({
          status: "aborted",
          reason: "automation-server shutdown",
        });
        expect(fixed.log.lines.map((line) => [line.level, line.text])).toEqual([
          ["info", `job started; drive; ${CLIENT}`],
          ["info", "job aborted; drive; automation-server shutdown"],
        ]);
      }),
  );

  it.effect("the startup sweep closes stale running rows and logs only when N > 0", () =>
    Effect.gen(function* () {
      const fixed = world();
      seedResult(fixed.tests);
      const row = yield* enqueue("drive").pipe(Effect.provide(fixed.layer));
      row.status = "running";
      row.startedAt = new Date();
      const count = yield* Dispatcher.sweep("automation-server restarted").pipe(
        Effect.provide(fixed.layer),
      );
      expect(count).toBe(1);
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "aborted",
        reason: "automation-server restarted",
      });
      expect(fixed.log.lines.map((line) => [line.level, line.text])).toEqual([
        ["info", "1 jobs aborted; automation-server restarted"],
      ]);
      const again = yield* Dispatcher.sweep("automation-server restarted").pipe(
        Effect.provide(fixed.layer),
      );
      expect(again).toBe(0);
      expect(fixed.log.lines).toHaveLength(1);
    }),
  );
});

describe("clients", () => {
  it.effect("run posts the bearer payload (happy)", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(okRun);
      const response = yield* Clients.run(CLIENT, TICKET, DESCRIPTION).pipe(
        Effect.provide(Layer.mergeAll(http.layer, ConfigLive)),
      );
      expect(response.session).toBe("ses_1");
      expect(http.requests[0]?.url).toBe(`${CLIENT}/run`);
      expect(http.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(parsed(http.requests[0]?.body ?? "")).toEqual({ key: TICKET, prompt: DESCRIPTION });
    }),
  );

  it.effect("run classifies a 502 as ProxyRefusal (unhappy)", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: "opencode: exited 1" }, 502),
      );
      const error = yield* Effect.flip(
        Clients.run(CLIENT, TICKET, DESCRIPTION).pipe(
          Effect.provide(Layer.mergeAll(http.layer, ConfigLive)),
        ),
      );
      expect(error).toMatchObject({
        _tag: "ProxyRefusal",
        status: 502,
        message: "opencode: exited 1",
      });
    }),
  );
});
