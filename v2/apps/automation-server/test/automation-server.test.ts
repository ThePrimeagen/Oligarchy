import * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import type * as Http from "@oligarchy/http";
import * as Serve from "@oligarchy/http/serve";
import * as FakeHttp from "@oligarchy/http/testing";
import type * as Logger from "@oligarchy/logger";
import * as FakeLogger from "@oligarchy/logger/testing";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Application from "../src/application.ts";
import { environment } from "../src/environment.ts";

const PORT = 4100;
const TOKEN = "oligarchy-token";
const SILENT = "http://silent-client.test:4100";
const STARTED =
  "[INFO] [global] automation-server: started on 127.0.0.1:4100; drive test/drive; diagnose test/diagnose; setup test/setup";
const STOPPED = "[INFO] [global] automation-server: stopped; SIGTERM received";
const FORGOTTEN = `[INFO] [global] automation-server: server forgotten; ${SILENT} silent for 600 seconds`;
const CLIENT = "http://10.0.0.7:4100";
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const DRIVE = "33333333-3333-4333-8333-333333333333";
const DIAGNOSE = "44444444-4444-4444-8444-444444444444";
const RESERVED = `[INFO] [${DRIVE}] automation-server: reserved drive; ${CLIENT}`;
const QUEUED = `[INFO] [${DRIVE}] automation-server: drive completed; diagnose ${DIAGNOSE} queued`;
const ABORTED = `[INFO] [${DRIVE}] automation-server: aborted pending drive`;
const AT = new Date(0);
const RUN_ROW: Stores.Tests.RunRow = {
  id: RUN,
  suiteId: null,
  definitionId: 1,
  iso: "https://iso.omarchy.org/omarchy-4.0.4.iso",
  serverUrl: "http://127.0.0.1:42069",
  model: "test/drive",
  status: "running",
  reason: null,
  createdAt: AT,
  finishedAt: null,
};
const job = (id: string, action: Stores.Tests.JobAction): Stores.Tests.JobRow => ({
  id,
  runId: RUN,
  action,
  status: "pending",
  reason: null,
  serverId: null,
  createdAt: AT,
  startedAt: null,
  finishedAt: null,
});

const CONFIG = JSON.stringify({
  models: { drive: "test/drive", diagnose: "test/diagnose", setup: "test/setup" },
  reasoning: { drive: "high", diagnose: "high", setup: "high" },
  openRouterBaseUrl: "https://openrouter.test",
  httpTimeout: "10 seconds",
  driver: {
    runCeiling: "1 minute",
    stepLimit: 10,
    askTimeout: "1 second",
    harness: { defaultRetry: "1 second", recentActions: 10 },
    guest: { startTimeout: "1 minute", saveTimeout: "1 minute" },
  },
  diagnose: { runCeiling: "1 minute", headerTimeout: "1 second", chunkTimeout: "1 second" },
  automationClient: {
    driverGrace: "5 minutes",
    killGrace: "5 seconds",
    stderrGrace: "2 seconds",
    reserveTimeout: "1 minute",
    reservationTimeout: "2 minutes",
  },
  qemuServer: {
    probeTimeout: "3 seconds",
    reserveTimeout: "45 seconds",
    releaseTimeout: "30 seconds",
    setupInterval: "10 seconds",
    forgetInterval: "30 seconds",
    forgetAfter: "10 minutes",
    followTimeout: "1 hour",
  },
  qemuRunner: {
    reservationTimeout: "2 minutes",
    idleTimeout: "10 minutes",
    sweepInterval: "10 seconds",
    poweroffTimeout: "10 seconds",
    killGrace: "5 seconds",
    stderrGrace: "2 seconds",
    downloadTimeout: "10 seconds",
    cachePoll: "1 second",
    cacheStale: "2 minutes",
    cacheHeartbeat: "10 seconds",
    cacheProgress: "30 seconds",
    handshakeTimeout: "1 second",
    commandTimeout: "15 seconds",
    keyGap: "100 millis",
    clickGap: "100 millis",
    dragGap: "20 millis",
    dragSteps: 20,
    maxKeys: 10000,
    maxTicks: 100,
    followBacklog: 256,
    maxFrame: 1048576,
    stderrLimit: 1048576,
    cpus: 4,
    diskSize: "64G",
    memory: "4G",
    firmwareCode: "/usr/share/edk2/x64/OVMF_CODE.4m.fd",
    firmwareVars: "/usr/share/edk2/x64/OVMF_VARS.4m.fd",
    binary: "qemu-system-x86_64",
    imageBinary: "qemu-img",
  },
  automationServer: {
    dispatchInterval: "10 seconds",
    forgetInterval: "30 seconds",
    forgetAfter: "10 minutes",
    abortTimeout: "45 seconds",
  },
});

