import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Redacted,
  Scope,
} from "effect";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeLinear from "../support/fake-linear.ts";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientError, HttpRouter } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import * as Handlers from "../../src/automation-client/handlers.ts";
import * as Sessions from "../../src/automation-client/sessions.ts";
import * as AutomationClient from "../../src/automation-server/client.ts";
import * as Config from "../../src/config.ts";
import * as Automation from "../../src/db/automation.ts";
import * as Worker from "../../src/automation-server/worker.ts";
import * as SetupRequests from "../../src/db/setup-requests.ts";
import * as Log from "../../src/observability/log.ts";
import * as FakeFs from "../support/fake-fs.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";
import * as FakeLog from "../support/log.ts";
import * as Stores from "../support/stores.ts";

const URL = "http://127.0.0.1:55333";
const TOKEN = "test-token";
const TICKET = "OLI-42";
const TICKET_B = "OLI-43";
const RESULT_ID = "22222222-2222-4222-8222-222222222222";
const RESULT_B = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "66666666-6666-4666-8666-666666666666";
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

// The prompt templates the worker renders, by file name.
const template = (path: string): string => {
  if (path.endsWith("driving-agent.html")) {
    return "drive {{LINEAR_TICKET}} as {{MODEL}}";
  }
  if (path.endsWith("diagnosing-agent.html")) {
    return "diagnose {{LINEAR_TICKET}} {{RESULT_ID}} {{MODEL}}\n{{CTRL_DIAGNOSE_MD}}";
  }
  if (path.endsWith("ctrl-diagnose.md")) {
    return "# Control";
  }
  return `contents of ${path}`;
};

const scriptsFs = FileSystem.layerNoop({
  readFileString: (path) => Effect.succeed(template(path)),
});

const DRIVE_PROMPT = `drive ${TICKET} as ${MODEL}`;
const DIAGNOSE_PROMPT = `diagnose ${TICKET} ${RESULT_ID} ${MODEL}\n# Control`;
const OTHER_URL = "http://127.0.0.1:55334";
const THIRD_URL = "http://127.0.0.1:55335";

type ResultStatus = Stores.FakeTestStore["results"][number]["status"];

const seedResult = (
  tests: Stores.FakeTestStore,
  linearId: string | null = TICKET,
  status: ResultStatus = "pending",
  resultId = RESULT_ID,
) => {
  tests.results.push({
    id: resultId,
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

type JobStatus = Stores.FakeAutomationStore["jobs"][number]["status"];

const seedJob = (
  automation: Stores.FakeAutomationStore,
  action: "drive" | "diagnose" | "mint" = "drive",
  resultId = RESULT_ID,
  status: JobStatus = "pending",
) => {
  automation.jobs.push({
    id: `00000000-0000-4000-8000-${String(automation.jobs.length + 1).padStart(12, "0")}`,
    resultId,
    action,
    status,
    reason: null,
    serverId: null,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
  });
};

// A diagnose is dispatched only after the drive that ran its result completed.
const seedDiagnose = (automation: Stores.FakeAutomationStore, resultId = RESULT_ID) => {
  seedJob(automation, "diagnose", resultId);
  seedJob(automation, "drive", resultId, "completed");
};

const seedLiveClient = (servers: Stores.FakeServerStore, url = URL) => {
  const id = crypto.randomUUID();
  servers.servers.push({ id, url, name: null, type: "automation-client" });
  servers.heartbeats.push({ url, type: "automation-client", name: "garage", stats: STATS });
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

const erroredMoves = (linear: FakeLinear.FakeLinear) =>
  linear.calls.filter((call) => call.method === "moveToErrored");

const verdictMoves = (linear: FakeLinear.FakeLinear) =>
  linear.calls.filter(
    (call) => call.method === "moveToFailed" || call.method === "moveToSucceeded",
  );

type Harness = {
  readonly automation: Stores.FakeAutomationStore;
  readonly servers: Stores.FakeServerStore;
  readonly sessions: Stores.FakeSessionStore;
  readonly diagnosis: Stores.FakeDiagnosisStore;
  readonly tests: Stores.FakeTestStore;
  readonly log: FakeLog.FakeLog;
  readonly linear: FakeLinear.FakeLinear;
  readonly pins: Map<string, string>;
};

const harness = (
  linear: FakeLinear.FakeLinear = FakeLinear.fakeLinear(),
  automation: Stores.FakeAutomationStore = Stores.fakeAutomationStore(),
): Harness => ({
  automation,
  servers: Stores.fakeServerStore(),
  sessions: Stores.fakeSessionStore(),
  diagnosis: Stores.fakeDiagnosisStore(),
  tests: Stores.fakeTestStore(),
  log: FakeLog.fakeLog(),
  linear,
  pins: new Map(),
});

// The diagnosing agent writes this during /run, on the drive's session, before the job closes.
const seedVerdict = (
  fixed: Harness,
  verdict: "passed" | "failed",
  resultId = RESULT_ID,
  sessionId = SESSION_ID,
) => {
  const result = fixed.tests.results.find((row) => row.id === resultId);
  if (result !== undefined) {
    result.sessionId = sessionId;
  }
  fixed.diagnosis.diagnoses.push({
    sessionId,
    verdict,
    errorType: verdict === "failed" ? "guest-crash" : null,
    summary: "the proof",
    model: MODEL,
    createdAt: new Date(),
  });
};

const cleared = (identifier: string) => ({ method: "clearReady" as const, identifier });

const unexpected = (method: string) =>
  Effect.die(new Error(`unexpected SetupRequestStore.${method}`));

const setupLayer = (pins: Map<string, string>) =>
  Layer.succeed(SetupRequests.SetupRequestStore)(
    SetupRequests.SetupRequestStore.of({
      insert: () => unexpected("insert"),
      setResult: () => unexpected("setResult"),
      remove: () => unexpected("remove"),
      removeServer: () => unexpected("removeServer"),
      list: () => unexpected("list"),
      inspect: () => unexpected("inspect"),
      serverForResult: (resultId) =>
        Effect.sync(() => {
          const serverUrl = pins.get(resultId);
          return serverUrl === undefined ? Option.none() : Option.some(serverUrl);
        }),
    }),
  );

const layers = (
  fixed: Harness,
  http: Layer.Layer<HttpClient.HttpClient>,
  fs: Layer.Layer<FileSystem.FileSystem> = scriptsFs,
) =>
  Layer.mergeAll(
    fixed.automation.layer,
    fixed.servers.layer,
    fixed.sessions.layer,
    fixed.diagnosis.layer,
    fixed.tests.layer,
    fixed.log.layer,
    fixed.linear.layer,
    setupLayer(fixed.pins),
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

const settleAll = (jobs: Array<{ status: string }>, status: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 1_000; i++) {
      if (jobs.length > 0 && jobs.every((job) => job.status === status)) {
        return yield* Effect.void;
      }
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(`jobs did not all become ${status}: ${JSON.stringify(jobs)}`);
  });

// log.error without skipSentry is what the Log service hands to Sentry.
const sentryErrors = (log: FakeLog.FakeLog) =>
  log.lines.filter((line) => line.level === "error" && !line.skipSentry);

const seedPair = (fixed: Harness) => {
  seedResult(fixed.tests);
  seedResult(fixed.tests, TICKET_B, "pending", RESULT_B);
  seedJob(fixed.automation, "drive", RESULT_ID);
  seedJob(fixed.automation, "drive", RESULT_B);
};

describe("markRunning acknowledgement", () => {
  it.effect("a row already running for the same client is success, and another client is not", () =>
    Effect.gen(function* () {
      const automation = Stores.fakeAutomationStore();
      const serverId = "11111111-1111-4111-8111-111111111111";
      const other = "22222222-2222-4222-8222-222222222222";
      yield* Effect.gen(function* () {
        const store = yield* Automation.AutomationStore;
        const job = yield* store.enqueue({ resultId: RESULT_ID, action: "drive" });
        const row = automation.jobs.find((candidate) => candidate.id === job.id);
        if (row !== undefined) {
          row.status = "running";
          row.serverId = serverId;
          row.startedAt = new Date();
        }
        expect(yield* store.markRunning(job.id, serverId)).toBe(true);
        expect(yield* store.markRunning(job.id, other)).toBe(false);
        if (row !== undefined) {
          row.status = "aborted";
        }
        expect(yield* store.markRunning(job.id, serverId)).toBe(false);
      }).pipe(Effect.provide(automation.layer));
    }),
  );
});

describe("dispatch happy path", () => {
  it.effect("a pending row stays pending while /reserve is in flight", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const reserved = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const http = FakeHttp.recordRequests((request, url) => {
        if (url.pathname === "/reserve") {
          return Effect.gen(function* () {
            yield* Deferred.succeed(reserved, undefined);
            yield* Deferred.await(release);
            return FakeHttp.json({ ok: "true" });
          });
        }
        return closing(fixed.tests);
      });
      yield* start(fixed, http.layer);
      yield* Deferred.await(reserved);
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "pending",
        serverId: null,
        startedAt: null,
        finishedAt: null,
        reason: null,
      });
      expect(http.requests.map((request) => request.url)).toEqual([`${URL}/reserve`]);
      yield* Deferred.succeed(release, undefined);
      yield* settle(fixed.automation.jobs, "completed");
    }),
  );

  it.effect(
    "a successful reserve moves the job to running on the accepting client and starts /run",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests);
        seedJob(fixed.automation);
        const first = seedLiveClient(fixed.servers);
        const second = seedLiveClient(fixed.servers, OTHER_URL);
        const reserved = yield* Deferred.make<void>();
        const releaseReserve = yield* Deferred.make<void>();
        const started = yield* Deferred.make<void>();
        const releaseRun = yield* Deferred.make<void>();
        const http = FakeHttp.recordRequests((request, url) => {
          if (url.pathname === "/reserve") {
            if (url.href.startsWith(URL)) {
              return FakeHttp.json({ error: "at capacity: max-jobs is 1" }, 503);
            }
            return Effect.gen(function* () {
              yield* Deferred.succeed(reserved, undefined);
              yield* Deferred.await(releaseReserve);
              return FakeHttp.json({ ok: "true" });
            });
          }
          return Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(releaseRun);
            return yield* closing(fixed.tests);
          });
        });
        yield* start(fixed, http.layer);
        yield* Deferred.await(reserved);
        expect(fixed.automation.jobs[0]).toMatchObject({
          status: "pending",
          serverId: null,
          startedAt: null,
        });
        expect(http.requests.map((request) => request.url)).toEqual([
          `${URL}/reserve`,
          `${OTHER_URL}/reserve`,
        ]);
        yield* Deferred.succeed(releaseReserve, undefined);
        yield* Deferred.await(started);
        expect(fixed.automation.jobs[0]).toMatchObject({
          status: "running",
          serverId: second,
          startedAt: expect.any(Date),
        });
        expect(fixed.automation.jobs[0]?.serverId).not.toBe(first);
        expect(http.requests.map((request) => request.url)).toEqual([
          `${URL}/reserve`,
          `${OTHER_URL}/reserve`,
          `${OTHER_URL}/run`,
        ]);
        yield* Deferred.succeed(releaseRun, undefined);
        yield* settle(fixed.automation.jobs, "completed");
        expect(fixed.linear.calls.filter((call) => call.method === "moveIssue")).toEqual([]);
      }),
  );

  it.effect(
    "a drive job posts the driving prompt, the ticket and the model and completes on 200 once the result is closed",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests);
        seedJob(fixed.automation, "drive");
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "completed");
        expect(fixed.automation.jobs[0]).toMatchObject({
          status: "completed",
          reason: null,
          finishedAt: expect.any(Date),
        });
        // A drive reserves as one: the client takes a guest slot before its own.
        expect(JSON.parse(http.requests[0]?.body ?? "")).toEqual({
          ticket: TICKET,
          action: "drive",
        });
        expect(JSON.parse(http.requests[1]?.body ?? "")).toEqual({
          prompt: DRIVE_PROMPT,
          ticket: TICKET,
          model: MODEL,
        });
        expect(FakeLog.texts(fixed.log)).toEqual([
          `dispatching drive; ${URL}; ${MODEL}`,
          "drive completed",
        ]);
        expect(fixed.linear.calls).toEqual([
          { method: "moveToInProgress", identifier: TICKET },
          cleared(TICKET),
          { method: "moveToNeedsReview", identifier: TICKET },
        ]);
        expect(fixed.log.lines[0]?.agentId).toBe(TICKET);
      }),
  );

  it.effect("a drive whose driver closed the result failed is still completed as a job", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation, "drive");
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests, "failed")));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "completed");
      expect(fixed.automation.jobs[0]?.status).toBe("completed");
      expect(fixed.linear.calls).toEqual([
        { method: "moveToInProgress", identifier: TICKET },
        cleared(TICKET),
        { method: "moveToNeedsReview", identifier: TICKET },
      ]);
    }),
  );

  it.effect("a diagnose job posts the diagnosing prompt and succeeds on 200", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedVerdict(fixed, "passed");
      seedDiagnose(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
      // A diagnose reserves as one: the client takes a slot of its own and no guest.
      expect(JSON.parse(http.requests[0]?.body ?? "")).toEqual({
        ticket: TICKET,
        action: "diagnose",
      });
      expect(JSON.parse(http.requests[1]?.body ?? "")).toEqual({
        prompt: DIAGNOSE_PROMPT,
        ticket: TICKET,
        model: MODEL,
      });
      expect(FakeLog.texts(fixed.log)).toEqual([
        `dispatching diagnose; ${URL}; ${MODEL}`,
        "diagnose succeeded",
      ]);
      expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([]);
      expect(fixed.linear.calls.filter((call) => call.method === "moveToInProgress")).toEqual([]);
      expect(fixed.linear.calls.filter((call) => call.method === "moveToNeedsReview")).toEqual([]);
      expect(verdictMoves(fixed.linear)).toEqual([
        { method: "moveToSucceeded", identifier: TICKET },
      ]);
    }),
  );

  it.effect("round robin wraps, so a client that already took a job can take the next", () =>
    Effect.gen(function* () {
      const fixed = harness();
      const thirdResult = "44444444-4444-4444-8444-444444444444";
      const fourthResult = "55555555-5555-4555-8555-555555555555";
      seedPair(fixed);
      seedResult(fixed.tests, "OLI-44", "pending", thirdResult);
      seedResult(fixed.tests, "OLI-45", "pending", fourthResult);
      seedJob(fixed.automation, "drive", thirdResult);
      seedJob(fixed.automation, "drive", fourthResult);
      const first = seedLiveClient(fixed.servers, URL);
      const second = seedLiveClient(fixed.servers, OTHER_URL);
      const third = seedLiveClient(fixed.servers, THIRD_URL);
      const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
      yield* start(fixed, http.layer);
      yield* settleAll(fixed.automation.jobs, "completed");
      expect(fixed.automation.jobs.map((job) => job.serverId)).toEqual([
        first,
        second,
        third,
        first,
      ]);
      expect(
        FakeLog.texts(fixed.log).filter((text) => text.startsWith("dispatching drive")),
      ).toEqual([
        `dispatching drive; ${URL}; ${MODEL}`,
        `dispatching drive; ${OTHER_URL}; ${MODEL}`,
        `dispatching drive; ${THIRD_URL}; ${MODEL}`,
        `dispatching drive; ${URL}; ${MODEL}`,
      ]);
      expect(http.requests.filter((request) => request.url.endsWith("/reserve"))).toHaveLength(4);
    }),
  );

  it.effect("the next job is not reserved until the reservation in front of it succeeds", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedPair(fixed);
      seedLiveClient(fixed.servers, URL);
      seedLiveClient(fixed.servers, OTHER_URL);
      const firstHeld = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const secondHeld = yield* Deferred.make<void>();
      const releaseSecond = yield* Deferred.make<void>();
      const firstRun = yield* Deferred.make<void>();
      const secondRun = yield* Deferred.make<void>();
      let reserves = 0;
      let runs = 0;
      const http = FakeHttp.recordRequests((request, url) => {
        if (url.pathname === "/reserve") {
          reserves += 1;
          if (reserves === 1) {
            return Effect.gen(function* () {
              yield* Deferred.succeed(firstHeld, undefined);
              yield* Deferred.await(releaseFirst);
              return FakeHttp.json({ ok: "true" });
            });
          }
          if (reserves === 2) {
            return Effect.gen(function* () {
              yield* Deferred.succeed(secondHeld, undefined);
              yield* Deferred.await(releaseSecond);
              return FakeHttp.json({ ok: "true" });
            });
          }
          return Effect.die(new Error(`unexpected reserve ${String(reserves)}`));
        }
        const index = runs;
        runs += 1;
        return Effect.gen(function* () {
          if (index === 0) {
            yield* Deferred.succeed(firstRun, undefined);
          } else if (index === 1) {
            yield* Deferred.succeed(secondRun, undefined);
          } else {
            return yield* Effect.die(new Error(`unexpected /run ${String(index)}`));
          }
          return yield* closing(fixed.tests);
        });
      });
      yield* start(fixed, http.layer);
      yield* Deferred.await(firstHeld);
      for (let i = 0; i < 50; i++) {
        yield* Effect.yieldNow;
      }
      expect(http.requests.filter((request) => request.url.endsWith("/reserve"))).toHaveLength(1);
      expect(http.requests.filter((request) => request.url.endsWith("/run"))).toHaveLength(0);
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Deferred.await(firstRun);
      yield* Deferred.await(secondHeld);
      for (let i = 0; i < 50; i++) {
        yield* Effect.yieldNow;
      }
      expect(http.requests.filter((request) => request.url.endsWith("/reserve"))).toHaveLength(2);
      expect(http.requests.filter((request) => request.url.endsWith("/run"))).toHaveLength(1);
      yield* Deferred.succeed(releaseSecond, undefined);
      yield* Deferred.await(secondRun);
      yield* settleAll(fixed.automation.jobs, "completed");
      expect(fixed.automation.jobs.every((job) => job.status === "completed")).toBe(true);
    }),
  );

  it.effect("a /run still in flight does not hold the next pending job", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedPair(fixed);
      seedLiveClient(fixed.servers);
      seedLiveClient(fixed.servers, OTHER_URL);
      const firstStarted = yield* Deferred.make<void>();
      const secondStarted = yield* Deferred.make<void>();
      const firstRelease = yield* Deferred.make<void>();
      const secondRelease = yield* Deferred.make<void>();
      let runs = 0;
      const http = FakeHttp.recordRequests(
        reserving(() =>
          Effect.gen(function* () {
            const index = runs;
            runs += 1;
            if (index === 0) {
              yield* Deferred.succeed(firstStarted, undefined);
              yield* Deferred.await(firstRelease);
            } else if (index === 1) {
              yield* Deferred.succeed(secondStarted, undefined);
              yield* Deferred.await(secondRelease);
            } else {
              return yield* Effect.die(`unexpected /run ${String(index)}`);
            }
            return yield* closing(fixed.tests);
          }),
        ),
      );
      yield* start(fixed, http.layer);
      yield* Deferred.await(firstStarted);
      yield* Deferred.await(secondStarted);
      expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["running", "running"]);
      expect(http.requests.filter((request) => request.url.endsWith("/run"))).toHaveLength(2);
      yield* Deferred.succeed(firstRelease, undefined);
      yield* Deferred.succeed(secondRelease, undefined);
      yield* settleAll(fixed.automation.jobs, "completed");
      expect(fixed.automation.jobs.every((job) => job.status === "completed")).toBe(true);
    }),
  );

  // A diagnose is queued once its ticket reaches Needs Review, while the drive that got it there
  // is still running; it goes before every pending drive, but not before its own result is free.
  it.effect("a diagnose behind a running drive is skipped so another result can start", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation, "drive", RESULT_ID);
      seedLiveClient(fixed.servers);
      const firstStarted = yield* Deferred.make<void>();
      const secondStarted = yield* Deferred.make<void>();
      const firstRelease = yield* Deferred.make<void>();
      const secondRelease = yield* Deferred.make<void>();
      let runs = 0;
      const http = FakeHttp.recordRequests(
        reserving(() =>
          Effect.gen(function* () {
            const index = runs;
            runs += 1;
            if (index === 0) {
              yield* Deferred.succeed(firstStarted, undefined);
              yield* Deferred.await(firstRelease);
            } else if (index === 1) {
              yield* Deferred.succeed(secondStarted, undefined);
              yield* Deferred.await(secondRelease);
            } else {
              return yield* Effect.die(`unexpected /run ${String(index)}`);
            }
            return yield* closing(fixed.tests);
          }),
        ),
      );
      yield* start(fixed, http.layer);
      yield* Deferred.await(firstStarted);
      seedJob(fixed.automation, "diagnose", RESULT_ID);
      seedResult(fixed.tests, TICKET_B, "pending", RESULT_B);
      seedJob(fixed.automation, "drive", RESULT_B);
      yield* TestClock.adjust("5 seconds");
      yield* Deferred.await(secondStarted);
      expect(fixed.automation.jobs.map((job) => [job.action, job.status])).toEqual([
        ["drive", "running"],
        ["diagnose", "pending"],
        ["drive", "running"],
      ]);
      expect(http.requests.filter((request) => request.url.endsWith("/reserve"))).toHaveLength(2);
      expect(http.requests.filter((request) => request.url.endsWith("/run"))).toHaveLength(2);
      yield* Deferred.succeed(firstRelease, undefined);
      yield* Deferred.succeed(secondRelease, undefined);
      yield* settle(fixed.automation.jobs, "completed");
      expect(fixed.automation.jobs.map((job) => [job.action, job.status])).toEqual([
        ["drive", "completed"],
        ["diagnose", "pending"],
        ["drive", "completed"],
      ]);
    }),
  );

  it.effect("a hang is still running after two hours, then completes when the client answers", () =>
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
      yield* settle(fixed.automation.jobs, "completed");
      expect(fixed.automation.jobs[0]?.status).toBe("completed");
    }),
  );

  it.effect(
    "a reserved drive stays running and does not start /run until Linear is In Progress",
    () =>
      Effect.gen(function* () {
        const moving = yield* Deferred.make<void>();
        const releaseMove = yield* Deferred.make<void>();
        let moves = 0;
        const fixed = harness(
          FakeLinear.fakeLinear({
            overrides: {
              moveToInProgress: (identifier) =>
                Effect.gen(function* () {
                  moves += 1;
                  expect(identifier).toBe(TICKET);
                  yield* Deferred.succeed(moving, undefined);
                  yield* Deferred.await(releaseMove);
                }),
            },
          }),
        );
        seedResult(fixed.tests);
        seedJob(fixed.automation);
        const clientId = seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
        yield* start(fixed, http.layer);
        yield* Deferred.await(moving);
        expect(fixed.automation.jobs[0]).toMatchObject({
          status: "running",
          serverId: clientId,
          startedAt: expect.any(Date),
        });
        expect(http.requests.map((request) => request.url)).toEqual([`${URL}/reserve`]);
        expect(FakeLog.texts(fixed.log).some((text) => text.startsWith("dispatching"))).toBe(false);
        yield* Deferred.succeed(releaseMove, undefined);
        yield* settle(fixed.automation.jobs, "completed");
        expect(moves).toBe(1);
        expect(http.requests.map((request) => request.url)).toEqual([
          `${URL}/reserve`,
          `${URL}/run`,
        ]);
        expect(FakeLog.texts(fixed.log)).toEqual([
          `dispatching drive; ${URL}; ${MODEL}`,
          "drive completed",
        ]);
      }),
  );

  it.effect("a move to In Progress that fails twice then succeeds starts /run", () => {
    const refused = Errors.LinearError.make({
      operation: "moveToInProgress",
      message: `linear: moving ${TICKET} to In Progress failed`,
    });
    let attempts = 0;
    const fixed = harness(
      FakeLinear.fakeLinear({
        overrides: {
          moveToInProgress: () =>
            Effect.gen(function* () {
              attempts += 1;
              if (attempts < 3) {
                return yield* Effect.fail(refused);
              }
              return yield* Effect.void;
            }),
        },
      }),
    );
    return Effect.gen(function* () {
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      const clientId = seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "completed");
      expect(attempts).toBe(3);
      expect(fixed.automation.jobs[0]).toMatchObject({ status: "completed", serverId: clientId });
      expect(http.requests.map((request) => request.url)).toEqual([`${URL}/reserve`, `${URL}/run`]);
      expect(sentryErrors(fixed.log)).toEqual([]);
    });
  });
});

