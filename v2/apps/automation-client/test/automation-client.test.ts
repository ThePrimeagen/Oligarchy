import * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import type * as Fleet from "@oligarchy/fleet";
import * as FakeHttp from "@oligarchy/http/testing";
import * as Serve from "@oligarchy/http/serve";
import * as FakeLogger from "@oligarchy/logger/testing";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Application from "../src/application.ts";
import { environment } from "../src/environment.ts";

const TOKEN = "oligarchy-token";
const NAME = "c1";
const PORT = 4100;
const CLIENT_URL = "http://c1.test:4100";
const PROXY_URL = "http://proxy.test:42069";
const JOB = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const STARTED = `[INFO] [global] automation-client: started on 127.0.0.1:4100; name ${NAME}; announcing ${CLIENT_URL}`;
const STOPPED = "[INFO] [global] automation-client: stopped; SIGTERM received";

const CONFIG = JSON.stringify({
  models: { drive: "test/model", diagnose: "test/model", setup: "test/model" },
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
    dispatchInterval: "1 second",
    forgetInterval: "1 second",
    forgetAfter: "1 minute",
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
    readonly heartbeatError?: Db.DatabaseError;
  } = {},
) => {
  const env = jarl.unwrap(
    await Env.create(
      environment,
      Env.fakeIo({
        argv: [
          "--port",
          String(PORT),
          "--name",
          NAME,
          "--url",
          CLIENT_URL,
          "--max-jobs",
          "1",
          "--server-url",
          PROXY_URL,
        ],
        env: {
          DATABASE_URL: "postgres://unused.test/db",
          OLIGARCHY_TOKEN: TOKEN,
          OPENROUTER_API_KEY: "openrouter-token",
        },
        files: { [Env.CONFIG_PATH]: CONFIG },
      }),
    ),
  );
  const log = FakeLogger.logger();
  const order: Array<string> = [];
  const heartbeats: Array<Parameters<Stores.Servers.Servers["heartbeat"]>> = [];
  const readings: Array<Parameters<Stores.ProcessStats.ProcessStats["report"]>> = [];
  const removed: Array<string> = [];
  const http = FakeHttp.http({
    replies: (asked) => {
      order.push(new URL(asked.url).pathname);
      return FakeHttp.json({});
    },
  });
  const host = App.createService<never, App.NoOptions, Fleet.Host.Host>(() => ({
    service: "host",
    sample: () => undefined,
    collect: () => ({
      memory: { totalBytes: 1000, usedBytes: 750, freeBytes: 250 },
      cpu: {
        cores: 2,
        mean: 10,
        mean1m: 11,
        mean2m: 12,
        mean3m: 13,
        p10: 0,
        p25: 0,
        p75: 0,
        p90: 50,
      },
    }),
  }))({});
  const usage = App.createService<never, App.NoOptions, Fleet.Usage.Usage>(() => ({
    service: "usage",
    collect: async () => jarl.ok({ memoryBytes: 5, cpuPercent: 1.5 }),
  }))({});
  const servers = App.createService<never, App.NoOptions, Stores.Servers.Servers>(() => ({
    service: "servers",
    heartbeat: async (...args) => {
      heartbeats.push(args);
      return options.heartbeatError === undefined
        ? jarl.ok(undefined)
        : jarl.err(options.heartbeatError);
    },
    removeServer: async (url) => {
      removed.push(url);
      return jarl.ok(true);
    },
    addServer: unexpected,
    listServers: unexpected,
    listMachines: unexpected,
    listLiveServers: unexpected,
    removeStaleServers: unexpected,
    findServer: unexpected,
    routeJob: unexpected,
    serverForJob: unexpected,
  }))({});
  const processStats = App.createService<never, App.NoOptions, Stores.ProcessStats.ProcessStats>(
    () => ({
      service: "processStats",
      report: async (...args) => {
        readings.push(args);
        return jarl.ok(undefined);
      },
      listSeries: unexpected,
    }),
  )({});
  const addresses: Array<Parameters<typeof Serve.listen>[1]> = [];
  let fetch: Parameters<typeof Serve.listen>[0] = unexpected;
  const listen: typeof Serve.listen = async (handler, address) => {
    addresses.push(address);
    if (options.listenError !== undefined) {
      return jarl.err(options.listenError);
    }
    fetch = handler;
    return jarl.ok({
      close: async () => {
        order.push("close listener");
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
  const app = new App.App(env).main(Application.main({ listen, spawn: unexpected, env: {} }));
  const running = app.run(
    { http: http.http, logger: log.logger, host, usage, servers, processStats },
    (failed) => {
      errors.push(...failed);
    },
    io,
  );
  await vi.advanceTimersByTimeAsync(0);
  return {
    running,
    codes,
    errors,
    stderr,
    addresses,
    heartbeats,
    readings,
    removed,
    order,
    lines: log.lines,
    signal: (name: App.Signal) => signal(name),
    reserve: () =>
      fetch(
        new Request(`${CLIENT_URL}/reserve`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ jobId: JOB, action: "drive" }),
        }),
      ),
  };
};

describe("the automation client lifecycle", () => {
  it("announces its name and URL, reports held jobs, and closes the listener before releasing reservations on shutdown (happy)", async () => {
    const at = await started();
    try {
      expect(at.addresses).toEqual([{ hostname: "127.0.0.1", port: PORT }]);
      expect(at.lines).toEqual([STARTED]);
      expect(at.heartbeats).toEqual([
        [
          CLIENT_URL,
          "automation-client",
          NAME,
          {
            qemus: 0,
            memory: { totalBytes: 1000, usedBytes: 750 },
            cpu: { mean1m: 11, mean2m: 12, mean3m: 13 },
          },
        ],
      ]);
      expect(at.readings).toEqual([
        [NAME, "automation-client", { jobs: 0, memoryBytes: 5, cpuPercent: 1.5 }],
      ]);
      expect((await at.reserve()).status).toBe(200);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(at.readings.at(-1)).toEqual([
        NAME,
        "automation-client",
        { jobs: 1, memoryBytes: 5, cpuPercent: 1.5 },
      ]);
      expect(at.codes).toEqual([]);
    } finally {
      at.signal("SIGTERM");
      await at.running;
    }
    expect(at.order).toEqual(["/reserve", "close listener", "/relinquish"]);
    expect(at.removed).toEqual([CLIENT_URL]);
    expect(at.lines).toEqual([STARTED, STOPPED]);
    expect(at.codes).toEqual([0]);
    expect(at.errors).toEqual([]);
    expect(at.stderr).toEqual([]);
  });

  it("a listen failure is fatal and exits 1 without announcing (unhappy)", async () => {
    const error = new Serve.ListenFailed("could not listen on 127.0.0.1:4100: EADDRINUSE");
    const at = await started({ listenError: error });
    await at.running;
    expect(at.lines).toEqual([`[FATAL] [global] automation-client: ${error.message}`]);
    expect(at.heartbeats).toEqual([]);
    expect(at.readings).toEqual([]);
    expect(at.removed).toEqual([]);
    expect(at.order).toEqual([]);
    expect(at.errors).toEqual([error]);
    expect(at.codes).toEqual([1]);
  });

  it("a refused heartbeat is logged and still permits a clean shutdown (unhappy)", async () => {
    const at = await started({ heartbeatError: new Db.DatabaseError("connection refused") });
    at.signal("SIGTERM");
    await at.running;
    expect(at.lines).toEqual([
      STARTED,
      "[ERROR] [global] automation-client: heartbeat failed: connection refused",
      STOPPED,
    ]);
    expect(at.removed).toEqual([CLIENT_URL]);
    expect(at.order).toEqual(["close listener"]);
    expect(at.codes).toEqual([0]);
    expect(at.errors).toEqual([]);
  });
});
