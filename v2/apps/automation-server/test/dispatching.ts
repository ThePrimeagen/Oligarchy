import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as Async from "@oligarchy/async";
import * as ClientRoutes from "@oligarchy/automation-client/routes";
import * as FakeSessions from "@oligarchy/automation-client/testing";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as Fake from "@oligarchy/http/testing";
import * as FakeLogger from "@oligarchy/logger/testing";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as Abort from "../src/abort.ts";
import * as Dispatch from "../src/dispatch.ts";

export const TOKEN = "oligarchy-s3cret";
export const FIRST = "http://10.0.0.7:4100";
export const SECOND = "http://10.0.0.8:4100";
// A client that never answers: its reserve ends only when the dispatcher's signal aborts.
export const HANGING = "http://10.0.0.9:4100";
// A live client no request reaches.
export const UNREACHABLE = "http://10.0.0.10:4100";
export const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
export const PROXY = "http://127.0.0.1:42069";
export const QEMU_SERVER = "http://10.0.0.5:4000";
// A model of each action's own, so a test run's model says which action started it.
export const MODELS = { drive: "test/drive", diagnose: "test/diagnose", setup: "test/setup" };
const STATS = {
  qemus: 0,
  memory: { totalBytes: 1, usedBytes: 0 },
  cpu: { mean1m: 0, mean2m: 0, mean3m: 0 },
};

const repositoryConfig: unknown = JSON.parse(readFileSync(Env.CONFIG_PATH, "utf8"));
const CONFIG = JSON.stringify(Object.assign({}, repositoryConfig, { models: MODELS }));

const cleanups: Array<() => Promise<unknown>> = [];

// Each test file runs this after each test.
export const cleanUp = async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
};

export type Told = Readonly<Record<string, Partial<ClientRoutes.Sessions>>>;

// A run still under way: it answers only once the dispatcher's signal ends it at the transport.
export const underWay: ClientRoutes.Sessions["run"] = () => new Promise(() => undefined);

// A client whose runs go on until its /abort stops them, as a driver killed at its client does:
// each run then answers aborted, and an abort of a job it is not running answers not-held.
export const stoppable = (): Partial<ClientRoutes.Sessions> => {
  const held = new Map<string, () => void>();
  return {
    run: ({ jobId }) =>
      new Promise((resolve) => {
        held.set(jobId, () => resolve(jarl.ok("aborted")));
      }),
    abort: async ({ jobId }) => {
      const stop = held.get(jobId);
      if (stop === undefined) {
        return "not-held";
      }
      held.delete(jobId);
      stop();
      return "stopped";
    },
  };
};

// Answers only once released, as a driver that runs until the test lets it end.
export const gate = () => {
  let release: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
};

const aborted = (signal: AbortSignal): Promise<"hang"> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve("hang");
      return;
    }
    signal.addEventListener("abort", () => resolve("hang"), { once: true });
  });