describe("the harness closes the board", () => {
  it.effect("a mint that ran to its end moves the ticket to Needs Review", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation, "mint");
      fixed.pins.set(RESULT_ID, "http://127.0.0.1:55332");
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "completed");
      expect(fixed.automation.jobs[0]).toMatchObject({
        action: "mint",
        status: "completed",
        reason: null,
      });
      expect(fixed.linear.calls).toEqual([
        { method: "moveToInProgress", identifier: TICKET },
        cleared(TICKET),
        { method: "moveToNeedsReview", identifier: TICKET },
      ]);
      expect(FakeLog.texts(fixed.log)).toEqual([
        `dispatching mint; ${URL}; ${MODEL}`,
        "mint completed",
      ]);
      expect(sentryErrors(fixed.log)).toEqual([]);
    }),
  );

  it.effect(
    "a Needs Review move that fails three times leaves the job completed and reports the failure (unhappy)",
    () => {
      const refused = Errors.LinearError.make({
        operation: "stateIds",
        message: "linear: no state named Needs Review",
      });
      let attempts = 0;
      const fixed = harness(
        FakeLinear.fakeLinear({
          overrides: {
            moveToNeedsReview: () =>
              Effect.sync(() => {
                attempts += 1;
              }).pipe(Effect.andThen(Effect.fail(refused))),
          },
        }),
      );
      return Effect.gen(function* () {
        seedResult(fixed.tests);
        seedJob(fixed.automation);
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "completed");
        yield* eventually(() => attempts === 3, "three Needs Review attempts");
        expect(attempts).toBe(3);
        expect(fixed.automation.jobs[0]).toMatchObject({ status: "completed", reason: null });
        expect(sentryErrors(fixed.log)).toEqual([
          expect.objectContaining({
            text: "move to Needs Review failed: linear: no state named Needs Review",
            agentId: TICKET,
            cause: refused,
          }),
        ]);
      });
    },
  );

  it.effect("a finished drive with no ticket is completed and not moved (unhappy)", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests, null, "passed");
      seedRunning(fixed.automation, seedLiveClient(fixed.servers));
      yield* start(fixed, FakeHttp.die);
      yield* settle(fixed.automation.jobs, "completed");
      expect(fixed.automation.jobs[0]).toMatchObject({ status: "completed", reason: null });
      expect(fixed.linear.calls).toEqual([]);
    }),
  );

  it.effect("a diagnose whose verdict is failed moves the ticket to Failed", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests, TICKET, "failed");
      seedVerdict(fixed, "failed");
      seedDiagnose(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs[0]).toMatchObject({ action: "diagnose", status: "succeeded" });
      expect(verdictMoves(fixed.linear)).toEqual([{ method: "moveToFailed", identifier: TICKET }]);
      expect(fixed.linear.calls.filter((call) => call.method === "moveToNeedsReview")).toEqual([]);
      expect(FakeLog.texts(fixed.log)).toEqual([
        `dispatching diagnose; ${URL}; ${MODEL}`,
        "diagnose succeeded",
      ]);
    }),
  );

  it.effect("a diagnose with no session logs the missing verdict and does not move (unhappy)", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests, TICKET, "failed");
      seedDiagnose(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "succeeded");
      yield* eventually(
        () => FakeLog.texts(fixed.log).some((text) => text.startsWith("diagnose verdict")),
        "the missing verdict",
      );
      expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
      expect(verdictMoves(fixed.linear)).toEqual([]);
      expect(sentryErrors(fixed.log)).toEqual([
        expect.objectContaining({
          text: `diagnose verdict missing; ${RESULT_ID}`,
          agentId: TICKET,
        }),
      ]);
    }),
  );

  it.effect("a diagnose whose session has no verdict logs that and does not move (unhappy)", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests, TICKET, "failed");
      const result = fixed.tests.results[0];
      if (result !== undefined) {
        result.sessionId = SESSION_ID;
      }
      seedDiagnose(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "succeeded");
      yield* eventually(
        () => FakeLog.texts(fixed.log).some((text) => text.startsWith("diagnose verdict")),
        "the missing verdict",
      );
      expect(verdictMoves(fixed.linear)).toEqual([]);
      expect(sentryErrors(fixed.log)).toEqual([
        expect.objectContaining({
          text: `diagnose verdict missing; ${SESSION_ID}`,
          agentId: TICKET,
        }),
      ]);
    }),
  );

  it.effect(
    "a diagnosis read that fails three times leaves the job succeeded and does not move (unhappy)",
    () => {
      const failure = Errors.DatabaseError.make({
        operation: "getDiagnosis",
        message: "Failed query: getDiagnosis",
        cause: new Error("connection reset"),
      });
      let reads = 0;
      const diagnosis = Stores.fakeDiagnosisStore({
        getDiagnosis: () =>
          Effect.sync(() => {
            reads += 1;
          }).pipe(Effect.andThen(Effect.fail(failure))),
      });
      return Effect.gen(function* () {
        const fixed = { ...harness(), diagnosis };
        seedResult(fixed.tests, TICKET, "failed");
        const result = fixed.tests.results[0];
        if (result !== undefined) {
          result.sessionId = SESSION_ID;
        }
        seedDiagnose(fixed.automation);
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "succeeded");
        yield* eventually(() => reads === 3, "three diagnosis reads");
        expect(reads).toBe(3);
        expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
        expect(verdictMoves(fixed.linear)).toEqual([]);
        expect(sentryErrors(fixed.log)).toEqual([
          expect.objectContaining({
            text: `diagnose verdict read failed; ${SESSION_ID}: connection reset`,
            agentId: TICKET,
            cause: failure,
          }),
        ]);
      });
    },
  );

  it.effect(
    "a move to Succeeded that fails three times leaves the job succeeded and reports the failure (unhappy)",
    () => {
      const refused = Errors.LinearError.make({
        operation: "moveToSucceeded",
        message: `linear: moving ${TICKET} to Succeeded failed`,
      });
      let attempts = 0;
      const fixed = harness(
        FakeLinear.fakeLinear({
          overrides: {
            moveToSucceeded: () =>
              Effect.sync(() => {
                attempts += 1;
              }).pipe(Effect.andThen(Effect.fail(refused))),
          },
        }),
      );
      return Effect.gen(function* () {
        seedResult(fixed.tests, TICKET, "passed");
        seedVerdict(fixed, "passed");
        seedDiagnose(fixed.automation);
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "succeeded");
        yield* eventually(() => attempts === 3, "three Succeeded attempts");
        expect(attempts).toBe(3);
        expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
        expect(sentryErrors(fixed.log)).toEqual([
          expect.objectContaining({
            text: `move to Succeeded failed: linear: moving ${TICKET} to Succeeded failed`,
            agentId: TICKET,
            cause: refused,
          }),
        ]);
      });
    },
  );
});

