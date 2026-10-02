import * as FakeSentry from "@oligarchy/sentry/testing";
import * as App from "@oligarchy/app";
import * as Env from "@oligarchy/env";
import * as Logger from "@oligarchy/logger/testing";
import * as Q from "@oligarchy/qemu";
import * as Serve from "@oligarchy/http/serve";
import * as jarl from "jarl";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as Application from "../src/application.ts";
import { environment } from "../src/environment.ts";
import * as Db from "@oligarchy/db";
import * as Fleet from "@oligarchy/fleet";
import * as Stores from "@oligarchy/stores";
import * as Fake from "@oligarchy/stores/testing";
import * as FakeQ from "@oligarchy/qemu/testing";
import configFile from "../../../oligarchy.json";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const run = async (failedAt?: string) => {
  const env = jarl.unwrap(
    await Env.create(
      environment,
      Env.fakeIo({
        argv: [
          "--port",
          "4000",
          "--url",
          "http://runner",
          "--name",
          "runner",
          "--max-jobs",
          "1",
          "--display",
          "none",
        ],
        env: { DATABASE_URL: "postgres://unused", OLIGARCHY_TOKEN: "token" },
        files: { [Env.CONFIG_PATH]: JSON.stringify(configFile) },
      }),
    ),
  );
  const order: string[] = [];
  const step =
    <T, E>(name: string, value: T, failure: E) =>
    async () => {
      order.push(name);
      return name === failedAt ? jarl.err(failure) : jarl.ok(value);
    };
  const databaseError = new Db.DatabaseError("recovery failed");
  const services = {
    logger: Logger.logger().logger,
    sentry: FakeSentry.sentry().sentry,
    qemu: FakeQ.qemu({ recover: step("recover", undefined, new Q.QemuFailed("recovery failed")) }),
    iso: FakeQ.iso(),
    setupDisks: FakeQ.setupDisks(),
    tests: Fake.tests({}),
    actions: Fake.actions({}),
    debugLogs: Fake.debugLogs({}),
    vmStatus: Fake.vmStatus({ clearPastRunningVms: step("vm recovery", [], databaseError) }),
    setupRequests: Fake.setupRequests({ removeServer: step("unlock", 0, databaseError) }),
    servers: Fake.servers({
      heartbeat: step("heartbeat", undefined, databaseError),
      removeServer: step("unannounce", true, databaseError),
    }),
    host: App.createService<never, App.NoOptions, Fleet.Host.Host>(() => ({
      service: "host",
      sample: () => {},
      collect: () => ({
        memory: { totalBytes: 1, usedBytes: 0, freeBytes: 1 },
        cpu: { cores: 1, mean: 0, mean1m: 0, mean2m: 0, mean3m: 0, p10: 0, p25: 0, p75: 0, p90: 0 },
      }),
    }))({}),
    usage: App.createService<never, App.NoOptions, Fleet.Usage.Usage>(() => ({
      service: "usage",
      collect: step(
        "usage",
        { memoryBytes: 0, cpuPercent: 0 },
        new Fleet.Usage.UsageUnreadable("stats failed"),
      ),
    }))({}),
    processStats: App.createService<never, App.NoOptions, Stores.ProcessStats.ProcessStats>(() => ({
      service: "processStats",
      listSeries: async () => jarl.ok([]),
      report: step("stats", undefined, databaseError),
    }))({}),
  };
  let signal!: (signal: App.Signal) => void;
  let errors: readonly unknown[] = [];
  const listen: typeof Serve.listen = async () => {
    order.push("listen");
    return failedAt === "listen"
      ? jarl.err(new Serve.ListenFailed("bind failed"))
      : jarl.ok({
          close: async () => {
            order.push("close");
          },
        });
  };
  const app = new App.App(env).main(Application.main({ listen }));
  app.onExit(() => {
    order.push("exit");
  });
  const done = app.run(
    services,
    (failures) => {
      errors = failures;
    },
    {
      onSignal: (callback) => {
        signal = callback;
        return () => {};
      },
      exit: () => {},
      stderr: () => {},
    },
  );
  await vi.advanceTimersByTimeAsync(0);
  if (failedAt === undefined) signal("SIGTERM");
  await done;
  return { order, errors };
};
it("recovers before serving, announces after binding, and unannounces before exit", async () => {
  const { order, errors } = await run();
  expect(errors).toEqual([]);
  expect(order.slice(0, 5)).toEqual(["recover", "vm recovery", "unlock", "listen", "heartbeat"]);
  expect(order.indexOf("close")).toBeLessThan(order.indexOf("exit"));
  expect(order.indexOf("unannounce")).toBeLessThan(order.indexOf("exit"));
});
it.each(["recover", "vm recovery", "unlock", "listen"])(
  "%s failure prevents admission and announcement",
  async (failedAt) => {
    const { order, errors } = await run(failedAt);
    expect(errors).toHaveLength(1);
    expect(order).not.toContain("heartbeat");
    if (failedAt !== "listen") expect(order).not.toContain("listen");
  },
);
