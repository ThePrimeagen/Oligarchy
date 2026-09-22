import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, FileSystem, Layer, Option, Redacted, Scope } from "effect";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeLinear from "../support/fake-linear.ts";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientError } from "effect/unstable/http";
import * as AutomationClient from "../../src/automation-server/client.ts";
import * as Worker from "../../src/automation-server/worker.ts";
import * as SetupRequests from "../../src/db/setup-requests.ts";
import * as FakeFs from "../support/fake-fs.ts";
import * as FakeHttp from "../support/fake-http.ts";
import * as FakeLog from "../support/log.ts";
import * as Stores from "../support/stores.ts";

const URL = "http://127.0.0.1:55333";
const TOKEN = "test-token";
const TICKET = "OLI-42";
const TICKET_B = "OLI-43";
const RESULT_ID = "22222222-2222-4222-8222-222222222222";
const RESULT_B = "33333333-3333-4333-8333-333333333333";
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

const seedJob = (
  automation: Stores.FakeAutomationStore,
  action: "drive" | "diagnose" | "mint" = "drive",
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

type Harness = {
  readonly automation: Stores.FakeAutomationStore;
  readonly servers: Stores.FakeServerStore;
  readonly tests: Stores.FakeTestStore;
  readonly log: FakeLog.FakeLog;
  readonly linear: FakeLinear.FakeLinear;
  readonly pins: Map<string, string>;
};

const harness = (linear: FakeLinear.FakeLinear = FakeLinear.fakeLinear()): Harness => ({
  automation: Stores.fakeAutomationStore(),
  servers: Stores.fakeServerStore(),
  tests: Stores.fakeTestStore(),
  log: FakeLog.fakeLog(),
  linear,
  pins: new Map(),
});

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

const seedPair = (fixed: Harness) => {
  seedResult(fixed.tests);
  seedResult(fixed.tests, TICKET_B, "pending", RESULT_B);
  seedJob(fixed.automation, "drive", RESULT_ID);
  seedJob(fixed.automation, "drive", RESULT_B);
};

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
          "drive succeeded",
        ]);
        expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([
          cleared(TICKET),
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
      yield* settleAll(fixed.automation.jobs, "succeeded");
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
      yield* settleAll(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs.every((job) => job.status === "succeeded")).toBe(true);
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
      yield* settleAll(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs.every((job) => job.status === "succeeded")).toBe(true);
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
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs.map((job) => [job.action, job.status])).toEqual([
        ["drive", "succeeded"],
        ["diagnose", "pending"],
        ["drive", "succeeded"],
      ]);
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
      expect(fixed.linear.calls.filter((call) => call.method === "clearReady")).toEqual([
        cleared(TICKET),
      ]);
    }),
  );

  it.effect(
    "a ready label that keeps failing is retried and then logged, and the job stays failed",
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
        yield* settle(fixed.automation.jobs, "failed");
        expect(attempts).toBe(3);
        expect(fixed.automation.jobs[0]?.status).toBe("failed");
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
      yield* settle(fixed.automation.jobs, "failed");
      expect(attempts).toBe(2);
      expect(fixed.automation.jobs[0]?.status).toBe("failed");
      expect(
        FakeLog.texts(fixed.log).some((text) => text.startsWith("ready label clear failed")),
      ).toBe(false);
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
        expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["running", "pending"]);
        yield* Deferred.succeed(release, undefined);
        yield* settle(fixed.automation.jobs, "failed");
        yield* settle(fixed.automation.jobs, "succeeded");
        expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["failed", "succeeded"]);
        expect(http.requests.filter((request) => request.url.endsWith("/run"))).toHaveLength(1);
        expect(http.requests[0]?.url).toBe(`${URL}/reserve`);
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
      yield* settle(fixed.automation.jobs, "succeeded");
      expect(fixed.automation.jobs.map((job) => job.status)).toEqual(["succeeded", "pending"]);
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
        yield* settleAll(fixed.automation.jobs, "succeeded");
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
    }),
  );

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
      yield* settle(fixed.automation.jobs, "failed");
      expect(http.requests).toEqual([]);
      expect(fixed.automation.jobs[0]?.reason).toContain("has no pinned server");
    }),
  );
});