const unexpected = (): never => {
  throw new Error("unexpected service call");
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const started = async (
  options: {
    readonly listenError?: Serve.ListenFailed;
    readonly databaseError?: Db.DatabaseError;
    readonly close?: Promise<void>;
    // One live client and one pending drive, whose run ends at once and whose completion is
    // written only once this settles.
    readonly completing?: Promise<void>;
    // An operator's abort of the pending drive is written only once this settles.
    readonly aborting?: Promise<void>;
    readonly recovering?: Promise<void>;
  } = {},
) => {
  const { completing, aborting } = options;
  const order: Array<string> = [];
  let pending: Array<Stores.Tests.JobRow> = completing === undefined ? [] : [job(DRIVE, "drive")];
  const env = jarl.unwrap(
    await Env.create(
      environment,
      Env.fakeIo({
        argv: ["--port", String(PORT)],
        env: { DATABASE_URL: "postgres://unused.test/db", OLIGARCHY_TOKEN: TOKEN },
        files: { [Env.CONFIG_PATH]: CONFIG },
      }),
    ),
  );
  const log = FakeLogger.logger();
  const http = FakeHttp.http({
    replies: completing === undefined ? unexpected : () => FakeHttp.json({}),
  });
  const dispatches: Array<Stores.Servers.ServerType> = [];
  const sweeps: Array<Parameters<Stores.Servers.Servers["removeStaleServers"]>> = [];
  const stale = [SILENT];
  const servers = App.createService<never, App.NoOptions, Stores.Servers.Servers>(() => ({
    service: "servers",
    listLiveServers: async (type) => {
      dispatches.push(type);
      if (options.databaseError !== undefined) {
        return jarl.err(options.databaseError);
      }
      return jarl.ok(completing === undefined ? [] : [{ id: CLIENT_ID, url: CLIENT }]);
    },
    removeStaleServers: async (...args) => {
      sweeps.push(args);
      return options.databaseError === undefined
        ? jarl.ok(stale.splice(0))
        : jarl.err(options.databaseError);
    },
    addServer: unexpected,
    heartbeat: unexpected,
    removeServer: unexpected,
    listServers: unexpected,
    listMachines: unexpected,
    findServer: unexpected,
    routeJob: unexpected,
    serverForJob: unexpected,
  }))({});
  const tests = App.createService<never, App.NoOptions, Stores.Tests.Tests>(() => ({
    service: "tests",
    ensureSetup: unexpected,
    listTestDefinitions: unexpected,
    findTestDefinition: unexpected,
    listTestDefinitionHistory: unexpected,
    defineTestDefinition: unexpected,
    listTestBasePrompts: unexpected,
    definitionName: unexpected,
    createTestSuite: unexpected,
    getTestSuite: unexpected,
    getTestSuiteDetails: unexpected,
    listTestSuites: unexpected,
    completeSuite: unexpected,
    abortSuite: unexpected,
    createTestRun: unexpected,
    getTestRun: async () => jarl.ok({ ...RUN_ROW, test: "lock-screen", suite: null }),
    getTestRunDetails: unexpected,
    listTestRuns: unexpected,
    startRun: unexpected,
    completeRun: unexpected,
    errorRun: unexpected,
    timeoutRun: unexpected,
    abortRun: async () => {
      order.push("run aborted");
      return jarl.ok({ ...RUN_ROW, status: "aborted" });
    },
    createJob: async (_runId, action) => jarl.ok(job(DIAGNOSE, action)),
    getJob: async (jobId) => jarl.ok({ ...job(jobId, "drive"), test: "lock-screen" }),
    getJobDetails: async () =>
      jarl.ok({
        job: job(DRIVE, "drive"),
        run: RUN_ROW,
        suite: null,
        definition: {
          id: 1,
          name: "first-boot",
          description: "",
          instruction: "",
          proof: "",
          resume: false,
          createdAt: AT,
        },
      }),
    listJobs: async () => jarl.ok({ running: [], pending: [] }),
    listRunningJobs: async () => {
      await options.recovering;
      return jarl.ok([]);
    },
    completeDiagnosis: unexpected,
    timeoutJobAndRun: unexpected,
    latestJob: unexpected,
    nextPendingJob: async () => {
      const [next] = pending;
      pending = [];
      return jarl.ok(next);
    },
    runJob: async (jobId) => jarl.ok({ ...job(jobId, "drive"), status: "running" }),
    completeJob: unexpected,
    completeDrive: async () => {
      await completing;
      order.push("drive completed");
      return jarl.ok(job(DIAGNOSE, "diagnose"));
    },
    finalizeJob: unexpected,
    errorJob: unexpected,
    timeoutJob: unexpected,
    abortJob: async (jobId) => {
      await aborting;
      order.push("drive aborted");
      return jarl.ok({ ...job(jobId, "drive"), status: "aborted" });
    },
  }))({});
  const setupRequests = App.createService<never, App.NoOptions, Stores.SetupRequests.SetupRequests>(
    () => ({
      service: "setupRequests",
      insert: unexpected,
      setJob: unexpected,
      claim: unexpected,
      remove: unexpected,
      removeServer: unexpected,
      serverForJob: unexpected,
      list: unexpected,
      inspect: unexpected,
    }),
  )({});
  const diagnosis = App.createService<never, App.NoOptions, Stores.Diagnosis.Diagnosis>(() => ({
    service: "diagnosis",
    createErrorType: unexpected,
    listErrorTypes: unexpected,
    findErrorType: unexpected,
    saveDiagnosis: unexpected,
    getDiagnosis: unexpected,
  }))({});
  const services = {
    http: http.http,
    logger: log.logger,
    servers,
    tests,
    setupRequests,
    diagnosis,
  } satisfies App.Needs<
    | Http.Http
    | Logger.Logger
    | Stores.Servers.Servers
    | Stores.Tests.Tests
    | Stores.SetupRequests.SetupRequests
    | Stores.Diagnosis.Diagnosis
  >;
  const addresses: Array<Parameters<typeof Serve.listen>[1]> = [];
  let served: Parameters<typeof Serve.listen>[0] = unexpected;
  const listen: typeof Serve.listen = async (handler, address) => {
    served = handler;
    addresses.push(address);
    if (options.listenError !== undefined) {
      return jarl.err(options.listenError);
    }
    return jarl.ok({
      close: async () => {
        order.push("close listener");
        await options.close;
        order.push("listener closed");
      },
    });
  };
  const codes: Array<number> = [];
  const errors: Array<unknown> = [];
  const stderr: Array<string> = [];
  let signal: (name: App.Signal) => void = unexpected;
  const io: App.Io = {
    onSignal: (handler) => {
      signal = handler;
      return () => {
        signal = unexpected;
      };
    },
    exit: (code) => {
      codes.push(code);
    },
    stderr: (text) => {
      stderr.push(text);
    },
  };
  const app = new App.App(env).main(Application.main({ listen }));
  app.onExit(() => {
    order.push("exit handler");
  });
  const running = app.run(
    services,
    (failed) => {
      errors.push(...failed);
    },
    io,
  );
  const stop = () => {
    if (!app.signal.aborted) {
      signal("SIGTERM");
    }
    return running;
  };
  await vi.advanceTimersByTimeAsync(0);
  const abort = (jobId: string) =>
    served(
      new Request(`http://127.0.0.1:${PORT}/abort`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      }),
    );
  return {
    running,
    stop,
    abort,
    codes,
    errors,
    stderr,
    addresses,
    order,
    dispatches,
    sweeps,
    lines: log.lines,
  };
};

