import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, FileSystem, Layer, Redacted, Scope } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientError } from "effect/unstable/http";
import * as AutomationClient from "../../src/automation-server/client.ts";
import * as Worker from "../../src/automation-server/worker.ts";
import * as FakeFs from "../support/fake-fs.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as FakeLog from "../support/log.ts";
import * as Stores from "../support/stores.ts";

const URL = "http://127.0.0.1:55333";
const TOKEN = "test-token";
const TICKET = "OLI-42";
const RESULT_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const MODEL = "opencode/muse-spark-1.3-contributor-free";
const STATS = {
  qemus: 0,
  memory: { totalBytes: 1, usedBytes: 0 },
  cpu: { mean1m: 0, mean2m: 0, mean3m: 0 },
};

const token = Layer.succeed(AutomationClient.OligarchyToken)(
  AutomationClient.OligarchyToken.of(Redacted.make(TOKEN)),
);

const scriptsFs = FileSystem.layerNoop({
  readFileString: (path) =>
    Effect.succeed(
      path.endsWith("driving-agent.html")
        ? "drive {{LINEAR_TICKET}} as {{MODEL}}"
        : path.endsWith("diagnosing-agent.html")
          ? "diagnose {{LINEAR_TICKET}} {{RESULT_ID}} {{MODEL}}\n{{CTRL_DIAGNOSE_MD}}"
          : path.endsWith("ctrl-diagnose.md")
            ? "# Control"
            : `contents of ${path}`,
    ),
});

const DRIVE_PROMPT = `drive ${TICKET} as ${MODEL}`;
const DIAGNOSE_PROMPT = `diagnose ${TICKET} ${RESULT_ID} ${MODEL}\n# Control`;
const OTHER_URL = "http://127.0.0.1:55334";

type ResultStatus = Stores.FakeTestStore["results"][number]["status"];

const seedResult = (
  tests: Stores.FakeTestStore,
  linearId: string | null = TICKET,
  status: ResultStatus = "pending",
) => {
  tests.results.push({
    id: RESULT_ID,
    runId: RUN_ID,
    definitionId: 1,
    sessionId: null,
    model: null,
    linearId,
    status,
    reason: null,
    createdAt: new Date(),
    finishedAt: null,
  });
};

const seedJob = (
  automation: Stores.FakeAutomationStore,
  action: "drive" | "diagnose" = "drive",
  resultId = RESULT_ID,
) => {
  automation.jobs.push({
    id: `00000000-0000-4000-8000-${String(automation.jobs.length + 1).padStart(12, "0")}`,
    resultId,
    action,
    status: "pending",
    reason: null,
    serverId: null,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
  });
};

const seedLiveClient = (servers: Stores.FakeServerStore, url = URL) => {
  const id = crypto.randomUUID();
  servers.servers.push({ id, url, type: "automation-client" });
  servers.heartbeats.push({ url, type: "automation-client", stats: STATS });
  return id;
};

// What a driver does on the far side of POST /run: ./ctrl test-results closes the result before
// opencode exits. A drive whose client answers without this is a driver that quit early.
const closing = (tests: Stores.FakeTestStore, status: ResultStatus = "passed") =>
  Effect.sync(() => {
    for (const row of tests.results) {
      row.status = status;
    }
    return FakeHttp.json({ ok: "true" });
  });

// A client whose /reserve is ok and whose every other request is answered by `respond`.
const reserving =
  (respond: FakeHttp.Respond): FakeHttp.Respond =>
  (request, url) =>
    url.pathname === "/reserve" ? FakeHttp.json({ ok: "true" }) : respond(request, url);

type Harness = {
  readonly automation: Stores.FakeAutomationStore;
  readonly servers: Stores.FakeServerStore;
  readonly tests: Stores.FakeTestStore;
  readonly log: FakeLog.FakeLog;
};

const harness = (): Harness => ({
  automation: Stores.fakeAutomationStore(),
  servers: Stores.fakeServerStore(),
  tests: Stores.fakeTestStore(),
  log: FakeLog.fakeLog(),
});