describe("a drive that returns with its result still open", () => {
  it.effect(
    "running: the job and the result are errored with the reason, and the ticket moves to Errored",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests, TICKET, "running");
        seedJob(fixed.automation, "drive");
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "errored");
        const reason = `driver exited; result ${RESULT_ID} is running`;
        expect(fixed.automation.jobs[0]).toMatchObject({ status: "errored", reason });
        expect(fixed.tests.results[0]).toMatchObject({ status: "errored", reason });
        expect(http.requests.map((request) => request.url)).toEqual([
          `${URL}/reserve`,
          `${URL}/run`,
        ]);
        expect(FakeLog.texts(fixed.log)).toEqual([
          `dispatching drive; ${URL}; ${MODEL}`,
          `drive errored; ${reason}`,
        ]);
        expect(erroredMoves(fixed.linear)).toEqual([
          { method: "moveToErrored", identifier: TICKET, message: `drive errored; ${reason}` },
        ]);
        expect(fixed.linear.calls.filter((call) => call.method === "moveToNeedsReview")).toEqual(
          [],
        );
      }),
  );

  it.effect("a result lookup that fails after /run errors the job (unhappy)", () => {
    const failure = Errors.DatabaseError.make({
      operation: "findResult",
      message: "connection reset",
      cause: new Error("connection reset"),
    });
    let lookups = 0;
    const held: { tests: Stores.FakeTestStore | undefined } = { tests: undefined };
    const tests = Stores.fakeTestStore(
      {},
      {
        findResult: (resultId) =>
          Effect.gen(function* () {
            lookups += 1;
            if (lookups === 2) {
              return yield* Effect.fail(failure);
            }
            return Option.fromUndefinedOr(held.tests?.results.find((row) => row.id === resultId));
          }),
      },
    );
    held.tests = tests;
    return Effect.gen(function* () {
      const fixed = { ...harness(), tests };
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "errored");
      expect(lookups).toBeGreaterThanOrEqual(2);
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "errored",
        reason: "connection reset",
      });
      expect(FakeLog.texts(fixed.log)).toEqual([
        `dispatching drive; ${URL}; ${MODEL}`,
        "drive errored; connection reset",
      ]);
    });
  });

  it.effect("a result that vanishes during the drive errors the job (unhappy)", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(
        reserving(() =>
          Effect.sync(() => {
            fixed.tests.results.splice(0, fixed.tests.results.length);
            return FakeHttp.json({ ok: "true" });
          }),
        ),
      );
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "errored");
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "errored",
        reason: `judge: result ${RESULT_ID} vanished during the drive`,
      });
    }),
  );

  it.effect("pending: a driver that never even started its result errors the same way", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation, "drive");
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "errored");
      expect(fixed.automation.jobs[0]?.reason).toBe(
        `driver exited; result ${RESULT_ID} is pending`,
      );
      expect(fixed.tests.results[0]?.status).toBe("errored");
    }),
  );

  it.effect(
    "a diagnose is never judged by the result: it succeeds on 200 with the result running",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests, TICKET, "running");
        seedDiagnose(fixed.automation);
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "succeeded");
        expect(fixed.automation.jobs[0]?.status).toBe("succeeded");
      }),
  );

  it.effect(
    "a closed result whose session the qemu server errored is errored with the session's reason",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        const sessionId = "44444444-4444-4444-8444-444444444444";
        seedResult(fixed.tests);
        seedJob(fixed.automation, "drive");
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(
          reserving(() =>
            Effect.gen(function* () {
              fixed.sessions.sessions.push({
                id: sessionId,
                config: { iso: "x" },
                status: "errored",
                reason: "qemu exited 137",
                startedAt: new Date(),
                endedAt: new Date(),
              });
              const result = fixed.tests.results[0];
              if (result !== undefined) {
                result.sessionId = sessionId;
              }
              return yield* closing(fixed.tests, "failed");
            }),
          ),
        );
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "errored");
        const reason = `session ${sessionId} errored; qemu exited 137`;
        expect(fixed.automation.jobs[0]).toMatchObject({ status: "errored", reason });
        expect(fixed.tests.results[0]).toMatchObject({ status: "errored", reason });
        expect(erroredMoves(fixed.linear)).toEqual([
          { method: "moveToErrored", identifier: TICKET, message: `drive errored; ${reason}` },
        ]);
      }),
  );

  it.effect("a closed result whose session ended any other way is completed", () =>
    Effect.gen(function* () {
      const fixed = harness();
      const sessionId = "44444444-4444-4444-8444-444444444444";
      seedResult(fixed.tests);
      seedJob(fixed.automation, "drive");
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(
        reserving(() =>
          Effect.gen(function* () {
            fixed.sessions.sessions.push({
              id: sessionId,
              config: { iso: "x" },
              status: "failed",
              reason: "gave up",
              startedAt: new Date(),
              endedAt: new Date(),
            });
            const result = fixed.tests.results[0];
            if (result !== undefined) {
              result.sessionId = sessionId;
            }
            return yield* closing(fixed.tests, "failed");
          }),
        ),
      );
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "completed");
      expect(fixed.tests.results[0]?.status).toBe("failed");
      expect(erroredMoves(fixed.linear)).toEqual([]);
    }),
  );
});

describe("a diagnose is dispatched only after its drive completed", () => {
  it.effect("a drive that completed dispatches the diagnose", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests, TICKET, "failed");
      seedDiagnose(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(sentTo(http, "/run")).toHaveLength(1);
    }),
  );

  it.effect("a mint that completed dispatches the diagnose of the mint install", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests, TICKET, "passed");
      seedJob(fixed.automation, "diagnose");
      seedJob(fixed.automation, "mint", RESULT_ID, "completed");
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(sentTo(http, "/run")).toHaveLength(1);
    }),
  );

  it.effect(
    "a drive that failed, errored, was aborted or timed out closes the diagnose aborted and spawns nothing",
    () =>
      Effect.gen(function* () {
        for (const status of ["failed", "errored", "aborted", "timed_out"] as const) {
          const fixed = harness();
          seedResult(fixed.tests, TICKET, "failed");
          seedJob(fixed.automation, "diagnose");
          seedJob(fixed.automation, "drive", RESULT_ID, status);
          seedLiveClient(fixed.servers);
          const http = FakeHttp.recordRequests(() => Effect.die("nothing is asked of a client"));
          const scope = yield* start(fixed, http.layer);
          yield* settle(fixed.automation.jobs, "aborted");
          expect(fixed.automation.jobs[0]).toMatchObject({
            action: "diagnose",
            status: "aborted",
            reason: `not diagnosed; drive ${status}`,
          });
          expect(http.requests).toEqual([]);
          expect(FakeLog.texts(fixed.log)).toEqual(["diagnose aborted"]);
          expect(erroredMoves(fixed.linear)).toEqual([]);
          yield* Scope.close(scope, Exit.void);
        }
      }),
  );

  it.effect("a result with no drive or mint closes the diagnose aborted (unhappy)", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests, TICKET, "failed");
      seedJob(fixed.automation, "diagnose");
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(() => Effect.die("nothing is asked of a client"));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "aborted");
      expect(fixed.automation.jobs[0]?.reason).toBe("not diagnosed; no drive");
      expect(http.requests).toEqual([]);
    }),
  );

  it.effect("a drive still pending holds the diagnose, and the drive is placed", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedVerdict(fixed, "passed");
      seedJob(fixed.automation, "diagnose");
      seedJob(fixed.automation, "drive");
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "completed");
      expect(fixed.automation.jobs.map((job) => [job.action, job.status])).toEqual([
        ["diagnose", "pending"],
        ["drive", "completed"],
      ]);
      expect(JSON.parse(http.requests[0]?.body ?? "")).toMatchObject({ action: "drive" });
      expect(FakeLog.texts(fixed.log)).toEqual([
        `dispatching drive; ${URL}; ${MODEL}`,
        "drive completed",
      ]);
      // The next tick finds the drive completed and dispatches the diagnose.
      yield* TestClock.adjust("5 seconds");
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs[0]).toMatchObject({ action: "diagnose", status: "succeeded" });
    }),
  );
});