describe("the automation server lifecycle", () => {
  it("finishes shutdown when stopped during recovery before dispatch could start", async () => {
    let release!: () => void;
    const recovering = new Promise<void>((resolve) => {
      release = resolve;
    });
    const at = await started({ recovering });
    const stopped = at.stop();
    release();
    await stopped;
    expect(at.dispatches).toEqual([]);
    expect(at.order).toEqual(["close listener", "listener closed", "exit handler"]);
    expect(at.codes).toEqual([0]);
    expect(at.errors).toEqual([]);
  });

  it("starts dispatch and cleanup at their intervals, then stops both on SIGTERM and awaits listener closure before exit (happy)", async () => {
    let release: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const at = await started({ close: closed });
    try {
      expect(at.addresses).toEqual([{ hostname: "127.0.0.1", port: PORT }]);
      expect(at.lines).toEqual([STARTED, FORGOTTEN]);
      expect(at.dispatches).toEqual(["automation-client"]);
      expect(at.sweeps).toEqual([["automation-client", 600_000]]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(at.dispatches).toHaveLength(2);
      expect(at.sweeps).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(at.dispatches).toHaveLength(4);
      expect(at.sweeps).toHaveLength(2);
      expect(at.codes).toEqual([]);

      const stopped = at.stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(at.order).toEqual(["close listener"]);
      expect(at.codes).toEqual([]);
      expect(at.lines).toEqual([STARTED, FORGOTTEN]);
      release();
      await stopped;
      expect(at.order).toEqual(["close listener", "listener closed", "exit handler"]);
      expect(at.lines).toEqual([STARTED, FORGOTTEN, STOPPED]);
      expect(at.codes).toEqual([0]);
      expect(at.errors).toEqual([]);
      expect(at.stderr).toEqual([]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(at.dispatches).toHaveLength(4);
      expect(at.sweeps).toHaveLength(2);
    } finally {
      release();
      await at.stop();
    }
  });

  it("a listen failure is fatal and exits 1 without starting dispatch or cleanup (unhappy)", async () => {
    const error = new Serve.ListenFailed("could not listen on 127.0.0.1:4100: EADDRINUSE");
    const at = await started({ listenError: error });
    await at.running;
    expect(at.lines).toEqual([`[FATAL] [global] automation-server: ${error.message}`]);
    expect(at.dispatches).toEqual([]);
    expect(at.sweeps).toEqual([]);
    expect(at.order).toEqual(["exit handler"]);
    expect(at.errors).toEqual([error]);
    expect(at.codes).toEqual([1]);
  });

  it("database refusals are logged and still permit a clean shutdown (unhappy)", async () => {
    const at = await started({ databaseError: new Db.DatabaseError("connection refused") });
    await at.stop();
    expect(at.lines[0]).toBe(STARTED);
    expect(at.lines).toContain(
      "[ERROR] [global] automation-server: stale server cleanup failed: connection refused",
    );
    expect(at.lines).toContain(
      "[ERROR] [global] automation-server: dispatch failed: connection refused",
    );
    expect(at.lines.at(-1)).toBe(STOPPED);
    expect(at.order).toEqual(["close listener", "listener closed", "exit handler"]);
    expect(at.codes).toEqual([0]);
    expect(at.errors).toEqual([]);
    expect(at.stderr).toEqual([]);
  });

  it("a SIGTERM while a run's close is writing waits for the close before any exit handler (unhappy)", async () => {
    let release: () => void = () => undefined;
    const completing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const at = await started({ completing });
    try {
      expect(at.lines).toEqual([STARTED, FORGOTTEN, RESERVED]);

      const stopped = at.stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(at.order).toEqual(["close listener", "listener closed"]);
      expect(at.codes).toEqual([]);

      release();
      await stopped;
      expect(at.order).toEqual([
        "close listener",
        "listener closed",
        "drive completed",
        "exit handler",
      ]);
      expect(at.lines).toEqual([STARTED, FORGOTTEN, RESERVED, QUEUED, STOPPED]);
      expect(at.codes).toEqual([0]);
      expect(at.errors).toEqual([]);
    } finally {
      release();
      await at.stop();
    }
  });

  it("a SIGTERM while an operator's abort is writing waits for the abort before any exit handler (unhappy)", async () => {
    let release: () => void = () => undefined;
    const aborting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const at = await started({ aborting });
    try {
      const answered = Promise.resolve(at.abort(DRIVE));
      await vi.advanceTimersByTimeAsync(0);
      const stopped = at.stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(at.order).toEqual(["close listener", "listener closed"]);
      expect(at.codes).toEqual([]);

      release();
      await stopped;
      expect(at.order).toEqual([
        "close listener",
        "listener closed",
        "drive aborted",
        "run aborted",
        "exit handler",
      ]);
      expect((await answered).status).toBe(200);
      expect(at.lines).toEqual([STARTED, FORGOTTEN, ABORTED, STOPPED]);
      expect(at.codes).toEqual([0]);
      expect(at.errors).toEqual([]);
    } finally {
      release();
      await at.stop();
    }
  });
});
