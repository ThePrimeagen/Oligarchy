import * as FakeSentry from "@oligarchy/sentry/testing";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as Pg from "@oligarchy/fake-postgres";
import * as Http from "@oligarchy/http";
import * as Logger from "@oligarchy/logger/testing";
import * as Q from "@oligarchy/qemu";
import * as FakeQ from "@oligarchy/qemu/testing";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { expect, it, vi } from "vitest";
import { routes as runnerRoutes } from "../../qemu-runner/src/routes.ts";
import * as Guests from "../../qemu-runner/src/guests.ts";
import * as Router from "../src/router.ts";
import { routes } from "../src/routes.ts";
import configFile from "../../../oligarchy.json";
it("a setup publishes disks, a drive resumes them, and diagnosis can read both jobs' evidence", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const database = jarl.unwrap(await Pg.start());
  let db: AppDb | undefined;
  try {
    const env = jarl.unwrap(
      await Env.create(
        Env.cli({ name: "flow", description: "" }).needs("databaseUrl").done(),
        Env.fakeIo({
          env: { DATABASE_URL: database.url },
          files: { [Env.CONFIG_PATH]: JSON.stringify(configFile) },
        }),
      ),
    );
    db = Db.create({}, { url: env.vars.databaseUrl });
    const tests = Stores.Tests.create({ db }),
      servers = Stores.Servers.create({ db }),
      setupRequests = Stores.SetupRequests.create({ db });
    const actions = Stores.Actions.create({ db }),
      vmStatus = Stores.VmStatus.create({ db }),
      debugLogs = Stores.DebugLogs.create({ db });
    const logger = Logger.logger().logger;
    const boots: Q.Qemu.Boot[] = [];
    let shutdown!: (end: Q.Qemu.End) => void;
    let saved: Q.Qemu.Pair | undefined;
    const qemu = FakeQ.qemu({
      boot: async (input) => {
        boots.push(input);
        const end = new Promise<Q.Qemu.End>((resolve) => {
          shutdown = resolve;
        });
        return jarl.ok({
          disk: "/disk",
          vars: "/vars",
          end,
          image: async () => jarl.ok(new Uint8Array([137, 80, 78, 71])),
          keys: async (_keys, _signal, record) => {
            const opened = await record({ execute: "send-key", arguments: {} });
            return jarl.is_err(opened)
              ? opened
              : jarl.value(opened)({ state: "completed", response: {} });
          },
          mouse: async () => jarl.ok(undefined),
          powerdown: async () => jarl.ok(undefined),
          capture: async () => jarl.ok({ serial: "guest console", qemu: "qemu stderr" }),
          stop: async () => {
            shutdown({ status: "stopped" });
            return jarl.ok(undefined);
          },
          dispose: async () => jarl.ok(undefined),
        });
      },
    });
    const iso = FakeQ.iso({ get: async () => jarl.ok("/iso") });
    const setupDisks = FakeQ.setupDisks({
      find: async () => jarl.ok(saved),
      save: async (_iso, pair) => {
        saved = pair;
        return jarl.ok(undefined);
      },
    });
    const guestServices = {
      tests,
      servers,
      setupRequests,
      actions,
      vmStatus,
      debugLogs,
      logger,
      qemu,
      iso,
      setupDisks,
      sentry: FakeSentry.sentry().sentry,
    };
    const guests = Guests.create(guestServices, { maxJobs: 1, config: env.config.qemuRunner });
    const runner = runnerRoutes({ token: "token", handle: guests.handle });
    const http = Http.create(
      {},
      { timeoutMs: env.config.httpTimeout, fetch: async (url, init) => runner.request(url, init) },
    );
    const services = { ...guestServices, http };
    const router = Router.create(services, {
      token: { reveal: () => "token" },
      url: "http://proxy",
      config: env.config,
    });
    const proxy = routes({
      token: "token",
      handle: router.handle,
      register: router.register,
      servers,
    });
    const post = async (path: string, body: unknown) => {
      const response = await proxy.request(`http://proxy/${path}`, {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await response.arrayBuffer();
      return response;
    };
    await servers.addServer("http://runner", "qemu");
    jarl.unwrap(
      await tests.defineTestDefinition({
        name: "setup",
        description: "",
        instruction: "",
        proof: "",
        resume: false,
      }),
    );
    const definition = jarl.unwrap(
      await tests.defineTestDefinition({
        name: "drive",
        description: "",
        instruction: "",
        proof: "",
        resume: true,
      }),
    );
    const setup = jarl.unwrap(
      await tests.ensureSetup({
        iso: "test.iso",
        serverUrl: "http://proxy",
        setupServer: "http://runner",
      }),
    )!;
    expect(
      (await post("reserve", { job: setup.job.id, setupServer: "http://runner" })).status,
    ).toBe(200);
    expect(
      (await post("start", { job: setup.job.id, iso: "test.iso", mode: "fresh" })).status,
    ).toBe(200);
    const image = await proxy.request(`http://proxy/image?job=${setup.job.id}`, {
      headers: { authorization: "Bearer token" },
    });
    await image.arrayBuffer();
    shutdown({ status: "shutdown" });
    expect((await post("save", { job: setup.job.id })).status).toBe(200);
    expect((await post("stop", { job: setup.job.id, status: "completed" })).status).toBe(200);
    const drive = jarl.unwrap(
      await tests.createTestRun({
        definitionId: definition.id,
        iso: "test.iso",
        serverUrl: "http://proxy",
      }),
    );
    expect((await post("reserve", { job: drive.job.id, resume: "test.iso" })).status).toBe(200);
    expect(
      (await post("start", { job: drive.job.id, iso: "test.iso", mode: "resume" })).status,
    ).toBe(200);
    expect(boots[1]?.base).toEqual(saved);
    expect((await post("send-keys", { job: drive.job.id, keys: "hi" })).status).toBe(200);
    expect((await post("stop", { job: drive.job.id, status: "completed" })).status).toBe(200);
    expect(jarl.unwrap(await actions.listImages(setup.job.id))).toHaveLength(1);
    expect(jarl.unwrap(await actions.listActions(drive.job.id))).toHaveLength(1);
    expect(jarl.unwrap(await debugLogs.getDebugLog(setup.job.id))?.sources.serial).toBe(
      "guest console",
    );
    expect(jarl.unwrap(await debugLogs.getDebugLog(drive.job.id))?.sources.qemu).toBe(
      "qemu stderr",
    );
    expect(jarl.unwrap(await vmStatus.current(setup.job.id))?.status).toBe("shutdown");
    expect(guests.counts().jobs).toBe(0);
    await guests.shutdown();
    await router.shutdown();
  } finally {
    await db?.close();
    await database.stop();
    vi.useRealTimers();
  }
}, 30000);
type AppDb = ReturnType<typeof Db.create>;