describe("dispatch unhappy path", () => {
  it.effect(
    "a move to In Progress that fails three times releases the reservation and errors the job",
    () => {
      const refused = Errors.LinearError.make({
        operation: "moveToInProgress",
        message: `linear: moving ${TICKET} to In Progress failed`,
      });
      let attempts = 0;
      const fixed = harness(
        FakeLinear.fakeLinear({
          overrides: {
            moveToInProgress: () =>
              Effect.sync(() => {
                attempts += 1;
              }).pipe(Effect.andThen(Effect.fail(refused))),
          },
        }),
      );
      return Effect.gen(function* () {
        seedResult(fixed.tests);
        seedJob(fixed.automation);
        const clientId = seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests((request, url) => {
          if (url.pathname === "/reserve" || url.pathname === "/abort") {
            return FakeHttp.json({ ok: "true" });
          }
          return closing(fixed.tests);
        });
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "errored");
        expect(attempts).toBe(3);
        expect(fixed.automation.jobs[0]).toMatchObject({
          status: "errored",
          reason: refused.message,
          serverId: clientId,
        });
        expect(fixed.automation.jobs[0]?.finishedAt).toBeInstanceOf(Date);
        expect(http.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
          `POST ${URL}/reserve`,
          `POST ${URL}/abort`,
        ]);
        expect(JSON.parse(http.requests[1]?.body ?? "")).toEqual({ ticket: TICKET });
        expect(sentryErrors(fixed.log)).toEqual([
          expect.objectContaining({
            text: `move to In Progress failed; ${URL}`,
            agentId: TICKET,
            location: "automation",
            skipSentry: false,
            cause: refused,
          }),
          expect.objectContaining({
            text: `drive errored; ${refused.message}`,
            location: "automation",
            skipSentry: false,
          }),
        ]);
        expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([
          cleared(TICKET),
        ]);
        expect(FakeLog.texts(fixed.log).some((text) => text.startsWith("dispatching"))).toBe(false);
      });
    },
  );

  it.effect("a /run the client never answers errors the job (unhappy)", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const cause = new Error("connect ECONNREFUSED 127.0.0.1:55333");
      const http = FakeHttp.recordRequests((request, url) =>
        url.pathname === "/reserve"
          ? FakeHttp.json({ ok: "true" })
          : Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({ request, cause }),
              }),
            ),
      );
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "errored");
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "errored",
        reason: `automation client: POST ${URL}/run failed`,
      });
      expect(http.requests.map((request) => request.url)).toEqual([`${URL}/reserve`, `${URL}/run`]);
      expect(FakeLog.texts(fixed.log)).toEqual([
        `dispatching drive; ${URL}; ${MODEL}`,
        `drive errored; automation client: POST ${URL}/run failed`,
      ]);
    }),
  );

  it.effect(
    "a 500 errors the job and its open result with the client's error, and moves the ticket to Errored",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests);
        seedJob(fixed.automation);
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(
          reserving(() => FakeHttp.json({ error: "opencode exited 1" }, 500)),
        );
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "errored");
        const reason = `automation client: POST ${URL}/run failed: opencode exited 1`;
        expect(fixed.automation.jobs[0]).toMatchObject({ status: "errored", reason });
        expect(fixed.tests.results[0]).toMatchObject({ status: "errored", reason });
        expect(FakeLog.texts(fixed.log)).toEqual([
          `dispatching drive; ${URL}; ${MODEL}`,
          `drive errored; ${reason}`,
        ]);
        expect(erroredMoves(fixed.linear)).toEqual([
          { method: "moveToErrored", identifier: TICKET, message: `drive errored; ${reason}` },
        ]);
      }),
  );

  it.effect("a diagnose that errors leaves the closed result alone and moves the ticket", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests, TICKET, "failed");
      seedVerdict(fixed, "failed");
      seedDiagnose(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(
        reserving(() => FakeHttp.json({ error: "opencode exited 1" }, 500)),
      );
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "errored");
      const reason = `automation client: POST ${URL}/run failed: opencode exited 1`;
      expect(fixed.tests.results[0]?.status).toBe("failed");
      expect(erroredMoves(fixed.linear)).toEqual([
        { method: "moveToErrored", identifier: TICKET, message: `diagnose errored; ${reason}` },
      ]);
      expect(verdictMoves(fixed.linear)).toEqual([]);
    }),
  );

  it.effect("a result that cannot be errored is logged, and the ticket still moves", () =>
    Effect.gen(function* () {
      const tests = Stores.fakeTestStore(
        {},
        {
          errorResult: () =>
            Effect.fail(
              Errors.DatabaseError.make({
                operation: "errorResult",
                message: "Failed query: errorResult",
                cause: new Error("connection reset"),
              }),
            ),
        },
      );
      const fixed = { ...harness(), tests };
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(
        reserving(() => FakeHttp.json({ error: "opencode exited 1" }, 500)),
      );
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "errored");
      yield* eventually(() => erroredMoves(fixed.linear).length === 1, "the Errored move");
      expect(
        fixed.log.lines.find((line) => line.text.startsWith("result errored write")),
      ).toMatchObject({
        level: "error",
        text: `result errored write failed; ${RESULT_ID}: connection reset`,
        agentId: TICKET,
      });
    }),
  );

  it.effect(
    "a 409 is a run POST /abort ended: the row is left running for that abort to close, and nothing is reported",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests);
        seedJob(fixed.automation);
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(
          reserving(() => FakeHttp.json({ error: "run aborted" }, 409)),
        );
        const scope = yield* start(fixed, http.layer);
        yield* eventually(() => sentTo(http, "/run").length === 1, "the drive running");
        for (let i = 0; i < 100; i++) {
          yield* Effect.yieldNow;
        }
        // A shutdown stops only a /run still waiting, so none is sent for this one.
        yield* Scope.close(scope, Exit.void);
        expect(sentTo(http, "/abort")).toEqual([]);
        expect(fixed.automation.jobs[0]).toMatchObject({ status: "running", finishedAt: null });
        expect(FakeLog.texts(fixed.log)).toEqual([`dispatching drive; ${URL}; ${MODEL}`]);
        expect(sentryErrors(fixed.log)).toEqual([]);
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
      fixed.servers.servers.push({ id: crypto.randomUUID(), url: URL, name: null, type: "qemu" });
      fixed.servers.heartbeats.push({ url: URL, type: "qemu", name: "garage", stats: STATS });
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

  it.effect("an unreachable client leaves the job pending and reports the cause", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      const cause = new Error("connect ECONNREFUSED 127.0.0.1:55333");
      seedLiveClient(fixed.servers);
      const http = FakeHttp.respondWith((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause }),
          }),
        ),
      );
      yield* start(fixed, http);
      for (let i = 0; i < 200; i++) {
        if (sentryErrors(fixed.log).length > 0) {
          break;
        }
        yield* Effect.yieldNow;
      }
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "pending",
        serverId: null,
        startedAt: null,
        finishedAt: null,
        reason: null,
      });
      expect(fixed.linear.calls).toEqual([]);
      expect(sentryErrors(fixed.log)).toEqual([
        expect.objectContaining({
          level: "error",
          text: `reserve failed; ${URL}`,
          agentId: TICKET,
          location: "automation",
          skipSentry: false,
          cause,
        }),
      ]);
    }),
  );

  it.effect(
    "a prompt that cannot be rendered marks the claimed job errored and does not POST",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests);
        seedJob(fixed.automation);
        seedLiveClient(fixed.servers);
        const fs = FileSystem.layerNoop({
          readFileString: (path) => Effect.fail(FakeFs.permissionDenied("open", path)),
        });
        yield* start(fixed, FakeHttp.die, fs);
        yield* settle(fixed.automation.jobs, "errored");
        expect(fixed.automation.jobs[0]?.status).toBe("errored");
        expect(fixed.automation.jobs[0]?.reason).toMatch(/^prompt:/);
        expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([
          cleared(TICKET),
        ]);
      }),
  );

  it.effect(
    "a ready label that keeps failing is retried and then logged, and the job stays errored",
    () =>
      Effect.gen(function* () {
        const refused = Errors.LinearError.make({
          operation: "clearReady",
          message: `linear: clearing ${TICKET} ready failed`,
        });
        let attempts = 0;
        const fixed = harness(
          FakeLinear.fakeLinear({
            overrides: {
              clearReady: () =>
                Effect.sync(() => {
                  attempts += 1;
                }).pipe(Effect.andThen(Effect.fail(refused))),
            },
          }),
        );
        seedResult(fixed.tests);
        seedJob(fixed.automation);
        seedLiveClient(fixed.servers);
        const fs = FileSystem.layerNoop({
          readFileString: (path) => Effect.fail(FakeFs.permissionDenied("open", path)),
        });
        yield* start(fixed, FakeHttp.die, fs);
        yield* settle(fixed.automation.jobs, "errored");
        expect(attempts).toBe(3);
        expect(fixed.automation.jobs[0]?.status).toBe("errored");
        expect(
          fixed.log.lines.some((line) => line.text.startsWith("ready label clear failed")),
        ).toBe(true);
        expect(
          fixed.log.lines.find((line) => line.text.startsWith("ready label clear failed")),
        ).toMatchObject({
          level: "error",
          text: `ready label clear failed: linear: clearing ${TICKET} ready failed`,
          agentId: TICKET,
          cause: refused,
        });
      }),
  );

  it.effect("a ready label that fails once is cleared on the retry, with no error line", () =>
    Effect.gen(function* () {
      const refused = Errors.LinearError.make({
        operation: "clearReady",
        message: `linear: clearing ${TICKET} ready failed`,
      });
      let attempts = 0;
      const fixed = harness(
        FakeLinear.fakeLinear({
          overrides: {
            clearReady: () =>
              Effect.sync(() => {
                attempts += 1;
                return attempts < 2;
              }).pipe(Effect.flatMap((fail) => (fail ? Effect.fail(refused) : Effect.void))),
          },
        }),
      );
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const fs = FileSystem.layerNoop({
        readFileString: (path) => Effect.fail(FakeFs.permissionDenied("open", path)),
      });
      yield* start(fixed, FakeHttp.die, fs);
      yield* settle(fixed.automation.jobs, "errored");
      expect(attempts).toBe(2);
      expect(fixed.automation.jobs[0]?.status).toBe("errored");
      expect(
        FakeLog.texts(fixed.log).some((text) => text.startsWith("ready label clear failed")),
      ).toBe(false);
    }),
  );

  it.effect("a result with no Linear ticket errors after claim and does not POST", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests, null);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      yield* start(fixed, FakeHttp.die);
      yield* settle(fixed.automation.jobs, "errored");
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "errored",
        reason: "no Linear ticket",
      });
      expect(FakeLog.texts(fixed.log)).toEqual(["drive errored; no Linear ticket"]);
      expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([]);
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
      expect(sentryErrors(fixed.log)).toEqual([]);
      expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([]);
      expect(fixed.log.lines[0]?.agentId).toBe(TICKET);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
    }),
  );

  it.effect(
    "a reservation is answered before the next job is reserved, and a failure is not run",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedPair(fixed);
        seedLiveClient(fixed.servers);
        const held = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let reserves = 0;
        const http = FakeHttp.recordRequests((request, url) => {
          if (url.pathname === "/reserve") {
            reserves += 1;
            if (reserves === 1) {
              return Effect.gen(function* () {
                yield* Deferred.succeed(held, undefined);
                yield* Deferred.await(release);
                return FakeHttp.json({ error: "opencode refused" }, 500);
              });
            }
            return FakeHttp.json({ ok: "true" });
          }
          return closing(fixed.tests);
        });
        yield* start(fixed, http.layer);
        yield* Deferred.await(held);
        for (let i = 0; i < 50; i++) {
          yield* Effect.yieldNow;
        }
        expect(http.requests).toHaveLength(1);
        expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["pending", "pending"]);
        yield* Deferred.succeed(release, undefined);
        for (let i = 0; i < 50; i++) {
          yield* Effect.yieldNow;
        }
        expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["pending", "pending"]);
        expect(http.requests.filter((request) => request.url.endsWith("/run"))).toHaveLength(0);
        expect(http.requests.filter((request) => request.url.endsWith("/reserve"))).toHaveLength(1);
        expect(sentryErrors(fixed.log).map((line) => line.text)).toEqual([
          `reserve failed; ${URL}`,
        ]);
        expect(fixed.linear.calls).toEqual([]);
      }),
  );

  it.effect("a 503 from every client after a success leaves the next job pending", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedPair(fixed);
      seedLiveClient(fixed.servers);
      seedLiveClient(fixed.servers, OTHER_URL);
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let reserves = 0;
      const http = FakeHttp.recordRequests((request, url) => {
        if (url.pathname === "/reserve") {
          reserves += 1;
          return reserves === 1
            ? FakeHttp.json({ ok: "true" })
            : FakeHttp.json({ error: "at capacity: max-jobs is 1" }, 503);
        }
        return Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          return yield* closing(fixed.tests);
        });
      });
      yield* start(fixed, http.layer);
      yield* Deferred.await(started);
      for (let i = 0; i < 200; i++) {
        if (FakeLog.texts(fixed.log).includes("deferred; at capacity")) {
          break;
        }
        yield* Effect.yieldNow;
      }
      expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["running", "pending"]);
      expect(fixed.automation.jobs[1]).toMatchObject({
        status: "pending",
        serverId: null,
        startedAt: null,
        finishedAt: null,
        reason: null,
      });
      expect(http.requests.filter((request) => request.url.endsWith("/reserve"))).toHaveLength(3);
      expect(http.requests.filter((request) => request.url.endsWith("/run"))).toHaveLength(1);
      expect(FakeLog.texts(fixed.log)).toContain("deferred; at capacity");
      expect(fixed.log.lines.find((line) => line.text === "deferred; at capacity")?.agentId).toBe(
        TICKET_B,
      );
      yield* Deferred.succeed(release, undefined);
      yield* settle(fixed.automation.jobs, "completed");
      expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["completed", "pending"]);
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
      yield* settle(fixed.automation.jobs, "completed");
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "completed",
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

  it.effect(
    "a client with no room is skipped, and the client that took a job is not given another this tick",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedPair(fixed);
        seedLiveClient(fixed.servers, URL);
        const second = seedLiveClient(fixed.servers, OTHER_URL);
        const third = seedLiveClient(fixed.servers, THIRD_URL);
        const http = FakeHttp.recordRequests((request, url) => {
          if (url.pathname === "/reserve" && url.href.startsWith(URL)) {
            return FakeHttp.json({ error: "at capacity: max-jobs is 1" }, 503);
          }
          return reserving(() => closing(fixed.tests))(request, url);
        });
        yield* start(fixed, http.layer);
        yield* settleAll(fixed.automation.jobs, "completed");
        expect(fixed.automation.jobs.map((job) => job.serverId)).toEqual([second, third]);
        const posted = (pathname: string) =>
          http.requests
            .filter((request) => request.url.endsWith(pathname))
            .map((request) => request.url);
        expect(posted("/reserve")).toEqual([
          `${URL}/reserve`,
          `${OTHER_URL}/reserve`,
          `${THIRD_URL}/reserve`,
        ]);
        expect(posted("/run")).toEqual([`${OTHER_URL}/run`, `${THIRD_URL}/run`]);
      }),
  );

  it.effect("a resume drive posts the run's iso and a 409 leaves the job pending", () =>
    Effect.gen(function* () {
      const fixed = harness();
      const iso = "https://example.com/omarchy.iso";
      fixed.tests.definitions.push({
        id: 1,
        name: "lock-screen",
        description: "d",
        instruction: "i",
        proof: "p",
        createdAt: new Date(0),
      });
      fixed.tests.runs.push({
        id: RUN_ID,
        name: "n",
        iso,
        serverUrl: "http://127.0.0.1:42070",
        status: "pending",
        reason: null,
        startedAt: new Date(0),
        endedAt: null,
      });
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: "setup needed: http://10.0.0.6:42069 max-jobs is 4" }, 409),
      );
      yield* start(fixed, http.layer);
      for (let i = 0; i < 200; i++) {
        if (FakeLog.texts(fixed.log).includes("deferred; setup needed")) {
          break;
        }
        yield* Effect.yieldNow;
      }
      expect(JSON.parse(http.requests[0]?.body ?? "")).toEqual({
        ticket: TICKET,
        action: "drive",
        resume: iso,
      });
      expect(fixed.automation.jobs[0]?.status).toBe("pending");
      expect(http.requests).toHaveLength(1);
      expect(FakeLog.texts(fixed.log)).toEqual(["deferred; setup needed"]);
      expect(sentryErrors(fixed.log)).toEqual([]);
    }),
  );

  it.effect("a 409 from every client leaves the job pending and does not report to Sentry", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      seedLiveClient(fixed.servers, OTHER_URL);
      const http = FakeHttp.recordRequests(() =>
        FakeHttp.json({ error: "setup needed: http://10.0.0.6:42069 max-jobs is 4" }, 409),
      );
      yield* start(fixed, http.layer);
      for (let i = 0; i < 200; i++) {
        if (FakeLog.texts(fixed.log).includes("deferred; setup needed")) {
          break;
        }
        yield* Effect.yieldNow;
      }
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "pending",
        serverId: null,
        startedAt: null,
        finishedAt: null,
        reason: null,
      });
      expect(http.requests.map((request) => request.url)).toEqual([
        `${URL}/reserve`,
        `${OTHER_URL}/reserve`,
      ]);
      expect(FakeLog.texts(fixed.log)).toEqual(["deferred; setup needed"]);
      expect(sentryErrors(fixed.log)).toEqual([]);
      expect(fixed.linear.calls).toEqual([]);
    }),
  );

  it.effect("an unexpected failure on one client is logged and the next client can accept", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      const first = seedLiveClient(fixed.servers);
      const second = seedLiveClient(fixed.servers, OTHER_URL);
      const cause = new Error("connect ECONNREFUSED 127.0.0.1:55333");
      const http = FakeHttp.recordRequests((request, url) => {
        if (url.href.startsWith(URL)) {
          return Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request, cause }),
            }),
          );
        }
        return reserving(() => closing(fixed.tests))(request, url);
      });
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "completed");
      expect(fixed.automation.jobs[0]).toMatchObject({ status: "completed", serverId: second });
      expect(fixed.automation.jobs[0]?.serverId).not.toBe(first);
      expect(http.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        `POST ${URL}/reserve`,
        `POST ${OTHER_URL}/reserve`,
        `POST ${OTHER_URL}/run`,
      ]);
      expect(sentryErrors(fixed.log)).toEqual([
        expect.objectContaining({
          text: `reserve failed; ${URL}`,
          agentId: TICKET,
          location: "automation",
          skipSentry: false,
          cause,
        }),
      ]);
    }),
  );

  it.effect("an unexpected failure on every client is logged and the job stays pending", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      seedLiveClient(fixed.servers, OTHER_URL);
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ nope: true }));
      yield* start(fixed, http.layer);
      for (let i = 0; i < 200; i++) {
        if (sentryErrors(fixed.log).length >= 2) {
          break;
        }
        yield* Effect.yieldNow;
      }
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "pending",
        serverId: null,
        startedAt: null,
        finishedAt: null,
        reason: null,
      });
      expect(http.requests.map((request) => request.url)).toEqual([
        `${URL}/reserve`,
        `${OTHER_URL}/reserve`,
      ]);
      expect(http.requests.some((request) => request.url.endsWith("/run"))).toBe(false);
      expect(sentryErrors(fixed.log).map((line) => [line.text, line.agentId])).toEqual([
        [`reserve failed; ${URL}`, TICKET],
        [`reserve failed; ${OTHER_URL}`, TICKET],
      ]);
      expect(sentryErrors(fixed.log).every((line) => line.cause !== undefined)).toBe(true);
      expect(fixed.linear.calls).toEqual([]);
      expect(FakeLog.texts(fixed.log).some((text) => text.includes("drive failed"))).toBe(false);
      expect(FakeLog.texts(fixed.log).some((text) => text.includes("drive errored"))).toBe(false);
    }),
  );

  it.effect("a pending abort that wins the race releases the accepted reservation", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const reserved = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const http = FakeHttp.recordRequests((request, url) => {
        if (url.pathname === "/reserve") {
          return Effect.gen(function* () {
            yield* Deferred.succeed(reserved, undefined);
            yield* Deferred.await(release);
            return FakeHttp.json({ ok: "true" });
          });
        }
        if (url.pathname === "/abort") {
          return FakeHttp.json({ ok: "true" });
        }
        return closing(fixed.tests);
      });
      yield* start(fixed, http.layer);
      yield* Deferred.await(reserved);
      const job = fixed.automation.jobs[0];
      expect(job?.status).toBe("pending");
      if (job !== undefined) {
        job.status = "aborted";
        job.reason = "aborted";
        job.finishedAt = new Date();
      }
      yield* Deferred.succeed(release, undefined);
      for (let i = 0; i < 200; i++) {
        if (http.requests.some((request) => request.url.endsWith("/abort"))) {
          break;
        }
        yield* Effect.yieldNow;
      }
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "aborted",
        reason: "aborted",
        serverId: null,
        startedAt: null,
      });
      expect(http.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        `POST ${URL}/reserve`,
        `POST ${URL}/abort`,
      ]);
      expect(JSON.parse(http.requests[1]?.body ?? "")).toEqual({ ticket: TICKET });
      expect(FakeLog.texts(fixed.log).some((text) => text.startsWith("dispatching"))).toBe(false);
    }),
  );

  it.effect("a running write that fails twice then succeeds starts /run", () => {
    const failure = Errors.DatabaseError.make({
      operation: "markAutomationJobRunning",
      message: "connection reset",
      cause: new Error("connection reset"),
    });
    let attempts = 0;
    const held: { automation: Stores.FakeAutomationStore | undefined } = { automation: undefined };
    const automation = Stores.fakeAutomationStore({
      markRunning: (id, serverId) =>
        Effect.gen(function* () {
          attempts += 1;
          if (attempts < 3) {
            return yield* Effect.fail(failure);
          }
          const job = held.automation?.jobs.find(
            (row) => row.id === id && row.status === "pending",
          );
          if (job === undefined) {
            return false;
          }
          job.status = "running";
          job.serverId = serverId;
          job.startedAt = new Date();
          return true;
        }),
    });
    held.automation = automation;
    return Effect.gen(function* () {
      const fixed = harness(FakeLinear.fakeLinear(), automation);
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      const clientId = seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "completed");
      expect(attempts).toBe(3);
      expect(fixed.automation.jobs[0]).toMatchObject({ status: "completed", serverId: clientId });
      expect(http.requests.map((request) => request.url)).toEqual([`${URL}/reserve`, `${URL}/run`]);
      expect(sentryErrors(fixed.log).map((line) => line.text)).toEqual([]);
    });
  });

  it.effect(
    "a running write that commits and then fails keeps the reservation and starts /run",
    () => {
      const failure = Errors.DatabaseError.make({
        operation: "markAutomationJobRunning",
        message: "connection reset",
        cause: new Error("connection reset"),
      });
      let attempts = 0;
      const held: { automation: Stores.FakeAutomationStore | undefined } = {
        automation: undefined,
      };
      const automation = Stores.fakeAutomationStore({
        markRunning: (id, serverId) =>
          Effect.gen(function* () {
            attempts += 1;
            const job = held.automation?.jobs.find((row) => row.id === id);
            if (attempts === 1) {
              if (job !== undefined && job.status === "pending") {
                job.status = "running";
                job.serverId = serverId;
                job.startedAt = new Date();
              }
              return yield* Effect.fail(failure);
            }
            if (job?.status === "running" && job.serverId === serverId) {
              return true;
            }
            if (job === undefined || job.status !== "pending") {
              return false;
            }
            job.status = "running";
            job.serverId = serverId;
            job.startedAt = new Date();
            return true;
          }),
      });
      held.automation = automation;
      return Effect.gen(function* () {
        const fixed = harness(FakeLinear.fakeLinear(), automation);
        seedResult(fixed.tests);
        seedJob(fixed.automation);
        const clientId = seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "completed");
        expect(attempts).toBeGreaterThan(1);
        expect(fixed.automation.jobs[0]).toMatchObject({ status: "completed", serverId: clientId });
        expect(http.requests.map((request) => request.url)).toEqual([
          `${URL}/reserve`,
          `${URL}/run`,
        ]);
      });
    },
  );

  it.effect("a release that never answers is reported after ten seconds and does not hang", () => {
    const failure = Errors.DatabaseError.make({
      operation: "markAutomationJobRunning",
      message: "connection reset",
      cause: new Error("connection reset"),
    });
    const automation = Stores.fakeAutomationStore({
      markRunning: () => Effect.fail(failure),
    });
    return Effect.gen(function* () {
      const fixed = harness(FakeLinear.fakeLinear(), automation);
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const aborting = yield* Deferred.make<void>();
      const http = FakeHttp.recordRequests((request, url) => {
        if (url.pathname === "/reserve") {
          return FakeHttp.json({ ok: "true" });
        }
        return Deferred.succeed(aborting, undefined).pipe(Effect.andThen(Effect.never));
      });
      yield* start(fixed, http.layer);
      yield* Deferred.await(aborting);
      yield* TestClock.adjust("10 seconds");
      expect(
        sentryErrors(fixed.log).some((line) => line.text === `reserve release failed; ${URL}`),
      ).toBe(true);
      for (let i = 0; i < 200 && fixed.automation.jobs[0]?.status !== "errored"; i++) {
        yield* Effect.yieldNow;
      }
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "errored",
        reason: "DATABASE FAILURE",
      });
      expect(http.requests.some((request) => request.url.endsWith("/run"))).toBe(false);
    });
  });

  it.effect(
    "a running write that fails three times releases the reservation and errors the job",
    () => {
      const failure = Errors.DatabaseError.make({
        operation: "markAutomationJobRunning",
        message: "connection reset",
        cause: new Error("connection reset"),
      });
      let attempts = 0;
      const automation = Stores.fakeAutomationStore({
        markRunning: () =>
          Effect.sync(() => {
            attempts += 1;
          }).pipe(Effect.andThen(Effect.fail(failure))),
      });
      return Effect.gen(function* () {
        const fixed = harness(FakeLinear.fakeLinear(), automation);
        seedPair(fixed);
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests((request, url) => {
          if (url.pathname === "/reserve") {
            return FakeHttp.json({ ok: "true" });
          }
          if (url.pathname === "/abort") {
            return FakeHttp.json({ ok: "true" });
          }
          return closing(fixed.tests);
        });
        yield* start(fixed, http.layer);
        for (let i = 0; i < 200 && fixed.automation.jobs[0]?.status !== "errored"; i++) {
          yield* Effect.yieldNow;
        }
        expect(attempts).toBe(3);
        expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["errored", "pending"]);
        expect(fixed.automation.jobs[0]).toMatchObject({
          serverId: null,
          startedAt: null,
          reason: "DATABASE FAILURE",
        });
        expect(fixed.automation.jobs[0]?.finishedAt).toBeInstanceOf(Date);
        expect(http.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
          `POST ${URL}/reserve`,
          `POST ${URL}/abort`,
        ]);
        expect(JSON.parse(http.requests[1]?.body ?? "")).toEqual({ ticket: TICKET });
        expect(sentryErrors(fixed.log)).toEqual([
          expect.objectContaining({
            text: `running write failed; ${URL}`,
            agentId: TICKET,
            location: "automation",
            skipSentry: false,
            cause: failure,
          }),
        ]);
        expect(fixed.tests.results[0]).toMatchObject({
          status: "errored",
          reason: "DATABASE FAILURE",
        });
        expect(fixed.linear.calls).toEqual([
          {
            method: "moveToErrored",
            identifier: TICKET,
            message: "drive errored; DATABASE FAILURE",
          },
        ]);
      });
    },
  );

  it.effect("a failure write retries twice and then closes the job", () => {
    const markFailure = Errors.DatabaseError.make({
      operation: "markAutomationJobRunning",
      message: "connection reset",
      cause: new Error("connection reset"),
    });
    const finishFailure = Errors.DatabaseError.make({
      operation: "finishAutomationJob",
      message: "finish reset",
      cause: new Error("finish reset"),
    });
    let finishes = 0;
    const held: { automation: Stores.FakeAutomationStore | undefined } = { automation: undefined };
    const automation = Stores.fakeAutomationStore({
      markRunning: () => Effect.fail(markFailure),
      finish: (id, status, reason) =>
        Effect.gen(function* () {
          finishes += 1;
          if (finishes < 3) {
            return yield* Effect.fail(finishFailure);
          }
          const job = held.automation?.jobs.find((row) => row.id === id);
          if (job === undefined) {
            return false;
          }
          job.status = status;
          job.finishedAt = new Date();
          if (reason !== null) {
            job.reason = reason;
          }
          return true;
        }),
    });
    held.automation = automation;
    return Effect.gen(function* () {
      const fixed = harness(FakeLinear.fakeLinear(), automation);
      seedPair(fixed);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests((request, url) =>
        url.pathname === "/abort" || url.pathname === "/reserve"
          ? FakeHttp.json({ ok: "true" })
          : closing(fixed.tests),
      );
      yield* start(fixed, http.layer);
      for (let i = 0; i < 200 && fixed.automation.jobs[0]?.status !== "errored"; i++) {
        yield* Effect.yieldNow;
      }
      expect(finishes).toBe(3);
      expect(fixed.automation.jobs[0]).toMatchObject({
        status: "errored",
        reason: "DATABASE FAILURE",
      });
      expect(fixed.automation.jobs[1]?.status).toBe("pending");
      expect(http.requests.some((request) => request.url.endsWith("/run"))).toBe(false);
      expect(sentryErrors(fixed.log).map((line) => [line.text, line.cause])).toEqual([
        [`running write failed; ${URL}`, markFailure],
        [`failure write failed; ${URL}`, finishFailure],
        [`failure write failed; ${URL}`, finishFailure],
      ]);
      expect(erroredMoves(fixed.linear)).toEqual([
        { method: "moveToErrored", identifier: TICKET, message: "drive errored; DATABASE FAILURE" },
      ]);
    });
  });

  it.effect("an exhausted failure write is reported and the job stays pending", () => {
    const markFailure = Errors.DatabaseError.make({
      operation: "markAutomationJobRunning",
      message: "connection reset",
      cause: new Error("connection reset"),
    });
    const finishFailure = Errors.DatabaseError.make({
      operation: "finishAutomationJob",
      message: "finish reset",
      cause: new Error("finish reset"),
    });
    let finishes = 0;
    const automation = Stores.fakeAutomationStore({
      markRunning: () => Effect.fail(markFailure),
      finish: () =>
        Effect.sync(() => {
          finishes += 1;
        }).pipe(Effect.andThen(Effect.fail(finishFailure))),
    });
    return Effect.gen(function* () {
      const fixed = harness(FakeLinear.fakeLinear(), automation);
      seedPair(fixed);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests((request, url) =>
        url.pathname === "/abort" || url.pathname === "/reserve"
          ? FakeHttp.json({ ok: "true" })
          : closing(fixed.tests),
      );
      yield* start(fixed, http.layer);
      for (let i = 0; i < 200; i++) {
        const recorded = sentryErrors(fixed.log).filter((line) =>
          line.text.startsWith("failure write failed"),
        ).length;
        if (recorded >= 3) {
          break;
        }
        yield* Effect.yieldNow;
      }
      expect(finishes).toBe(3);
      expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["pending", "pending"]);
      expect(http.requests.map((request) => request.url)).toEqual([
        `${URL}/reserve`,
        `${URL}/abort`,
      ]);
      expect(sentryErrors(fixed.log)).toEqual([
        expect.objectContaining({
          text: `running write failed; ${URL}`,
          agentId: TICKET,
          skipSentry: false,
          cause: markFailure,
        }),
        expect.objectContaining({
          text: `failure write failed; ${URL}`,
          agentId: TICKET,
          skipSentry: false,
          cause: finishFailure,
        }),
        expect.objectContaining({
          text: `failure write failed; ${URL}`,
          agentId: TICKET,
          skipSentry: false,
          cause: finishFailure,
        }),
        expect.objectContaining({
          text: `failure write failed; ${URL}`,
          agentId: TICKET,
          skipSentry: false,
          cause: finishFailure,
        }),
      ]);
      expect(fixed.linear.calls).toEqual([]);
    });
  });

  it.effect("a mint's 503 does not end the tick, and the next drive's 503 does", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedResult(fixed.tests, TICKET_B, "pending", RESULT_B);
      seedJob(fixed.automation, "drive", RESULT_ID);
      seedJob(fixed.automation, "mint", RESULT_B);
      fixed.pins.set(RESULT_B, "http://127.0.0.1:55332");
      seedLiveClient(fixed.servers);
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
      expect(http.requests.map((request) => JSON.parse(request.body ?? "").action)).toEqual([
        "mint",
        "drive",
      ]);
      expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["pending", "pending"]);
      expect(FakeLog.texts(fixed.log)).toEqual([
        "deferred; mint at capacity",
        "deferred; at capacity",
      ]);
      expect(JSON.parse(http.requests[0]?.body ?? "")).toMatchObject({
        action: "mint",
        server: "http://127.0.0.1:55332",
      });
    }),
  );

  it.effect("a mint with no pinned server is not reserved (unhappy)", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests, TICKET, "pending", RESULT_ID);
      seedJob(fixed.automation, "mint", RESULT_ID);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "errored");
      expect(http.requests).toEqual([]);
      expect(fixed.automation.jobs[0]?.status).toBe("errored");
      expect(fixed.automation.jobs[0]?.reason).toContain("has no pinned server");
    }),
  );
});

