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

const CONFIG = JSON.stringify({
  models: { drive: "test/drive", diagnose: "test/diagnose", setup: "test/setup" },
  reasoning: { drive: "high", diagnose: "high", setup: "high" },
  openRouterBaseUrl: "https://openrouter.test",
  timeouts: { header: "1 second", chunk: "1 second" },
  runCeiling: "1 minute",
  stepLimit: 10,
  harness: { defaultRetry: "1 second", recentActions: 10 },
  automationServer: {
    dispatchInterval: "10 seconds",
    forgetInterval: "30 seconds",
    forgetAfter: "10 minutes",
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
  } = {},
) => {
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
  const http = FakeHttp.http({ replies: unexpected });
  const dispatches: Array<Stores.Servers.ServerType> = [];
  const sweeps: Array<Parameters<Stores.Servers.Servers["removeStaleServers"]>> = [];
  const stale = [SILENT];
  const servers = App.createService<never, App.NoOptions, Stores.Servers.Servers>(() => ({
    service: "servers",
    listLiveServers: async (type) => {
      dispatches.push(type);
      return options.databaseError === undefined ? jarl.ok([]) : jarl.err(options.databaseError);
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
    getTestRun: unexpected,
    getTestRunDetails: unexpected,
    listTestRuns: unexpected,
    startRun: unexpected,
    completeRun: unexpected,
    errorRun: unexpected,
    abortRun: unexpected,
    createJob: unexpected,
    getJob: unexpected,
    getJobDetails: unexpected,
    listJobs: unexpected,
    latestJob: unexpected,
    nextPendingJob: unexpected,
    runJob: unexpected,
    completeJob: unexpected,
    finalizeJob: unexpected,
    errorJob: unexpected,
    timeoutJob: unexpected,
    abortJob: unexpected,
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
  const services = {
    http: http.http,
    logger: log.logger,
    servers,
    tests,
    setupRequests,
  } satisfies App.Needs<
    | Http.Http
    | Logger.Logger
    | Stores.Servers.Servers
    | Stores.Tests.Tests
    | Stores.SetupRequests.SetupRequests
  >;
  const addresses: Array<Parameters<typeof Serve.listen>[1]> = [];
  const order: Array<string> = [];
  const listen: typeof Serve.listen = async (_handler, address) => {
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
  return {
    running,
    stop,
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
});
