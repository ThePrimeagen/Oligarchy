import { readFileSync } from "node:fs";
import * as ClientRoutes from "@oligarchy/automation-client/routes";
import * as FakeSessions from "@oligarchy/automation-client/testing";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as Fake from "@oligarchy/http/testing";
import * as FakeLogger from "@oligarchy/logger/testing";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, describe, expect, it } from "vitest";
import * as Dispatch from "../src/dispatch.ts";

const TOKEN = "oligarchy-s3cret";
const FIRST = "http://10.0.0.7:4100";
const SECOND = "http://10.0.0.8:4100";
const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
const PROXY = "http://127.0.0.1:42069";
const QEMU_SERVER = "http://10.0.0.5:4000";
const STATS = {
  qemus: 0,
  memory: { totalBytes: 1, usedBytes: 0 },
  cpu: { mean1m: 0, mean2m: 0, mean3m: 0 },
};

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

type Told = Readonly<Record<string, Partial<ClientRoutes.Sessions>>>;

// A migrated database of the test's own with the stores over it, and an automation client at each
// url of told: its own routes behind the fake transport, over sessions answering as told. Only the
// urls announced with live() are clients the pass can find.
const dispatching = async (told: Told | ((tests: Stores.Tests.Tests) => Told) = {}) => {
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

  const handed: Record<string, ReadonlyArray<unknown>> = {};
  const clients = Object.fromEntries(
    Object.entries(typeof told === "function" ? told(tests) : told).map(([url, sessions]) => {
      const faked = FakeSessions.sessions(sessions);
      handed[url] = faked.handed;
      return [url, ClientRoutes.routes({ token: TOKEN, sessions: faked.sessions })];
    }),
  );
  const http = Fake.http({
    replies: (asked) => {
      const routes = clients[new URL(asked.url).origin];
      if (routes === undefined) {
        return "unreachable";
      }
      return routes.fetch(
        new Request(asked.url, {
          method: asked.method,
          headers: asked.headers,
          body: JSON.stringify(asked.body),
        }),
      );
    },
  });
  const log = FakeLogger.logger();
  const dispatch = Dispatch.create({
    http: http.http,
    token: { reveal: () => TOKEN },
    tests,
    servers,
    setupRequests,
    logger: log.logger,
  });

  const live = async (...urls: ReadonlyArray<string>) => {
    for (const url of urls) {
      jarl.unwrap(await servers.heartbeat(url, "automation-client", url, STATS));
    }
  };
  const clientId = async (url: string) =>
    jarl.unwrap(await servers.listLiveServers("automation-client")).find((one) => one.url === url)
      ?.id;
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
  // A diagnose on a test run whose drive was aborted to make way for it.
  const diagnose = async () => {
    const filed = await drive();
    jarl.unwrap(await tests.abortJob(filed.job.id, "making way"));
    return jarl.unwrap(await tests.createJob(filed.run.id, "diagnose"));
  };
  const job = async (jobId: string) => jarl.unwrap(await tests.getJob(jobId));
  const asked = () => http.asked.map((one) => [one.url, one.body]);

  return {
    fake,
    tests,
    setupRequests,
    dispatch,
    live,
    clientId,
    drive,
    setup,
    diagnose,
    job,
    asked,
    handed,
    said: log.said,
  };
};

const errors = (said: ReadonlyArray<FakeLogger.Said>) =>
  said.filter((one) => one.level === "error").map((one) => one.text);