// A running row at startup is the dead automation server's: the process that would have closed
// it is gone.
const seedRunning = (
  automation: Stores.FakeAutomationStore,
  serverId: string | null,
  resultId = RESULT_ID,
  action: "drive" | "diagnose" | "mint" = "drive",
) => {
  seedJob(automation, action, resultId);
  const job = automation.jobs.at(-1);
  if (job !== undefined) {
    job.status = "running";
    job.serverId = serverId;
    job.startedAt = new Date();
  }
};

const eventually = (check: () => boolean, what: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 1_000; i++) {
      if (check()) {
        return yield* Effect.void;
      }
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(`never: ${what}`);
  });

const moved = (linear: FakeLinear.FakeLinear) =>
  linear.calls.filter((call) => call.method === "moveToErrored");

const RESTARTED = "automation server restarted";
const SHUTTING_DOWN = "automation server shutting down";
const JOB_NOT_FOUND = `JobNotFound: Job had "running" status but 404'd.`;

// The urls of the requests sent to one path, in the order they were sent.
const sentTo = (http: FakeHttp.Recorder, path: string) =>
  http.requests.map((request) => request.url).filter((url) => url.endsWith(path));

describe("a running job left by the last automation server", () => {
  it.effect(
    "is stopped at its automation client, errored, and moved to Errored before any pending job is reserved",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests);
        seedResult(fixed.tests, TICKET_B, "pending", RESULT_B);
        const clientId = seedLiveClient(fixed.servers);
        seedRunning(fixed.automation, clientId);
        seedJob(fixed.automation, "drive", RESULT_B);
        const http = FakeHttp.recordRequests((request, url) =>
          url.pathname === "/abort" || url.pathname === "/reserve"
            ? FakeHttp.json({ ok: "true" })
            : closing(fixed.tests),
        );
        yield* start(fixed, http.layer);
        yield* eventually(
          () => fixed.automation.jobs[1]?.status === "completed",
          "the pending job ran",
        );
        expect(http.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
          `POST ${URL}/abort`,
          `POST ${URL}/reserve`,
          `POST ${URL}/run`,
        ]);
        expect(JSON.parse(http.requests[0]?.body ?? "")).toEqual({ ticket: TICKET });
        expect(fixed.automation.jobs[0]).toMatchObject({
          status: "errored",
          reason: RESTARTED,
          serverId: clientId,
          finishedAt: expect.any(Date),
        });
        expect(fixed.linear.calls).toEqual([
          cleared(TICKET),
          {
            method: "moveToErrored",
            identifier: TICKET,
            message: `drive errored; ${RESTARTED}`,
          },
          { method: "moveToInProgress", identifier: TICKET_B },
          cleared(TICKET_B),
          { method: "moveToNeedsReview", identifier: TICKET_B },
        ]);
        expect(FakeLog.texts(fixed.log)).toContain(`drive errored; ${RESTARTED}`);
      }),
  );

  it.effect(
    "a drive or mint whose result the driver closed has finished: it is closed completed, moved to Needs Review, and nothing is sent or reported",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        const mintResult = "44444444-4444-4444-8444-444444444444";
        const waitingResult = "55555555-5555-4555-8555-555555555555";
        const clientId = seedLiveClient(fixed.servers);
        seedResult(fixed.tests, TICKET, "passed", RESULT_ID);
        seedResult(fixed.tests, TICKET_B, "failed", RESULT_B);
        seedResult(fixed.tests, "OLI-44", "passed", mintResult);
        seedResult(fixed.tests, "OLI-45", "pending", waitingResult);
        seedRunning(fixed.automation, clientId, RESULT_ID);
        seedRunning(fixed.automation, clientId, RESULT_B);
        seedRunning(fixed.automation, clientId, mintResult, "mint");
        seedJob(fixed.automation, "drive", waitingResult);
        const http = FakeHttp.recordRequests((_, url) =>
          url.pathname === "/run"
            ? Effect.sync(() => {
                const waiting = fixed.tests.results.find((row) => row.id === waitingResult);
                if (waiting !== undefined) {
                  waiting.status = "passed";
                }
                return FakeHttp.json({ ok: "true" });
              })
            : FakeHttp.json({ ok: "true" }),
        );
        yield* start(fixed, http.layer);
        yield* eventually(
          () => fixed.automation.jobs[3]?.status === "completed",
          "the pending job ran",
        );
        expect(fixed.automation.jobs.slice(0, 3)).toEqual(
          [0, 1, 2].map(() =>
            expect.objectContaining({
              status: "completed",
              reason: null,
              serverId: clientId,
              finishedAt: expect.any(Date),
            }),
          ),
        );
        expect(
          http.requests.map((request) => `${request.method} ${request.url} ${request.body}`),
        ).toEqual([
          `POST ${URL}/reserve ${JSON.stringify({ ticket: "OLI-45", action: "drive" })}`,
          `POST ${URL}/run ${JSON.stringify({ prompt: `drive OLI-45 as ${MODEL}`, ticket: "OLI-45", model: MODEL })}`,
        ]);
        expect(fixed.linear.calls).toEqual([
          cleared(TICKET),
          { method: "moveToNeedsReview", identifier: TICKET },
          cleared(TICKET_B),
          { method: "moveToNeedsReview", identifier: TICKET_B },
          cleared("OLI-44"),
          { method: "moveToNeedsReview", identifier: "OLI-44" },
          { method: "moveToInProgress", identifier: "OLI-45" },
          cleared("OLI-45"),
          { method: "moveToNeedsReview", identifier: "OLI-45" },
        ]);
        expect(sentryErrors(fixed.log)).toEqual([]);
        expect(FakeLog.texts(fixed.log)).toEqual(
          expect.arrayContaining(["drive completed", "mint completed"]),
        );
      }),
  );

  it.effect(
    "a drive whose result the driver closed on a session the qemu server errored is errored and moved, and nothing is sent",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        const sessionId = "44444444-4444-4444-8444-444444444444";
        seedResult(fixed.tests, TICKET, "passed");
        const result = fixed.tests.results[0];
        if (result !== undefined) {
          result.sessionId = sessionId;
        }
        fixed.sessions.sessions.push({
          id: sessionId,
          config: { iso: "x" },
          status: "errored",
          reason: "qemu exited 137",
          startedAt: new Date(),
          endedAt: new Date(),
        });
        seedRunning(fixed.automation, seedLiveClient(fixed.servers));
        const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "errored");
        const reason = `session ${sessionId} errored; qemu exited 137`;
        expect(fixed.automation.jobs[0]).toMatchObject({ status: "errored", reason });
        expect(fixed.tests.results[0]).toMatchObject({ status: "errored", reason });
        expect(http.requests).toEqual([]);
        expect(erroredMoves(fixed.linear)).toEqual([
          { method: "moveToErrored", identifier: TICKET, message: `drive errored; ${reason}` },
        ]);
      }),
  );

  it.effect(
    "a diagnose left running is stopped, errored, and moved to Errored, though its result was closed before it was queued",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests, TICKET, "failed");
        seedRunning(fixed.automation, seedLiveClient(fixed.servers), RESULT_ID, "diagnose");
        const http = FakeHttp.recordRequests(() => FakeHttp.json({ ok: "true" }));
        yield* start(fixed, http.layer);
        yield* eventually(() => moved(fixed.linear).length > 0, "moved to Errored");
        expect(http.requests.map((request) => request.url)).toEqual([`${URL}/abort`]);
        expect(fixed.automation.jobs[0]).toMatchObject({ status: "errored", reason: RESTARTED });
        expect(fixed.tests.results[0]?.status).toBe("failed");
        expect(fixed.linear.calls).toEqual([
          {
            method: "moveToErrored",
            identifier: TICKET,
            message: `diagnose errored; ${RESTARTED}`,
          },
        ]);
        expect(sentryErrors(fixed.log).map((line) => line.text)).toEqual([
          `diagnose errored; ${RESTARTED}`,
        ]);
      }),
  );

  it.effect(
    "a finished drive whose close write fails three times is reported as should be completed, left running, and not moved",
    () => {
      const failure = Errors.DatabaseError.make({
        operation: "finishAutomationJob",
        message: "connection reset",
        cause: new Error("connection reset"),
      });
      let finishes = 0;
      const automation = Stores.fakeAutomationStore({
        finish: () =>
          Effect.sync(() => {
            finishes += 1;
          }).pipe(Effect.andThen(Effect.fail(failure))),
      });
      return Effect.gen(function* () {
        const fixed = harness(FakeLinear.fakeLinear(), automation);
        seedResult(fixed.tests, TICKET, "passed");
        seedRunning(fixed.automation, seedLiveClient(fixed.servers));
        const id = fixed.automation.jobs[0]?.id;
        yield* start(fixed, FakeHttp.die);
        yield* eventually(() => sentryErrors(fixed.log).length > 0, "the close was reported");
        expect(finishes).toBe(3);
        expect(fixed.automation.jobs[0]?.status).toBe("running");
        expect(sentryErrors(fixed.log)).toEqual([
          expect.objectContaining({
            text: `close write failed; ${id} should be completed`,
            location: "automation",
            cause: failure,
          }),
        ]);
        expect(fixed.linear.calls).toEqual([]);
      });
    },
  );

  it.effect(
    "an automation client that answers 404 holds nothing: reported JobNotFound, and the job is errored",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests);
        seedRunning(fixed.automation, seedLiveClient(fixed.servers));
        const id = fixed.automation.jobs[0]?.id;
        const http = FakeHttp.recordRequests(() =>
          FakeHttp.json({ error: `unknown session "${TICKET}"` }, 404),
        );
        yield* start(fixed, http.layer);
        yield* settle(fixed.automation.jobs, "errored");
        yield* eventually(() => moved(fixed.linear).length > 0, "moved to Errored");
        expect(fixed.automation.jobs[0]?.reason).toBe(RESTARTED);
        expect(http.requests.map((request) => request.url)).toEqual([`${URL}/abort`]);
        expect(moved(fixed.linear)).toEqual([
          {
            method: "moveToErrored",
            identifier: TICKET,
            message: `drive errored; ${RESTARTED}`,
          },
        ]);
        expect(sentryErrors(fixed.log)).toEqual([
          expect.objectContaining({
            text: JOB_NOT_FOUND,
            location: "automation",
            agentId: TICKET,
            cause: expect.objectContaining({
              _tag: "JobNotFound",
              message: `Job had "running" status but 404'd.`,
              jobId: id,
              url: URL,
            }),
          }),
          expect.objectContaining({ text: `drive errored; ${RESTARTED}` }),
        ]);
      }),
  );

  it.effect(
    "an unreachable automation client is reported, the job is errored anyway, and nothing retries it",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests);
        seedRunning(fixed.automation, seedLiveClient(fixed.servers));
        const cause = new Error("connect ECONNREFUSED 127.0.0.1:55333");
        const http = FakeHttp.recordRequests((request) =>
          Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request, cause }),
            }),
          ),
        );
        yield* start(fixed, http.layer);
        yield* eventually(() => moved(fixed.linear).length > 0, "moved to Errored");
        yield* TestClock.adjust("5 seconds");
        expect(fixed.automation.jobs[0]).toMatchObject({ status: "errored", reason: RESTARTED });
        expect(http.requests.map((request) => request.url)).toEqual([`${URL}/abort`]);
        expect(sentryErrors(fixed.log)).toEqual([
          expect.objectContaining({
            text: `inherited abort failed; ${URL}`,
            agentId: TICKET,
            location: "automation",
            cause,
          }),
          expect.objectContaining({ text: `drive errored; ${RESTARTED}` }),
        ]);
      }),
  );

  it.effect("an automation client that never answers is given up on after ten seconds", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedRunning(fixed.automation, seedLiveClient(fixed.servers));
      const asked = yield* Deferred.make<void>();
      const http = FakeHttp.recordRequests(() =>
        Deferred.succeed(asked, undefined).pipe(Effect.andThen(Effect.never)),
      );
      yield* start(fixed, http.layer);
      yield* Deferred.await(asked);
      expect(fixed.automation.jobs[0]?.status).toBe("running");
      yield* TestClock.adjust("10 seconds");
      yield* settle(fixed.automation.jobs, "errored");
      expect(sentryErrors(fixed.log)[0]).toMatchObject({
        text: `inherited abort failed; ${URL}`,
        agentId: TICKET,
        cause: expect.objectContaining({
          message: `automation client: POST ${URL}/abort failed: no answer within 10 seconds`,
        }),
      });
    }),
  );

  it.effect(
    "a job no automation client can hold is errored without a request: no client recorded, the client forgotten, or no ticket",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        const resultC = "44444444-4444-4444-8444-444444444444";
        seedResult(fixed.tests);
        seedResult(fixed.tests, TICKET_B, "pending", RESULT_B);
        seedResult(fixed.tests, null, "pending", resultC);
        seedRunning(fixed.automation, null, RESULT_ID);
        seedRunning(fixed.automation, crypto.randomUUID(), RESULT_B);
        seedRunning(fixed.automation, seedLiveClient(fixed.servers), resultC);
        yield* start(fixed, FakeHttp.die);
        yield* settleAll(fixed.automation.jobs, "errored");
        yield* eventually(() => moved(fixed.linear).length === 2, "both tickets moved");
        expect(fixed.automation.jobs.map((job) => job.reason)).toEqual([
          RESTARTED,
          RESTARTED,
          RESTARTED,
        ]);
        expect(moved(fixed.linear)).toEqual([
          {
            method: "moveToErrored",
            identifier: TICKET,
            message: `drive errored; ${RESTARTED}`,
          },
          {
            method: "moveToErrored",
            identifier: TICKET_B,
            message: `drive errored; ${RESTARTED}`,
          },
        ]);
      }),
  );

  it.effect("a job someone else closed during the abort is not errored or moved", () =>
    Effect.gen(function* () {
      const fixed = harness();
      seedResult(fixed.tests);
      seedRunning(fixed.automation, seedLiveClient(fixed.servers));
      const http = FakeHttp.recordRequests(() =>
        Effect.sync(() => {
          const job = fixed.automation.jobs[0];
          if (job !== undefined) {
            job.status = "aborted";
            job.reason = "aborted";
            job.finishedAt = new Date();
          }
          return FakeHttp.json({ ok: "true" });
        }),
      );
      yield* start(fixed, http.layer);
      yield* eventually(() => http.requests.length > 0, "the abort was sent");
      for (let i = 0; i < 100; i++) {
        yield* Effect.yieldNow;
      }
      expect(fixed.automation.jobs[0]).toMatchObject({ status: "aborted", reason: "aborted" });
      expect(moved(fixed.linear)).toEqual([]);
      expect(FakeLog.texts(fixed.log)).not.toContain(`drive errored; ${RESTARTED}`);
    }),
  );

  it.effect(
    "a Linear move that keeps failing is tried three times, reported, and dispatch still starts",
    () =>
      Effect.gen(function* () {
        const refused = Errors.LinearError.make({
          operation: "stateIds",
          message: "linear: no state named Errored",
        });
        let attempts = 0;
        const fixed = harness(
          FakeLinear.fakeLinear({
            overrides: {
              moveToErrored: () =>
                Effect.sync(() => {
                  attempts += 1;
                }).pipe(Effect.andThen(Effect.fail(refused))),
            },
          }),
        );
        seedResult(fixed.tests);
        seedResult(fixed.tests, TICKET_B, "pending", RESULT_B);
        seedRunning(fixed.automation, null);
        seedJob(fixed.automation, "drive", RESULT_B);
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
        yield* start(fixed, http.layer);
        yield* eventually(
          () => fixed.automation.jobs[1]?.status === "completed",
          "the pending job ran",
        );
        expect(attempts).toBe(3);
        expect(fixed.automation.jobs[0]).toMatchObject({ status: "errored", reason: RESTARTED });
        expect(
          sentryErrors(fixed.log).filter((line) => line.text.startsWith("move to Errored")),
        ).toEqual([
          expect.objectContaining({
            text: "move to Errored failed: linear: no state named Errored",
            agentId: TICKET,
            cause: refused,
          }),
        ]);
      }),
  );

  it.effect(
    "a close write that fails three times is reported with the job, left running, and not moved",
    () => {
      const failure = Errors.DatabaseError.make({
        operation: "finishAutomationJob",
        message: "connection reset",
        cause: new Error("connection reset"),
      });
      let finishes = 0;
      const automation = Stores.fakeAutomationStore({
        finish: () =>
          Effect.sync(() => {
            finishes += 1;
          }).pipe(Effect.andThen(Effect.fail(failure))),
      });
      return Effect.gen(function* () {
        const fixed = harness(FakeLinear.fakeLinear(), automation);
        seedResult(fixed.tests);
        seedRunning(fixed.automation, null);
        const id = fixed.automation.jobs[0]?.id;
        yield* start(fixed, FakeHttp.die);
        yield* eventually(() => sentryErrors(fixed.log).length > 0, "the close was reported");
        expect(finishes).toBe(3);
        expect(fixed.automation.jobs[0]?.status).toBe("running");
        expect(sentryErrors(fixed.log)).toEqual([
          expect.objectContaining({
            text: `close write failed; ${id} should be errored`,
            location: "automation",
            cause: failure,
          }),
        ]);
        expect(fixed.linear.calls).toEqual([]);
      });
    },
  );

  it.effect("a listing that fails is reported and dispatch still starts", () => {
    const failure = Errors.DatabaseError.make({
      operation: "listRunningAutomationJobs",
      message: "connection reset",
      cause: new Error("connection reset"),
    });
    const automation = Stores.fakeAutomationStore({ listRunning: () => Effect.fail(failure) });
    return Effect.gen(function* () {
      const fixed = harness(FakeLinear.fakeLinear(), automation);
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "completed");
      expect(sentryErrors(fixed.log)).toEqual([
        expect.objectContaining({
          text: "inherited jobs check failed: connection reset",
          cause: failure,
        }),
      ]);
    });
  });

  it.effect("a job whose lookup fails is reported by id, and the next job is still errored", () => {
    const failure = Errors.DatabaseError.make({
      operation: "findResult",
      message: "connection reset",
      cause: new Error("connection reset"),
    });
    const held: { tests: Stores.FakeTestStore | undefined } = { tests: undefined };
    const tests = Stores.fakeTestStore(
      {},
      {
        findResult: (resultId) =>
          resultId === RESULT_ID
            ? Effect.fail(failure)
            : Effect.sync(() =>
                Option.fromUndefinedOr(held.tests?.results.find((row) => row.id === resultId)),
              ),
      },
    );
    held.tests = tests;
    return Effect.gen(function* () {
      const fixed = { ...harness(), tests };
      seedResult(fixed.tests);
      seedResult(fixed.tests, TICKET_B, "pending", RESULT_B);
      seedRunning(fixed.automation, null, RESULT_ID);
      seedRunning(fixed.automation, null, RESULT_B);
      const id = fixed.automation.jobs[0]?.id;
      yield* start(fixed, FakeHttp.die);
      yield* settle(fixed.automation.jobs, "errored");
      yield* eventually(() => moved(fixed.linear).length > 0, "the next job moved");
      expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["running", "errored"]);
      expect(moved(fixed.linear)).toEqual([
        {
          method: "moveToErrored",
          identifier: TICKET_B,
          message: `drive errored; ${RESTARTED}`,
        },
      ]);
      expect(sentryErrors(fixed.log)).toEqual([
        expect.objectContaining({
          text: `inherited job cleanup failed; ${id}: connection reset`,
          cause: failure,
        }),
        expect.objectContaining({ text: `drive errored; ${RESTARTED}` }),
      ]);
    });
  });

  it.effect("a shutdown during the Linear move waits for the move to land", () =>
    Effect.gen(function* () {
      const moving = yield* Deferred.make<void>();
      const answer = yield* Deferred.make<void>();
      const landed: Array<string> = [];
      const fixed = harness(
        FakeLinear.fakeLinear({
          overrides: {
            moveToErrored: (identifier) =>
              Deferred.succeed(moving, undefined).pipe(
                Effect.andThen(Deferred.await(answer)),
                Effect.andThen(
                  Effect.sync(() => {
                    landed.push(identifier);
                  }),
                ),
              ),
          },
        }),
      );
      seedResult(fixed.tests);
      seedRunning(fixed.automation, null);
      const scope = yield* start(fixed, FakeHttp.die);
      yield* Deferred.await(moving);
      const shutdown = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild);
      for (let i = 0; i < 100; i++) {
        yield* Effect.yieldNow;
      }
      expect(landed).toEqual([]);
      yield* Deferred.succeed(answer, undefined);
      yield* Fiber.join(shutdown);
      expect(landed).toEqual([TICKET]);
      expect(fixed.automation.jobs[0]).toMatchObject({ status: "errored", reason: RESTARTED });
    }),
  );
});

