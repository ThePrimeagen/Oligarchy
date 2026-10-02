import { EventEmitter } from "node:events";
import { TIMED_OUT } from "@oligarchy/driver/exits";
import * as Env from "@oligarchy/env";
import * as Fake from "@oligarchy/http/testing";
import * as FakeLogger from "@oligarchy/logger/testing";
import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Child from "../src/child.ts";
import * as Jobs from "../src/jobs.ts";
import * as Proxy from "../src/proxy.ts";
import * as Reserve from "../src/reserve.ts";
import { RunFailed, RunTimedOut } from "../src/routes.ts";
import * as Run from "../src/run.ts";

const TOKEN = "oligarchy-token";
const PROXY = "http://127.0.0.1:42069";
const JOB = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const OTHER = "0d9f4b1a-5c2e-4f7a-8b3d-1e6a9c2f4b70";
const DRIVE = { jobId: JOB, action: "drive" } as const;
const DIAGNOSE = { jobId: OTHER, action: "diagnose" } as const;
const PROMPT = "diagnose the job";
const DRIVER = `${Env.ROOT}v2/driver`;
const STDIO = ["ignore", "inherit", "pipe"];
const CEILING_MS = 60_000;
const DRIVER_RUN_CEILING_MS = 120_000;
const DRIVER_CEILING_MS = DRIVER_RUN_CEILING_MS + 240_000;
const KILL_GRACE_MS = 3_000;
const STDERR_GRACE_MS = 1_000;