// A migrated database of the test's own with the stores over it, and an automation client at each
// url of told: its own routes behind the fake transport, over sessions answering as told, with a run
// still under way unless told otherwise. Only the urls announced with live() are clients the
// dispatcher can find. A request in flight ends when the dispatcher's signal aborts, as fetch's does.
// seen is the tests store as the dispatcher sees it, so a test can hold one of its calls.
export const dispatching = async (
  told: Told | ((tests: Stores.Tests.Tests) => Told) = {},
  seen: (tests: Stores.Tests.Tests) => Stores.Tests.Tests = (tests) => tests,
) => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const env = jarl.unwrap(
    await Env.create(
      Env.cli({ name: "dispatch-test", description: "" }).needs("databaseUrl").done(),
      Env.fakeIo({ env: { DATABASE_URL: fake.url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  );
  const db = Db.create({}, { url: env.vars.databaseUrl });
  cleanups.push(() => db.close());
  const tests = Stores.Tests.create({ db });
  const servers = Stores.Servers.create({ db });
  const setupRequests = Stores.SetupRequests.create({ db });
  const diagnosis = Stores.Diagnosis.create({ db });
  const { models } = env.config;
  const shutdown = new AbortController();

  const handed: Record<string, ReadonlyArray<unknown>> = {};
  const clients = Object.fromEntries(
    Object.entries(typeof told === "function" ? told(tests) : told).map(([url, sessions]) => {
      const faked = FakeSessions.sessions({ run: underWay, ...sessions });
      handed[url] = faked.handed;
      return [url, ClientRoutes.routes({ token: TOKEN, sessions: faked.sessions })];
    }),
  );
  let enterHangingReserve: () => void = () => undefined;
  const hangingReserveEntered = new Promise<void>((resolve) => {
    enterHangingReserve = resolve;
  });
  const http = Fake.http({
    replies: (asked) => {
      if (new URL(asked.url).origin === HANGING) {
        enterHangingReserve();
        return "hang";
      }
      const routes = clients[new URL(asked.url).origin];
      if (routes === undefined) {
        return "unreachable";
      }
      return Promise.race([
        routes.fetch(
          new Request(asked.url, {
            method: asked.method,
            headers: asked.headers,
            body: JSON.stringify(asked.body),
          }),
        ),
        aborted(shutdown.signal),
      ]);
    },
  });
  const log = FakeLogger.logger();
  const aborting: Abort.Aborting = new Set();
  const dispatcher = Dispatch.create({
    http: http.http,
    token: { reveal: () => TOKEN },
    tests: seen(tests),
    servers,
    setupRequests,
    diagnosis,
    logger: log.logger,
    models,
    aborting,
    signal: shutdown.signal,
  });
  const aborter = Abort.create(
    { http: http.http, tests: seen(tests), servers, logger: log.logger },
    { token: { reveal: () => TOKEN }, aborting },
  );
  // As the app's signal aborts when the server stops.
  const stop = () => shutdown.abort(new Async.Aborted("parent stopped"));
  cleanups.push(async () => {
    stop();
    await aborter.settled();
    await dispatcher.waitForRuns();
  });

  const live = async (...urls: ReadonlyArray<string>) => {
    for (const url of urls) {
      jarl.unwrap(await servers.heartbeat(url, "automation-client", url, STATS));
    }
  };
  const clientId = async (url: string) =>
    jarl.unwrap(await servers.listLiveServers("automation-client")).find((one) => one.url === url)
      ?.id;
  // A filed drive moved to running on a client id, and its test run started, as dispatch leaves
  // it once /run is sent.
  const runOn = async (job: Stores.Tests.JobRow, serverId: string) => {
    jarl.unwrap(await tests.runJob(job.id, serverId));
    jarl.unwrap(await tests.startRun(job.runId, models.drive));
  };
  const define = async (name: string, resume = true) =>
    jarl.unwrap(
      await tests.defineTestDefinition({
        name,
        description: "",
        instruction: "",
        proof: "",
        resume,
      }),
    ).id;
  const drive = async (resume = true) =>
    jarl.unwrap(
      await tests.createTestRun({
        definitionId: await define(resume ? "lock-screen" : "first-boot", resume),
        iso: ISO,
        serverUrl: PROXY,
      }),
    );
  const setup = async () => {
    jarl.unwrap(await setupRequests.insert(ISO, QEMU_SERVER));
    return jarl.unwrap(
      await tests.createTestRun({
        definitionId: await define("setup"),
        iso: ISO,
        serverUrl: PROXY,
        setupServer: QEMU_SERVER,
      }),
    ).job;
  };
  // A diagnose on a test run whose drive ran and completed: that drive is the one it judges.
  const diagnose = async () => {
    const filed = await drive();
    jarl.unwrap(await tests.runJob(filed.job.id, randomUUID()));
    jarl.unwrap(await tests.startRun(filed.run.id, models.drive));
    const judged = jarl.unwrap(await tests.completeJob(filed.job.id));
    return { job: jarl.unwrap(await tests.createJob(filed.run.id, "diagnose")), judged };
  };
  // A suite of count runs of one drive definition, each with its pending drive.
  const suite = async (count: number) => {
    const definitionId = await define("lock-screen");
    return jarl.unwrap(
      await tests.createTestSuite({
        iso: ISO,
        serverUrl: PROXY,
        definitionIds: Array.from({ length: count }, () => definitionId),
      }),
    );
  };
  const job = async (jobId: string) => {
    const { status, reason } = jarl.unwrap(await tests.getJob(jobId));
    return { status, reason };
  };
  const run = async (runId: string) => {
    const { status, reason, model } = jarl.unwrap(await tests.getTestRun(runId));
    return { status, reason, model };
  };
  const asked = () => http.asked.map((one) => [one.url, one.body]);
  // Each request to path, as [the client's url, its body].
  const posted = (path: string) =>
    http.asked
      .filter((one) => new URL(one.url).pathname === path)
      .map((one) => [new URL(one.url).origin, one.body]);

  return {
    fake,
    tests,
    setupRequests,
    diagnosis,
    dispatcher,
    aborter,
    hangingReserveEntered,
    stop,
    live,
    clientId,
    runOn,
    drive,
    setup,
    diagnose,
    suite,
    job,
    run,
    asked,
    posted,
    handed,
    said: log.said,
  };
};

export const errors = (said: ReadonlyArray<FakeLogger.Said>) =>
  said.filter((one) => one.level === "error").map((one) => one.text);