// Two drives on two automation clients, each parked on /run, which a shutdown does not end:
// OpenCode outlives a dropped /run.
const twoRunning = (fixed: Harness, http: FakeHttp.Recorder) =>
  Effect.gen(function* () {
    seedPair(fixed);
    seedLiveClient(fixed.servers);
    seedLiveClient(fixed.servers, OTHER_URL);
    const scope = yield* start(fixed, http.layer);
    yield* eventually(() => sentTo(http, "/run").length === 2, "both drives running");
    return scope;
  });

// The fake automation store, with some of its methods wrapped around its own.
const wrapped = (
  automation: Stores.FakeAutomationStore,
  wrap: (
    store: typeof Automation.AutomationStore.Service,
  ) => Partial<typeof Automation.AutomationStore.Service>,
): Stores.FakeAutomationStore => ({
  jobs: automation.jobs,
  layer: Layer.effect(Automation.AutomationStore)(
    Effect.gen(function* () {
      const store = yield* Automation.AutomationStore;
      return Automation.AutomationStore.of({ ...store, ...wrap(store) });
    }),
  ).pipe(Layer.provide(automation.layer)),
});

// Every request but /abort waits forever; /abort is ok.
const stoppable = reserving((_request, url) =>
  url.pathname === "/abort" ? FakeHttp.json({ ok: "true" }) : Effect.never,
);