const layers = (
  fixed: Harness,
  http: Layer.Layer<HttpClient.HttpClient>,
  fs: Layer.Layer<FileSystem.FileSystem> = scriptsFs,
) =>
  Layer.mergeAll(
    fixed.automation.layer,
    fixed.servers.layer,
    fixed.tests.layer,
    fixed.log.layer,
    token,
    fs,
  ).pipe(Layer.provideMerge(http));

const start = (
  fixed: Harness,
  http: Layer.Layer<HttpClient.HttpClient>,
  fs?: Layer.Layer<FileSystem.FileSystem>,
) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* Worker.dispatch(MODEL).pipe(
      Effect.provide(layers(fixed, http, fs)),
      Scope.provide(scope),
    );
    return scope;
  });

const settle = (jobs: Array<{ status: string }>, status: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 1_000; i++) {
      if (jobs.some((job) => job.status === status)) {
        return yield* Effect.void;
      }
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(`job did not become ${status}: ${JSON.stringify(jobs)}`);
  });

describe("dispatch happy path", () => {
  it.effect("claims the job before POST /run", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      const clientId = seedLiveClient(fixed.servers);
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const http = FakeHttp.recordRequests(
        reserving(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            return yield* closing(fixed.tests);
          }),
        ),
      );
      yield* start(fixed, http.layer);
      yield* Deferred.await(started);
      expect(fixed.automation.jobs[0]?.status).toBe("running");
      expect(fixed.automation.jobs[0]?.serverId).toBe(clientId);
      expect(http.requests.map((request) => request.url)).toEqual([`${URL}/reserve`, `${URL}/run`]);
      yield* Deferred.succeed(release, undefined);
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
    }),
  );

  it.effect(
    "a drive job posts the driving prompt, the ticket and the model and succeeds on 200 once the result is closed",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests);
        seedJob(fixed.automation, "drive");
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "succeeded");
        expect(fixed.automation.jobs[0]).toMatchObject({
          status: "succeeded",
          reason: null,
          finishedAt: expect.any(Date),
        });
        expect(JSON.parse(http.requests[0]?.body ?? "")).toEqual({ ticket: TICKET });
        expect(JSON.parse(http.requests[1]?.body ?? "")).toEqual({
          prompt: DRIVE_PROMPT,
          ticket: TICKET,
          model: MODEL,
        });
        expect(FakeLog.texts(fixed.log)).toEqual([
          `dispatching drive; ${URL}; ${MODEL}`,
          "drive succeeded",
        ]);
        expect(fixed.log.lines[0]?.agentId).toBe(TICKET);
      }),
  );

  it.effect("a drive whose driver closed the result failed still succeeded as a job", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation, "drive");
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests, "failed")));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
    }),
  );

  it.effect("a diagnose job posts the diagnosing prompt and succeeds on 200", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation, "diagnose");
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
      expect(JSON.parse(http.requests[1]?.body ?? "")).toEqual({
        prompt: DIAGNOSE_PROMPT,
        ticket: TICKET,
        model: MODEL,
      });
      expect(FakeLog.texts(fixed.log)).toEqual([
        `dispatching diagnose; ${URL}; ${MODEL}`,
        "diagnose succeeded",
      ]);
    }),
  );

  it.effect("the next pending job runs after five seconds", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation, "drive");
      seedJob(fixed.automation, "diagnose");
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["succeeded", "pending"]);
      yield* TestClock.adjust("5 seconds");
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs.every((job) => job.status === "succeeded")).toBe(true);
      expect(http.requests.filter((request) => request.url.endsWith("/run"))).toHaveLength(2);
    }),
  );

  it.effect("a hang is still running after two hours, then succeeds when the client answers", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const http = FakeHttp.recordRequests(
        reserving(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            return yield* closing(fixed.tests);
          }),
        ),
      );
      yield* start(fixed, http.layer);
      yield* Deferred.await(started);
      yield* TestClock.adjust("2 hours");
      expect(fixed.automation.jobs[0]?.status).toBe("running");
      yield* Deferred.succeed(release, undefined);
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
    }),
  );
});