const CONFIG = JSON.stringify({
  models: { drive: "test/drive", diagnose: "test/diagnose", setup: "test/setup" },
  reasoning: { drive: "high", diagnose: "medium", setup: "low" },
  openRouterBaseUrl: "https://openrouter.test",
  httpTimeout: "10 seconds",
  driver: {
    runCeiling: "2 minutes",
    stepLimit: 10,
    askTimeout: "1 second",
    harness: { defaultRetry: "1 second", recentActions: 10 },
    guest: { startTimeout: "1 minute", saveTimeout: "1 minute" },
  },
  diagnose: { runCeiling: "1 minute", headerTimeout: "20 seconds", chunkTimeout: "30 seconds" },
  automationClient: {
    driverGrace: "4 minutes",
    killGrace: "3 seconds",
    stderrGrace: "1 second",
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

// The parent's own environment, and the client's resolved variables, which may have come from an
// --env-file the parent's environment does not hold.
const PARENT = { PATH: "/usr/bin", DATABASE_URL: "postgres://stale.test/db" };
const VARS = {
  DATABASE_URL: "postgres://db.test/oligarchy",
  OLIGARCHY_TOKEN: TOKEN,
  OPENROUTER_API_KEY: "openrouter-token",
};
const CHILD_ENV = { ...PARENT, ...VARS };
const OPENCODE_CONFIG = JSON.stringify({
  permission: { external_directory: "allow", doom_loop: "allow" },
  provider: { openrouter: { options: { headerTimeout: 20_000, chunkTimeout: 30_000 } } },
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Whether promise has settled once everything already queued has run.
const settled = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  return done;
};

// Every child spawned, each ended, failed or written to when the test says. A spawn handed refusal
// throws it instead, as node's does for an argument it will not pass.
const fakeSpawn = (refusal?: Error) => {
  const calls: Array<Parameters<Child.Spawn>> = [];
  const children: Array<{
    readonly signals: ReadonlyArray<string>;
    readonly write: (text: string) => void;
    readonly fail: (error: Error) => void;
    readonly exit: (code: number | null, signal?: string) => void;
    readonly close: () => void;
    readonly end: (code: number | null, signal?: string) => void;
  }> = [];
  const spawn: Child.Spawn = (...args) => {
    calls.push(args);
    if (refusal !== undefined) {
      throw refusal;
    }
    const events = new EventEmitter();
    const stderr = new EventEmitter();
    const signals: Array<string> = [];
    let pid: number | undefined = 42;
    let exitCode: number | null = null;
    let signalCode: string | null = null;
    const exit = (code: number | null, signal?: string) => {
      exitCode = code;
      signalCode = signal ?? null;
      events.emit("exit", code, signalCode);
    };
    const close = () => events.emit("close");
    children.push({
      signals,
      write: (text) => stderr.emit("data", text),
      fail: (error) => {
        pid = undefined;
        events.emit("error", error);
        close();
      },
      exit,
      close,
      end: (code, signal) => {
        exit(code, signal);
        close();
      },
    });
    return {
      get pid() {
        return pid;
      },
      get exitCode() {
        return exitCode;
      },
      get signalCode() {
        return signalCode;
      },
      kill: (signal) => {
        signals.push(signal);
      },
      on: events.on.bind(events),
      stderr: { setEncoding: () => {}, on: stderr.on.bind(stderr) },
    };
  };
  const child = (index: number) => {
    const found = children[index];
    if (found === undefined) {
      throw new Error(`no child ${String(index)} was spawned`);
    }
    return found;
  };
  return { spawn, calls, child };
};

const running = async (refusal?: Error) => {
  const env = jarl.unwrap(
    await Env.create(
      Env.cli({ name: "run-test", description: "" })
        .needs("databaseUrl", "oligarchyToken", "openRouterToken")
        .done(),
      Env.fakeIo({ env: VARS, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  );
  const proxy = Fake.http({ replies: () => Fake.json({}) });
  const jobs = Jobs.create();
  const log = FakeLogger.logger();
  const reservations = Reserve.create({
    reservationTimeoutMs: 120_000,
    maxJobs: 2,
    jobs,
    proxy: Proxy.create({
      http: proxy.http,
      url: PROXY,
      token: { reveal: () => TOKEN },
      reserveTimeoutMs: 60_000,
      releaseTimeoutMs: 10_000,
    }),
    logger: log.logger,
  });
  const spawned = fakeSpawn(refusal);
  const run = Run.create({
    reservations,
    spawn: spawned.spawn,
    env: PARENT,
    serverUrl: PROXY,
    config: env.config,
    vars: env.vars,
    logger: log.logger,
  });
  return { jobs, reservations, run, spawned, lines: log.lines };
};

describe("an automation client's run", () => {
  it("a drive runs the driver and a diagnose opencode, each with the client's variables; each answers ended once it exits 0 and lets its job go (happy)", async () => {
    const at = await running();
    jarl.unwrap(await at.reservations.reserve(DRIVE));
    jarl.unwrap(await at.reservations.reserve(DIAGNOSE));

    const drive = at.run({ jobId: JOB });
    const diagnose = at.run({ jobId: OTHER, prompt: PROMPT });

    expect(at.spawned.calls).toEqual([
      [DRIVER, ["--job-id", JOB, "--server-url", PROXY], { stdio: STDIO, env: CHILD_ENV }],
      [
        "opencode",
        [
          "run",
          "--auto",
          "--model",
          "openrouter/test/diagnose",
          "--variant",
          "medium",
          "--",
          PROMPT,
        ],
        {
          stdio: STDIO,
          cwd: `${Env.ROOT}v2`,
          env: { ...CHILD_ENV, OPENCODE_CONFIG_CONTENT: OPENCODE_CONFIG },
        },
      ],
    ]);
    expect(await settled(drive)).toBe(false);
    expect(at.jobs.count()).toBe(2);
    at.spawned.child(0).end(0);
    at.spawned.child(1).end(0);
    expect(await drive).toEqual(jarl.ok("ended"));
    expect(await diagnose).toEqual(jarl.ok("ended"));
    expect(at.jobs.count()).toBe(0);
    expect(at.lines).toEqual([
      `[INFO] [${JOB}] automation-client: starting driver for a drive`,
      `[INFO] [${OTHER}] automation-client: starting opencode for a diagnose`,
      `[INFO] [${JOB}] automation-client: driver exited 0`,
      `[INFO] [${OTHER}] automation-client: opencode exited 0`,
    ]);
  });

  it("a job with no reservation is RunFailed, spawns nothing and says nothing (unhappy)", async () => {
    const at = await running();

    const ran = await at.run({ jobId: JOB });

    expect(jarl.error.is(ran, RunFailed)).toBe(true);
    expect(jarl.is_err(ran) && ran.error.message).toBe(`job ${JOB} has no reservation`);
    expect(at.spawned.calls).toEqual([]);
    expect(at.lines).toEqual([]);
  });

  it("a diagnose without its prompt is RunFailed, spawns nothing and lets its job go (unhappy)", async () => {
    const at = await running();
    jarl.unwrap(await at.reservations.reserve(DIAGNOSE));

    const ran = await at.run({ jobId: OTHER });

    expect(jarl.error.is(ran, RunFailed)).toBe(true);
    expect(jarl.is_err(ran) && ran.error.message).toBe(
      `job ${OTHER} is a diagnose, which needs its prompt`,
    );
    expect(at.spawned.calls).toEqual([]);
    expect(at.jobs.count()).toBe(0);
  });

  it("a child that exits other than 0 is RunFailed with its stderr's trimmed tail, NUL dropped, or its exit when it said nothing; each lets its job go and logs only how it exited (unhappy)", async () => {
    const at = await running();
    jarl.unwrap(await at.reservations.reserve(DRIVE));
    const tailed = at.run({ jobId: JOB });
    at.spawned.child(0).write("a".repeat(5_000));
    at.spawned.child(0).write("\u0000OpenRouterUnreachable\n  ");
    at.spawned.child(0).end(1);
    const withTail = await tailed;
    jarl.unwrap(await at.reservations.reserve(DIAGNOSE));
    const silent = at.run({ jobId: OTHER, prompt: PROMPT });
    at.spawned.child(1).end(2);
    const withCode = await silent;
    jarl.unwrap(await at.reservations.reserve(DRIVE));
    const signalled = at.run({ jobId: JOB });
    at.spawned.child(2).end(null, "SIGSEGV");
    const withSignal = await signalled;

    expect([withTail, withCode, withSignal].map((ran) => jarl.error.is(ran, RunFailed))).toEqual([
      true,
      true,
      true,
    ]);
    expect(jarl.is_err(withTail) && withTail.error.message).toBe(
      `${"a".repeat(4_072)}OpenRouterUnreachable`,
    );
    expect(jarl.is_err(withCode) && withCode.error.message).toBe("opencode exited 2");
    expect(jarl.is_err(withSignal) && withSignal.error.message).toBe("driver exited SIGSEGV");
    expect(at.jobs.count()).toBe(0);
    expect(at.lines).toEqual([
      `[INFO] [${JOB}] automation-client: starting driver for a drive`,
      `[INFO] [${JOB}] automation-client: driver exited 1`,
      `[INFO] [${OTHER}] automation-client: starting opencode for a diagnose`,
      `[INFO] [${OTHER}] automation-client: opencode exited 2`,
      `[INFO] [${JOB}] automation-client: starting driver for a drive`,
      `[INFO] [${JOB}] automation-client: driver exited SIGSEGV`,
    ]);
  });

  it("a child that cannot start, whether its spawn errors or throws, is RunFailed naming the program and why, and lets its job go (unhappy)", async () => {
    const errored = await running();
    jarl.unwrap(await errored.reservations.reserve(DRIVE));
    const ran = errored.run({ jobId: JOB });
    errored.spawned.child(0).fail(new Error(`spawn ${DRIVER} ENOENT`));
    const failed = await ran;
    const refusal = new TypeError("The argument 'args[7]' must be a string without null bytes.");
    const threw = await running(refusal);
    jarl.unwrap(await threw.reservations.reserve(DIAGNOSE));
    const refused = await threw.run({ jobId: OTHER, prompt: "diagnose\u0000the job" });

    expect(jarl.error.is(failed, RunFailed)).toBe(true);
    expect(jarl.is_err(failed) && failed.error.message).toBe(
      `could not start driver: spawn ${DRIVER} ENOENT`,
    );
    expect(errored.jobs.count()).toBe(0);
    expect(errored.spawned.child(0).signals).toEqual([]);
    expect(errored.lines).toEqual([
      `[INFO] [${JOB}] automation-client: starting driver for a drive`,
      `[INFO] [${JOB}] automation-client: driver could not start`,
    ]);
    expect(jarl.error.is(refused, RunFailed)).toBe(true);
    expect(jarl.is_err(refused) && refused.error.message).toBe(
      `could not start opencode: ${refusal.message}`,
    );
    expect(threw.jobs.count()).toBe(0);
  });

  it("an abort sends SIGTERM, SIGKILL after the kill grace, and answers aborted only once the child has exited, when the abort is stopped (unhappy)", async () => {
    const at = await running();
    jarl.unwrap(await at.reservations.reserve(DRIVE));
    const ran = at.run({ jobId: JOB });
    const child = at.spawned.child(0);

    const aborting = at.jobs.abort({ jobId: JOB });

    expect(child.signals).toEqual(["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS - 1);
    expect(child.signals).toEqual(["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(await settled(ran)).toBe(false);
    expect(await settled(aborting)).toBe(false);
    expect(at.jobs.count()).toBe(1);
    child.end(null, "SIGKILL");
    expect(await ran).toEqual(jarl.ok("aborted"));
    expect(await aborting).toBe("stopped");
    expect(at.jobs.count()).toBe(0);
    expect(at.lines.at(-1)).toBe(`[INFO] [${JOB}] automation-client: driver exited SIGKILL`);
  });

  it("an abort that lands once the child has exited kills nothing, and the run answers as the child ended (unhappy)", async () => {
    const at = await running();
    jarl.unwrap(await at.reservations.reserve(DRIVE));
    const ran = at.run({ jobId: JOB });
    const child = at.spawned.child(0);
    child.exit(0);

    const aborting = at.jobs.abort({ jobId: JOB });
    child.close();

    expect(await ran).toEqual(jarl.ok("ended"));
    expect(await aborting).toBe("stopped");
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS);
    expect(child.signals).toEqual([]);
  });

  it("a child still running at its ceiling is killed and RunTimedOut naming the ceiling: opencode at its run ceiling, the driver at its own plus its grace; each lets its job go (unhappy)", async () => {
    const at = await running();
    jarl.unwrap(await at.reservations.reserve(DRIVE));
    jarl.unwrap(await at.reservations.reserve(DIAGNOSE));
    const drive = at.run({ jobId: JOB });
    const diagnose = at.run({ jobId: OTHER, prompt: PROMPT });
    const driver = at.spawned.child(0);
    const opencode = at.spawned.child(1);

    await vi.advanceTimersByTimeAsync(CEILING_MS - 1);
    expect(opencode.signals).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(opencode.signals).toEqual(["SIGTERM"]);
    opencode.end(null, "SIGTERM");
    const killedOpencode = await diagnose;
    expect(at.jobs.count()).toBe(1);
    await vi.advanceTimersByTimeAsync(DRIVER_CEILING_MS - CEILING_MS - 1);
    expect(driver.signals).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(driver.signals).toEqual(["SIGTERM"]);
    driver.end(1);
    const killedDriver = await drive;

    expect(jarl.error.is(killedOpencode, RunTimedOut)).toBe(true);
    expect(jarl.is_err(killedOpencode) && killedOpencode.error.message).toBe(
      `opencode exceeded its ceiling of ${String(CEILING_MS)} ms`,
    );
    expect(jarl.error.is(killedDriver, RunTimedOut)).toBe(true);
    expect(jarl.is_err(killedDriver) && killedDriver.error.message).toBe(
      `driver exceeded its ceiling of ${String(DRIVER_CEILING_MS)} ms`,
    );
    expect(opencode.signals).toEqual(["SIGTERM"]);
    expect(at.jobs.count()).toBe(0);
  });

  it("a driver that exits 124 stopped at its run ceiling and is RunTimedOut; opencode exiting 124 is only RunFailed; each lets its job go (unhappy)", async () => {
    const at = await running();
    jarl.unwrap(await at.reservations.reserve(DRIVE));
    jarl.unwrap(await at.reservations.reserve(DIAGNOSE));
    const drive = at.run({ jobId: JOB });
    const diagnose = at.run({ jobId: OTHER, prompt: PROMPT });

    at.spawned.child(0).end(TIMED_OUT);
    at.spawned.child(1).end(TIMED_OUT);

    const timedOut = await drive;
    expect(jarl.error.is(timedOut, RunTimedOut)).toBe(true);
    expect(jarl.is_err(timedOut) && timedOut.error.message).toBe(
      `driver timed out: run ceiling of ${String(DRIVER_RUN_CEILING_MS)} ms`,
    );
    const failed = await diagnose;
    expect(jarl.error.is(failed, RunFailed)).toBe(true);
    expect(jarl.is_err(failed) && failed.error.message).toBe("opencode exited 124");
    expect(at.jobs.count()).toBe(0);
  });

  it("a child that exits while something it started still holds its stderr answers the stderr grace later with the tail so far (unhappy)", async () => {
    const at = await running();
    jarl.unwrap(await at.reservations.reserve(DIAGNOSE));
    const ran = at.run({ jobId: OTHER, prompt: PROMPT });
    const child = at.spawned.child(0);
    child.write("provider quota exhausted\n");

    child.exit(1);

    await vi.advanceTimersByTimeAsync(STDERR_GRACE_MS - 1);
    expect(await settled(ran)).toBe(false);
    expect(at.jobs.count()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const failed = await ran;
    expect(jarl.is_err(failed) && failed.error.message).toBe("provider quota exhausted");
    expect(at.jobs.count()).toBe(0);
  });
});