describe("a shutdown with drives running", () => {
  it.effect(
    "a shutdown that lands while the running write commits still stops the drive at its automation client",
    () =>
      Effect.gen(function* () {
        const writing = yield* Deferred.make<void>();
        const written = yield* Deferred.make<void>();
        const fixed = harness(
          FakeLinear.fakeLinear(),
          wrapped(Stores.fakeAutomationStore(), (store) => ({
            markRunning: (id, serverId) =>
              store.markRunning(id, serverId).pipe(
                Effect.tap(() => Deferred.succeed(writing, undefined)),
                Effect.tap(() => Deferred.await(written)),
              ),
          })),
        );
        seedResult(fixed.tests);
        seedJob(fixed.automation);
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(stoppable);
        const scope = yield* start(fixed, http.layer);
        yield* Deferred.await(writing);
        const shutdown = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild);
        yield* Deferred.succeed(written, undefined);
        yield* Fiber.join(shutdown);
        expect(sentTo(http, "/abort")).toEqual([`${URL}/abort`]);
        expect(fixed.automation.jobs[0]).toMatchObject({
          status: "aborted",
          reason: SHUTTING_DOWN,
        });
      }),
  );

  it.effect("a shutdown ends only once the aborted row is written", () =>
    Effect.gen(function* () {
      const writing = yield* Deferred.make<void>();
      const written = yield* Deferred.make<void>();
      const fixed = harness(
        FakeLinear.fakeLinear(),
        wrapped(Stores.fakeAutomationStore(), (store) => ({
          finish: (id, status, reason) =>
            Deferred.succeed(writing, undefined).pipe(
              Effect.andThen(Deferred.await(written)),
              Effect.andThen(store.finish(id, status, reason)),
            ),
        })),
      );
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(stoppable);
      const scope = yield* start(fixed, http.layer);
      yield* eventually(() => sentTo(http, "/run").length === 1, "the drive running");
      let closed = false;
      const shutdown = yield* Scope.close(scope, Exit.void).pipe(
        Effect.andThen(
          Effect.sync(() => {
            closed = true;
          }),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(writing);
      expect(sentTo(http, "/abort")).toEqual([`${URL}/abort`]);
      expect(closed).toBe(false);
      expect(fixed.automation.jobs[0]?.status).toBe("running");
      yield* Deferred.succeed(written, undefined);
      yield* Fiber.join(shutdown);
      expect(closed).toBe(true);
      expect(fixed.automation.jobs[0]).toMatchObject({ status: "aborted", reason: SHUTTING_DOWN });
    }),
  );

  it.effect(
    "stops every drive at its automation client at once, and closes each aborted only once it answers",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        const stopped = yield* Deferred.make<void>();
        const http = FakeHttp.recordRequests(
          reserving((_request, url) =>
            url.pathname === "/abort"
              ? Deferred.await(stopped).pipe(Effect.as(FakeHttp.json({ ok: "true" })))
              : Effect.never,
          ),
        );
        const scope = yield* twoRunning(fixed, http);
        let closed = false;
        const shutdown = yield* Scope.close(scope, Exit.void).pipe(
          Effect.andThen(
            Effect.sync(() => {
              closed = true;
            }),
          ),
          Effect.forkChild,
        );
        yield* eventually(() => sentTo(http, "/abort").length === 2, "both asked to stop");
        expect(sentTo(http, "/abort").sort()).toEqual([`${URL}/abort`, `${OTHER_URL}/abort`]);
        expect(
          http.requests
            .filter((request) => request.url.endsWith("/abort"))
            .map((request) => JSON.parse(request.body))
            .sort((left, right) => String(left.ticket).localeCompare(String(right.ticket))),
        ).toEqual([{ ticket: TICKET }, { ticket: TICKET_B }]);
        for (let i = 0; i < 100; i++) {
          yield* Effect.yieldNow;
        }
        expect(closed).toBe(false);
        expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["running", "running"]);
        yield* Deferred.succeed(stopped, undefined);
        yield* Fiber.join(shutdown);
        expect(fixed.automation.jobs.map((job) => [job.status, job.reason])).toEqual([
          ["aborted", SHUTTING_DOWN],
          ["aborted", SHUTTING_DOWN],
        ]);
        expect(FakeLog.texts(fixed.log).filter((text) => text === "drive aborted")).toHaveLength(2);
        expect(
          fixed.linear.calls
            .filter((call) => call.method === "clearReady")
            .map((call) => call.identifier)
            .sort(),
        ).toEqual([TICKET, TICKET_B]);
        expect(sentryErrors(fixed.log)).toEqual([]);
      }),
  );

  it.effect(
    "an automation client that fails the stop, or does not answer it in ten seconds, is reported, and its job stays running for the next startup",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        const http = FakeHttp.recordRequests(
          reserving((_request, url) => {
            if (url.pathname !== "/abort") {
              return Effect.never;
            }
            return url.href.startsWith(URL)
              ? FakeHttp.json({ error: "kill EPERM" }, 500)
              : Effect.never;
          }),
        );
        const scope = yield* twoRunning(fixed, http);
        let closed = false;
        const shutdown = yield* Scope.close(scope, Exit.void).pipe(
          Effect.andThen(
            Effect.sync(() => {
              closed = true;
            }),
          ),
          Effect.forkChild,
        );
        yield* eventually(() => sentTo(http, "/abort").length === 2, "both asked to stop");
        yield* TestClock.adjust("9 seconds");
        expect(closed).toBe(false);
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(shutdown);
        expect(fixed.automation.jobs.map((job) => [job.status, job.finishedAt])).toEqual([
          ["running", null],
          ["running", null],
        ]);
        expect(sentryErrors(fixed.log)).toEqual([
          expect.objectContaining({
            text: `shutdown abort failed; ${URL}`,
            location: "automation",
            agentId: TICKET,
          }),
          expect.objectContaining({
            text: `shutdown abort failed; ${OTHER_URL}`,
            location: "automation",
            agentId: TICKET_B,
            cause: expect.objectContaining({
              message: `automation client: POST ${OTHER_URL}/abort failed: no answer within 10 seconds`,
            }),
          }),
        ]);
        expect(FakeLog.texts(fixed.log)).not.toContain("drive aborted");
        expect(fixed.linear.calls).toEqual([
          { method: "moveToInProgress", identifier: TICKET },
          { method: "moveToInProgress", identifier: TICKET_B },
        ]);
      }),
  );

  it.effect(
    "an automation client that holds nothing for a drive it was running is reported JobNotFound, and the job closes aborted",
    () =>
      Effect.gen(function* () {
        const fixed = harness();
        seedResult(fixed.tests);
        seedJob(fixed.automation);
        seedLiveClient(fixed.servers);
        const id = fixed.automation.jobs[0]?.id;
        const http = FakeHttp.recordRequests(
          reserving((_request, url) =>
            url.pathname === "/abort"
              ? FakeHttp.json({ error: `unknown session "${TICKET}"` }, 404)
              : Effect.never,
          ),
        );
        const scope = yield* start(fixed, http.layer);
        yield* eventually(() => sentTo(http, "/run").length === 1, "the drive running");
        yield* Scope.close(scope, Exit.void);
        expect(sentTo(http, "/abort")).toEqual([`${URL}/abort`]);
        expect(fixed.automation.jobs[0]).toMatchObject({
          status: "aborted",
          reason: SHUTTING_DOWN,
        });
        expect(sentryErrors(fixed.log)).toEqual([
          expect.objectContaining({
            text: JOB_NOT_FOUND,
            location: "automation",
            agentId: TICKET,
            cause: expect.objectContaining({
              _tag: "JobNotFound",
              message: `Job had "running" status but 404'd.`,
              jobId: id,
              url: URL,
            }),
          }),
        ]);
        expect(FakeLog.texts(fixed.log)).toContain("drive aborted");
      }),
  );

  it.effect(
    "a drive whose /run already answered is not stopped: it is judged by its result and closed completed",
    () => {
      const judging = Deferred.makeUnsafe<void>();
      const judged = Deferred.makeUnsafe<void>();
      const held: { tests: Stores.FakeTestStore | undefined } = { tests: undefined };
      // The driver closed the result, so the read after /run is the one that waits.
      const tests = Stores.fakeTestStore(
        {},
        {
          findResult: (resultId) =>
            Effect.gen(function* () {
              const row = held.tests?.results.find((candidate) => candidate.id === resultId);
              if (row?.status === "passed" && !(yield* Deferred.isDone(judged))) {
                yield* Deferred.succeed(judging, undefined);
                yield* Deferred.await(judged);
              }
              return Option.fromUndefinedOr(row);
            }),
        },
      );
      held.tests = tests;
      return Effect.gen(function* () {
        const fixed = { ...harness(), tests };
        seedResult(fixed.tests);
        seedJob(fixed.automation);
        seedLiveClient(fixed.servers);
        const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
        const scope = yield* start(fixed, http.layer);
        yield* Deferred.await(judging);
        const shutdown = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild);
        for (let i = 0; i < 100; i++) {
          yield* Effect.yieldNow;
        }
        expect(fixed.automation.jobs[0]?.status).toBe("running");
        yield* Deferred.succeed(judged, undefined);
        yield* Fiber.join(shutdown);
        expect(fixed.automation.jobs[0]).toMatchObject({ status: "completed", reason: null });
        expect(sentTo(http, "/abort")).toEqual([]);
        expect(FakeLog.texts(fixed.log)).toContain("drive completed");
      });
    },
  );
});