describe("a dispatch pass", () => {
  it("reserves each pending job in queue order on the live clients round robin, a drive resuming its ISO only when its definition resumes and a setup on its lock's server, moves it to running naming the client that took it, and with nothing left says to wait (happy)", async () => {
    const at = await dispatching({ [FIRST]: {}, [SECOND]: {} });
    await at.live(FIRST, SECOND);
    const setup = await at.setup();
    const diagnose = await at.diagnose();
    const resumed = (await at.drive(true)).job;
    const fresh = (await at.drive(false)).job;

    const passes = [];
    for (let pass = 0; pass < 5; pass += 1) {
      passes.push(await at.dispatch.pass());
    }

    expect(passes).toEqual([true, true, true, true, false]);
    expect(at.handed[FIRST]).toEqual([
      { jobId: setup.id, action: "setup", setupServer: QEMU_SERVER },
      { jobId: resumed.id, action: "drive", resume: ISO },
    ]);
    expect(at.handed[SECOND]).toEqual([
      { jobId: diagnose.id, action: "diagnose" },
      { jobId: fresh.id, action: "drive" },
    ]);
    const first = await at.clientId(FIRST);
    const second = await at.clientId(SECOND);
    const placed = [];
    for (const one of [setup, diagnose, resumed, fresh]) {
      const { status, serverId } = await at.job(one.id);
      placed.push({ status, serverId });
    }
    expect(placed).toEqual([
      { status: "running", serverId: first },
      { status: "running", serverId: second },
      { status: "running", serverId: first },
      { status: "running", serverId: second },
    ]);
    expect(errors(at.said)).toEqual([]);
  });

  it("with no live client asks nothing, leaves the job pending and says to wait (unhappy)", async () => {
    const at = await dispatching({ [FIRST]: {} });
    const { job } = await at.drive();

    expect(await at.dispatch.pass()).toBe(false);

    expect(at.asked()).toEqual([]);
    expect((await at.job(job.id)).status).toBe("pending");
    expect(errors(at.said)).toEqual([]);
  });

  it("with every client at capacity or needing a setup leaves the job pending, says nothing went wrong and says to wait (unhappy)", async () => {
    const at = await dispatching({
      [FIRST]: {
        reserve: async () => jarl.err(new ClientRoutes.AtCapacity("at capacity: max-jobs is 1")),
      },
      [SECOND]: {
        reserve: async () => jarl.err(new ClientRoutes.SetupNeeded("setup needed: 4.0.4")),
      },
    });
    await at.live(FIRST, SECOND);
    const { job } = await at.drive();

    expect(await at.dispatch.pass()).toBe(false);

    expect(at.handed[FIRST]).toHaveLength(1);
    expect(at.handed[SECOND]).toHaveLength(1);
    expect((await at.job(job.id)).status).toBe("pending");
    expect(errors(at.said)).toEqual([]);
  });

  it("a reserve that fails at one client is an error line naming it under the job, and the next client is asked and takes the job (unhappy)", async () => {
    const at = await dispatching({
      [FIRST]: {
        reserve: async () => jarl.err(new ClientRoutes.ReserveFailed("reserving a guest failed")),
      },
      [SECOND]: {},
    });
    await at.live(FIRST, SECOND);
    const { job } = await at.drive();

    expect(await at.dispatch.pass()).toBe(true);

    const failed = at.said.filter((one) => one.level === "error");
    expect(failed.map((one) => one.text)).toEqual([
      `reserve failed; ${FIRST}: POST ${FIRST}/reserve: 500: {"error":"reserving a guest failed"}`,
    ]);
    expect(failed[0]?.report.agentId).toBe(job.id);
    const { status, serverId } = await at.job(job.id);
    expect({ status, serverId }).toEqual({
      status: "running",
      serverId: await at.clientId(SECOND),
    });
  });

  it("a client that cannot be reached is an error line naming it, and the job stays pending (unhappy)", async () => {
    const at = await dispatching();
    await at.live(FIRST);
    const { job } = await at.drive();

    expect(await at.dispatch.pass()).toBe(false);

    expect(errors(at.said)).toEqual([
      `reserve failed; ${FIRST}: POST ${FIRST}/reserve: fetch failed`,
    ]);
    expect((await at.job(job.id)).status).toBe("pending");
  });

  it("a job that left pending while its client reserved it is given back at that client with /abort, an error line says why, and the pass says to wait (unhappy)", async () => {
    const at = await dispatching((tests) => ({
      [FIRST]: {
        reserve: async (request) => {
          jarl.unwrap(await tests.abortJob(request.jobId, "an operator aborted it"));
          return jarl.ok(undefined);
        },
      },
    }));
    await at.live(FIRST);
    const { job } = await at.drive();

    expect(await at.dispatch.pass()).toBe(false);

    expect(at.handed[FIRST]).toEqual([
      { jobId: job.id, action: "drive", resume: ISO },
      { jobId: job.id },
    ]);
    expect(errors(at.said)).toEqual([
      `running write failed; ${FIRST}: runJob: job ${job.id} is aborted drive; needs pending`,
    ]);
    expect((await at.job(job.id)).status).toBe("aborted");
  });

  it("a setup whose lock is gone can never be reserved: it is errored saying so, nothing is asked, and the pass asks again (unhappy)", async () => {
    const at = await dispatching({ [FIRST]: {} });
    await at.live(FIRST);
    const setup = await at.setup();
    jarl.unwrap(await at.setupRequests.removeServer(QEMU_SERVER));

    expect(await at.dispatch.pass()).toBe(true);

    const { status, reason } = await at.job(setup.id);
    expect({ status, reason }).toEqual({
      status: "errored",
      reason: "no setup lock names this setup's server",
    });
    expect(at.asked()).toEqual([]);
  });

  it("with the database gone is an error line, asks no client, and says to wait (unhappy)", async () => {
    const at = await dispatching({ [FIRST]: {} });
    await at.live(FIRST);
    await at.drive();
    await at.fake.stop();

    expect(await at.dispatch.pass()).toBe(false);

    const failed = errors(at.said);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatch(/^dispatch failed: .*ECONNREFUSED/);
    expect(at.asked()).toEqual([]);
  });
});