describe("a drive that returns with its result still open", () => {
  it.effect("running: the job is failed and the reason names the result and its status", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests, TICKET, "running");
      seedJob(fixed.automation, "drive");
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "failed");
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "failed",
        reason: `driver exited; result ${RESULT_ID} is running`,
      });
      expect(http.requests.map((request) => request.url)).toEqual([`${URL}/reserve`, `${URL}/run`]);
      expect(FakeLog.texts(fixed.log)).toEqual([
        `dispatching drive; ${URL}; ${MODEL}`,
        `drive failed; driver exited; result ${RESULT_ID} is running`,
      ]);
    }),
  );

  it.effect("pending: a driver that never even started its result fails the same way", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation, "drive");
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "failed");
      expect(fixed.automation.jobs[0]?.reason).toBe(
        `driver exited; result ${RESULT_ID} is pending`,
      );
    }),
  );

  it.effect(
    "a diagnose is never judged by the result: it succeeds on 200 with the result running",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests, TICKET, "running");
        seedJob(fixed.automation, "diagnose");
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "succeeded");
        expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
      }),
  );
});

describe("dispatch unhappy path", () => {
  it.effect("a 500 marks the job failed with the client's error", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(
        reserving(() => FakeHttp.json({ error: "opencode exited 1" }, 500)),
      );
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "failed");
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "failed",
        reason: `automation client: POST ${URL}/run failed: opencode exited 1`,
      });
      expect(FakeLog.texts(fixed.log)).toEqual([
        `dispatching drive; ${URL}; ${MODEL}`,
        `drive failed; automation client: POST ${URL}/run failed: opencode exited 1`,
      ]);
    }),
  );

  it.effect("closing the scope mid-request aborts the job", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const started = yield* Deferred.make<void>();
      const http = FakeHttp.recordRequests(
        reserving(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            return yield* Effect.never;
          }),
        ),
      );
      const scope = yield* start(fixed, http.layer);
      yield* Deferred.await(started);
      expect(fixed.automation.jobs[0]?.status).toBe("running");
      yield* Scope.close(scope, Exit.void);
      yield* settle(fixed.automation.jobs, "aborted");
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "aborted",
        reason: "automation server shutting down",
      });
      expect(FakeLog.texts(fixed.log)).toContain("drive aborted");
    }),
  );

  it.effect("no live automation-client does not claim and does not POST", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      yield* start(fixed, FakeHttp.die);
      yield* Effect.yieldNow;
      expect(fixed.automation.jobs[0]?.status).toBe("pending");
      expect(FakeLog.texts(fixed.log)).toEqual([]);
    }),
  );

  it.effect("a qemu-only fleet does not claim", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      fixed.servers.servers.push({ id: crypto.randomUUID(), url: URL, type: "qemu" });
      fixed.servers.heartbeats.push({ url: URL, type: "qemu", stats: STATS });
      yield* start(fixed, FakeHttp.die);
      yield* Effect.yieldNow;
      expect(fixed.automation.jobs[0]?.status).toBe("pending");
    }),
  );

  it.effect("no pending job does not POST", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedLiveClient(fixed.servers);
      yield* start(fixed, FakeHttp.die);
      yield* Effect.yieldNow;
      expect(fixed.automation.jobs).toEqual([]);
      expect(FakeLog.texts(fixed.log)).toEqual([]);
    }),
  );

  it.effect("an unreachable client marks the job failed", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.respondWith((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error("connect ECONNREFUSED 127.0.0.1:55333"),
            }),
          }),
        ),
      );
      yield* start(fixed, http);
      yield* settle(fixed.automation.jobs, "failed");
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "failed",
        reason: `automation client: POST ${URL}/reserve failed`,
      });
    }),
  );

  it.effect("a prompt that cannot be rendered marks the claimed job failed and does not POST", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const fs = FileSystem.layerNoop({
        readFileString: (path) => Effect.fail(FakeFs.permissionDenied("open", path)),
      });
      yield* start(fixed, FakeHttp.die, fs);
      yield* settle(fixed.automation.jobs, "failed");
      expect(fixed.automation.jobs[0]?.status).toBe("failed");
      expect(fixed.automation.jobs[0]?.reason).toMatch(/^prompt:/);
    }),
  );

  it.effect("a result with no Linear ticket fails after claim and does not POST", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests, null);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      yield* start(fixed, FakeHttp.die);
      yield* settle(fixed.automation.jobs, "failed");
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "failed",
        reason: "no Linear ticket",
      });
      expect(FakeLog.texts(fixed.log)).toEqual(["drive failed; no Linear ticket"]);
    }),
  );

  it.effect("a job already closed by abort does not die when dispatch finishes", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const http = FakeHttp.recordRequests(
        reserving(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            return yield* closing(fixed.tests);
          }),
        ),
      );
      yield* start(fixed, http.layer);
      yield* Deferred.await(started);
      const job = fixed.automation.jobs[0];
      expect(job?.status).toBe("running");
      expect(job?.serverId).not.toBeNull();
      if (job !== undefined) {
        job.status = "aborted";
        job.reason = "aborted";
        job.finishedAt = new Date();
      }
      yield* Deferred.succeed(release, undefined);
      for (let i = 0; i < 100; i++) {
        yield* Effect.yieldNow;
      }
      expect(fixed.automation.jobs[0]?.status).toBe("aborted");
      expect(fixed.automation.jobs[0]?.reason).toBe("aborted");
      expect(FakeLog.texts(fixed.log).some((text) => text.includes("dispatch tick failed"))).toBe(
        false,
      );
    }),
  );

  it.effect("a 503 from every client leaves the job pending and does not POST /run", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedJob(fixed.automation, "diagnose");
      const first = seedLiveClient(fixed.servers);
      const second = seedLiveClient(fixed.servers, OTHER_URL);
      const queued = fixed.automation.jobs.map((job) => ({
        id: job.id,
        createdAt: job.createdAt,
      }));
      const http = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: "at capacity: max-jobs is 1" }, 503),
      );
      yield* start(fixed, http.layer);
      for (let i = 0; i < 200; i++) {
        if (FakeLog.texts(fixed.log).includes("deferred; at capacity")) {
          break;
        }
        yield* Effect.yieldNow;
      }
      expect(fixed.automation.jobs).toHaveLength(2);
      expect(fixed.automation.jobs.map((job) => job.id)).toEqual(queued.map((job) => job.id));
      expect(fixed.automation.jobs.every((job) => job.status === "pending")).toBe(true);
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "pending",
        serverId: null,
        startedAt: null,
        finishedAt: null,
        reason: null,
      });
      expect(fixed.automation.jobs[1]).toMatchObject({
        status: "pending",
        serverId: null,
        startedAt: null,
        finishedAt: null,
        reason: null,
      });
      expect(fixed.automation.jobs[0]?.createdAt).toBe(queued[0]?.createdAt);
      expect(fixed.automation.jobs[1]?.createdAt).toBe(queued[1]?.createdAt);
      expect(http.requests.map((request) => request.url)).toEqual([
        `${URL}/reserve`,
        `${OTHER_URL}/reserve`,
      ]);
      expect(FakeLog.texts(fixed.log)).toEqual(["deferred; at capacity"]);
      expect(fixed.log.lines[0]?.agentId).toBe(TICKET);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
    }),
  );

  it.effect("a 503 from the first client places the job on the next", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      const first = seedLiveClient(fixed.servers);
      const second = seedLiveClient(fixed.servers, OTHER_URL);
      const http = FakeHttp.recordRequests((request, url) => {
        if (url.pathname === "/reserve" && url.href.startsWith(URL)) {
          return FakeHttp.json({ error: "at capacity: max-jobs is 1" }, 503);
        }
        return reserving(() => closing(fixed.tests))(request, url);
      });
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "succeeded",
        serverId: second,
      });
      expect(fixed.automation.jobs[0]?.serverId).not.toBe(first);
      expect(http.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        `POST ${URL}/reserve`,
        `POST ${OTHER_URL}/reserve`,
        `POST ${OTHER_URL}/run`,
      ]);
    }),
  );
});