// An automation client with --max-jobs 6 across an automation server restart. The automation
// client is its real routes and Sessions, answered in this fiber. The automation server that
// died is only what it left behind: six running rows, and the six drives the automation client
// still holds for it.
const MAX_JOBS = 6;

const tickets = (first: number, count: number) =>
  Array.from({ length: count }, (_, index) => `OLI-${String(first + index)}`);

const LEFT = tickets(101, MAX_JOBS);
const WAITING = tickets(201, MAX_JOBS + 1);

const resultOf = (ticket: string) =>
  `44444444-4444-4444-8444-${ticket.slice("OLI-".length).padStart(12, "0")}`;

const promptOf = (ticket: string) => `drive ${ticket} as ${MODEL}`;

type SixJobClient = {
  readonly spawner: FakeSpawner.FakeSpawner;
  readonly sessions: Sessions.Sessions["Service"];
  readonly http: Layer.Layer<HttpClient.HttpClient>;
};

// Every OpenCode it starts runs until the test ends it, unless the script says otherwise.
const sixJobClient = (script: FakeSpawner.Script = () => ({})) =>
  Effect.gen(function* () {
    const spawner = FakeSpawner.fakeSpawner(script);
    const services = Layer.mergeAll(
      spawner.layer,
      FakeLog.fakeLog().layer,
      Layer.succeed(Config.ProxyConfig)({
        token: Redacted.make(TOKEN),
        databaseUrl: Redacted.make("postgres://unused"),
      }),
      Layer.succeed(Log.ProcessAttribution)(Log.AutomationClientProcessAttribution),
    );
    const held = yield* Layer.build(
      Sessions.Sessions.layer(
        MAX_JOBS,
        () => Effect.void,
        () => Effect.void,
      ).pipe(Layer.provide(services)),
    );
    const sessions = Context.get(held, Sessions.Sessions);
    const app = yield* HttpRouter.toHttpEffect(
      Handlers.routes.pipe(
        Layer.provide(services),
        Layer.provide(NodeHttpServer.layerHttpServices),
      ),
    );
    const client: SixJobClient = {
      spawner,
      sessions,
      http: FakeHttp.serving(Effect.provideService(app, Sessions.Sessions, sessions)),
    };
    return client;
  });

// What the automation server that died did first: /reserve and /run for each ticket. The runs'
// connections dropped with it; /run is uninterruptible, so each OpenCode keeps running.
const leftBehind = (client: SixJobClient, left: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const connections: Array<Fiber.Fiber<void, Errors.AutomationClientError>> = [];
    for (const ticket of left) {
      yield* AutomationClient.reserve(URL, ticket, "drive");
      connections.push(
        yield* Effect.forkChild(AutomationClient.run(URL, promptOf(ticket), ticket, MODEL)),
      );
    }
    const children = yield* Effect.all(left.map(() => client.spawner.nextSpawn));
    yield* Fiber.interruptAll(connections);
    return children;
  }).pipe(Effect.provide(Layer.mergeAll(client.http, token)));

// `finished` are the drives whose driver closed its result before OpenCode exited.
const seedRestart = (fixed: Harness, clientId: string, finished: ReadonlyArray<string> = []) => {
  for (const ticket of LEFT) {
    const result = finished.includes(ticket) ? "passed" : "pending";
    seedResult(fixed.tests, ticket, result, resultOf(ticket));
    seedRunning(fixed.automation, clientId, resultOf(ticket));
  }
  for (const ticket of WAITING) {
    seedResult(fixed.tests, ticket, "pending", resultOf(ticket));
    seedJob(fixed.automation, "drive", resultOf(ticket));
  }
};

const runningRows = (automation: Stores.FakeAutomationStore) =>
  automation.jobs.filter((job) => job.status === "running");

// A row becomes running only through markRunning. After each one, how many rows are running:
// the largest is the most the database ever held at once.
const countingRunning = (automation = Stores.fakeAutomationStore()) => {
  const afterEachWrite: Array<number> = [];
  const counted = wrapped(automation, (store) => ({
    markRunning: (id, serverId) =>
      store.markRunning(id, serverId).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            afterEachWrite.push(runningRows(automation).length);
          }),
        ),
      ),
  }));
  return { afterEachWrite, automation: counted };
};

const ticketsOf = (fixed: Harness, jobs: ReadonlyArray<{ readonly resultId: string }>) =>
  jobs.map((job) => fixed.tests.results.find((row) => row.id === job.resultId)?.linearId);

// The prompt of each OpenCode still running, in the order they started.
const livePrompts = (client: SixJobClient) =>
  Effect.map(
    Effect.filter(client.spawner.spawned, (child) => child.isRunning),
    (children) => children.map((child) => child.args.at(-1)),
  );

// Every tick here ends turning a drive away for want of room. The clock moves to the next tick
// only once this one has, so each of the twelve ticks after the first is known to have run.
const aMinuteOfTicks = (fixed: Harness) =>
  Effect.gen(function* () {
    const turnedAway = () =>
      FakeLog.texts(fixed.log).filter((text) => text === "deferred; at capacity").length;
    yield* eventually(() => turnedAway() === 1, "the first tick turned a drive away");
    for (let tick = 2; tick <= 13; tick++) {
      yield* TestClock.adjust("5 seconds");
      yield* eventually(() => turnedAway() === tick, `tick ${String(tick)} turned a drive away`);
    }
  });

const until = (check: Effect.Effect<boolean>, what: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 1_000; i++) {
      if (yield* check) {
        return yield* Effect.void;
      }
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(`never: ${what}`);
  });

describe("an automation client with six jobs across an automation server restart", () => {
  it.effect(
    "the six drives left running are closed, six waiting drives take their place, and no more than six are ever running",
    () => {
      const counted = countingRunning();
      const fixed = harness(FakeLinear.fakeLinear(), counted.automation);
      return Effect.gen(function* () {
        const client = yield* sixJobClient();
        const children = yield* leftBehind(client, LEFT);
        // After the automation server died, three OpenCode runs exited and nobody closed their
        // rows: two drivers closed their results first, and one quit with its result open.
        const driving = children.slice(0, 3);
        const exited = children.slice(3);
        for (const child of exited) {
          yield* child.exit(0);
        }
        yield* until(
          Effect.map(client.sessions.jobs, (held) => held === 3),
          "three slots given back",
        );
        const clientId = seedLiveClient(fixed.servers);
        seedRestart(fixed, clientId, LEFT.slice(3, 5));
        yield* start(fixed, client.http);
        yield* aMinuteOfTicks(fixed);
        yield* eventually(
          () => client.spawner.spawned.length === LEFT.length + counted.afterEachWrite.length,
          "every drive written running started its OpenCode",
        );
        // Every row left running was closed before the first new one was written running.
        expect(counted.afterEachWrite).toEqual([1, 2, 3, 4, 5, 6]);
        const [left, waiting] = [fixed.automation.jobs.slice(0, 6), fixed.automation.jobs.slice(6)];
        expect(left.map((job) => [job.status, job.reason])).toEqual([
          ["errored", RESTARTED],
          ["errored", RESTARTED],
          ["errored", RESTARTED],
          ["completed", null],
          ["completed", null],
          ["errored", RESTARTED],
        ]);
        const failed = [...LEFT.slice(0, 3), LEFT[5]];
        expect(moved(fixed.linear).map((call) => call.identifier)).toEqual(failed);
        // The automation client stopped the three still driving. The one that quit it no
        // longer held, and answered 404.
        expect(driving.map((child) => child.kills)).toEqual([
          ["SIGTERM"],
          ["SIGTERM"],
          ["SIGTERM"],
        ]);
        expect(exited.map((child) => child.kills)).toEqual([[], [], []]);
        expect(ticketsOf(fixed, runningRows(fixed.automation))).toEqual(WAITING.slice(0, 6));
        expect(runningRows(fixed.automation).map((job) => job.serverId)).toEqual(
          WAITING.slice(0, 6).map(() => clientId),
        );
        expect(waiting[6]?.status).toBe("pending");
        expect(yield* livePrompts(client)).toEqual(WAITING.slice(0, 6).map(promptOf));
        expect(yield* client.sessions.jobs).toBe(MAX_JOBS);
        // The 404 is reported: a row running that its automation client does not hold.
        expect(sentryErrors(fixed.log).map((line) => [line.text, line.agentId])).toEqual([
          [`drive errored; ${RESTARTED}`, undefined],
          [`drive errored; ${RESTARTED}`, undefined],
          [`drive errored; ${RESTARTED}`, undefined],
          [JOB_NOT_FOUND, LEFT[5]],
          [`drive errored; ${RESTARTED}`, undefined],
        ]);
      });
    },
  );

  it.effect(
    "an automation client that cannot stop its OpenCode keeps its six runs: the rows are errored and reported, and every waiting drive is turned away",
    () => {
      const counted = countingRunning();
      const fixed = harness(FakeLinear.fakeLinear(), counted.automation);
      return Effect.gen(function* () {
        const client = yield* sixJobClient(() => ({ killError: "kill EPERM" }));
        yield* leftBehind(client, LEFT);
        const clientId = seedLiveClient(fixed.servers);
        seedRestart(fixed, clientId);
        yield* start(fixed, client.http);
        yield* aMinuteOfTicks(fixed);
        expect(fixed.automation.jobs.slice(0, 6).map((job) => [job.status, job.reason])).toEqual(
          LEFT.map(() => ["errored", RESTARTED]),
        );
        expect(sentryErrors(fixed.log)).toEqual(
          LEFT.flatMap((ticket) => [
            expect.objectContaining({ text: `inherited abort failed; ${URL}`, agentId: ticket }),
            expect.objectContaining({ text: `drive errored; ${RESTARTED}` }),
          ]),
        );
        expect(fixed.automation.jobs.slice(6).map((job) => job.status)).toEqual(
          WAITING.map(() => "pending"),
        );
        expect(moved(fixed.linear).map((call) => call.identifier)).toEqual(LEFT);
        expect(counted.afterEachWrite).toEqual([]);
        expect(yield* livePrompts(client)).toEqual(LEFT.map(promptOf));
        expect(yield* client.sessions.jobs).toBe(MAX_JOBS);
      });
    },
  );
});

describe("the write that closes a finished job", () => {
  const failure = Errors.DatabaseError.make({
    operation: "finishAutomationJob",
    message: "connection reset",
    cause: new Error("connection reset"),
  });

  it.effect("fails twice, then lands on the third attempt with nothing reported", () => {
    let finishes = 0;
    const held: { automation: Stores.FakeAutomationStore | undefined } = { automation: undefined };
    const automation = Stores.fakeAutomationStore({
      finish: (id, status, reason) =>
        Effect.gen(function* () {
          finishes += 1;
          if (finishes < 3) {
            return yield* Effect.fail(failure);
          }
          const job = held.automation?.jobs.find((row) => row.id === id);
          if (job === undefined) {
            return false;
          }
          job.status = status;
          job.reason = reason;
          job.finishedAt = new Date();
          return true;
        }),
    });
    held.automation = automation;
    return Effect.gen(function* () {
      const fixed = harness(FakeLinear.fakeLinear(), automation);
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
      yield* start(fixed, http.layer);
      yield* settle(fixed.automation.jobs, "completed");
      expect(finishes).toBe(3);
      expect(sentryErrors(fixed.log)).toEqual([]);
      expect(FakeLog.texts(fixed.log)).toContain("drive completed");
    });
  });

  it.effect("fails three times: reported with the job and its status, and left running", () => {
    let finishes = 0;
    const automation = Stores.fakeAutomationStore({
      finish: () =>
        Effect.sync(() => {
          finishes += 1;
        }).pipe(Effect.andThen(Effect.fail(failure))),
    });
    return Effect.gen(function* () {
      const fixed = harness(FakeLinear.fakeLinear(), automation);
      seedResult(fixed.tests);
      seedJob(fixed.automation);
      seedLiveClient(fixed.servers);
      const id = fixed.automation.jobs[0]?.id;
      const http = FakeHttp.recordRequests(reserving(() => closing(fixed.tests)));
      yield* start(fixed, http.layer);
      yield* eventually(() => sentryErrors(fixed.log).length > 0, "the close was reported");
      expect(finishes).toBe(3);
      expect(fixed.automation.jobs[0]?.status).toBe("running");
      expect(sentryErrors(fixed.log)).toEqual([
        expect.objectContaining({
          text: `close write failed; ${id} should be completed`,
          location: "automation",
          cause: failure,
        }),
      ]);
      expect(FakeLog.texts(fixed.log)).not.toContain("drive completed");
      expect(fixed.linear.calls).toEqual([{ method: "moveToInProgress", identifier: TICKET }]);
    });
  });
});
