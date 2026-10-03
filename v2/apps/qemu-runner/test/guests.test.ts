import * as FakeSentry from "@oligarchy/sentry/testing";
import * as Async from "@oligarchy/async";
import * as Env from "@oligarchy/env";
import * as Db from "@oligarchy/db";
import * as Q from "@oligarchy/qemu";
import * as FakeQ from "@oligarchy/qemu/testing";
import * as Fake from "@oligarchy/stores/testing";
import * as Stores from "@oligarchy/stores";
import * as Logger from "@oligarchy/logger/testing";
import * as jarl from "jarl";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as Guests from "../src/guests.ts";
import configFile from "../../../oligarchy.json";
const JOB = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const never = new AbortController().signal;
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const setup = async (
  overrides: {
    boot?: Q.Qemu.Qemu["boot"];
    get?: Q.Iso.Iso["get"];
    actionError?: boolean;
    disk?: boolean;
    stopError?: boolean;
    save?: Q.SetupDisks.SetupDisks["save"];
  } = {},
) => {
  const env = jarl.unwrap(
    await Env.create(
      Env.cli({ name: "test", description: "" }).done(),
      Env.fakeIo({ files: { [Env.CONFIG_PATH]: JSON.stringify(configFile) } }),
    ),
  );
  const events: string[] = [];
  let end!: (end: Q.Qemu.End) => void;
  const guest: Q.Qemu.Guest = {
    disk: "/disk",
    vars: "/vars",
    end: new Promise((resolve) => {
      end = resolve;
    }),
    image: async () => {
      events.push("image");
      return jarl.ok(new Uint8Array([1, 2]));
    },
    keys: async (_text, _signal, record) => {
      const started = await record({ execute: "send-key", arguments: {} });
      if (jarl.is_err(started)) return started;
      events.push("keys");
      return jarl.value(started)({ state: "completed", response: {} });
    },
    mouse: async () => jarl.ok(undefined),
    powerdown: async () => jarl.ok(undefined),
    capture: async () => {
      events.push("capture");
      return jarl.ok({ serial: "serial", qemu: "stderr" });
    },
    stop: async () => {
      events.push("stop");
      if (overrides.stopError) return jarl.err(new Q.QemuFailed("cannot stop"));
      end({ status: "stopped" });
      return jarl.ok(undefined);
    },
    dispose: async () => {
      events.push("dispose");
      return jarl.ok(undefined);
    },
  };
  const details: Stores.Tests.JobDetails = {
    job: {
      id: JOB,
      action: "setup",
      runId: OTHER,
      status: "running",
      reason: null,
      serverId: null,
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: null,
    },
    run: {
      id: OTHER,
      iso: "test.iso",
      definitionId: 1,
      suiteId: null,
      model: null,
      status: "running",
      reason: null,
      createdAt: new Date(),
      finishedAt: null,
      serverUrl: "http://proxy",
    },
    suite: null,
    definition: {
      id: 1,
      name: "setup",
      description: "",
      instruction: "",
      proof: "",
      resume: false,
      createdAt: new Date(),
    },
  };
  const log = Logger.logger();
  const services = {
    ...log,
    sentry: FakeSentry.sentry().sentry,
    qemu: FakeQ.qemu({ boot: overrides.boot ?? (async () => jarl.ok(guest)) }),
    iso: FakeQ.iso({ get: overrides.get ?? (async () => jarl.ok("/iso")) }),
    setupDisks: FakeQ.setupDisks({
      find: async () => jarl.ok(overrides.disk ? guest : undefined),
      save:
        overrides.save ??
        (async () => {
          events.push("save");
          return jarl.ok(undefined);
        }),
    }),
    tests: Fake.tests({ getJobDetails: async () => jarl.ok(details) }),
    vmStatus: Fake.vmStatus({
      record: async (_job, state) => {
        events.push(state);
        return jarl.ok(undefined);
      },
      stop: async (_job, terminal) => {
        events.push(`terminal:${terminal.status}`);
        return jarl.ok(undefined);
      },
    }),
    actions: Fake.actions({
      startAction: async () =>
        overrides.actionError ? jarl.err(new Db.DatabaseError("refused")) : jarl.ok(1),
      finishAction: async (_id, _outcome, image) => {
        events.push(image ? "image committed" : "action committed");
        return jarl.ok(undefined);
      },
    }),
    debugLogs: Fake.debugLogs({
      saveDebugLog: async () => {
        events.push("debug saved");
        return jarl.ok(undefined);
      },
    }),
  };
  const owner = Guests.create(services, { maxJobs: 1, config: env.config.qemuRunner });
  const reserve = () => owner.handle("reserve", { job: JOB }, never);
  const start = () => owner.handle("start", { job: JOB, iso: "test.iso", mode: "fresh" }, never);
  return {
    owner,
    reserve,
    start,
    events,
    end: (value: Q.Qemu.End) => end(value),
    log,
    services,
    config: env.config,
  };
};
it("owns a setup through shutdown, save and cleanup; evidence precedes disposal", async () => {
  const h = await setup();
  expect((await h.reserve()).status).toBe(200);
  expect((await h.start()).status).toBe(200);
  expect((await h.owner.handle("image", { job: JOB }, never)).status).toBe(200);
  h.end({ status: "shutdown" });
  await vi.advanceTimersByTimeAsync(0);
  expect((await h.owner.handle("save", { job: JOB }, never)).status).toBe(200);
  expect((await h.owner.abort({ job: JOB })).status).toBe(200);
  expect(h.events.filter((e) => e.startsWith("terminal:"))).toEqual(["terminal:shutdown"]);
  expect(h.events.indexOf("debug saved")).toBeLessThan(h.events.indexOf("dispose"));
  expect(h.events).toContain("image committed");
  expect(h.owner.counts().jobs).toBe(0);
});
it("reserves capacity before asynchronous setup lookup", async () => {
  const h = await setup();
  const first = h.reserve();
  expect((await h.owner.handle("reserve", { job: OTHER }, never)).status).toBe(503);
  await first;
  await h.owner.shutdown();
});
it("a missing setup disk holds no capacity", async () => {
  const h = await setup();
  expect((await h.owner.handle("reserve", { job: JOB, resume: "test.iso" }, never)).status).toBe(
    409,
  );
  expect(h.owner.counts().jobs).toBe(0);
});
it("abort interrupts startup during ISO download and waits for cleanup", async () => {
  const h = await setup({
    get: async (_name, signal) => {
      const result = await Async.sleep(10000, signal);
      return jarl.is_err(result) ? result : jarl.ok("/iso");
    },
  });
  await h.reserve();
  const starting = h.start();
  await vi.advanceTimersByTimeAsync(0);
  expect((await h.owner.abort({ job: JOB })).status).toBe(200);
  expect((await starting).status).toBe(502);
  expect(h.owner.counts().jobs).toBe(0);
});
it("a failed boot records the failure and frees the slot", async () => {
  const h = await setup({ boot: async () => jarl.err(new Q.QemuFailed("boot failed")) });
  await h.reserve();
  expect((await h.start()).status).toBe(502);
  expect(h.events).toContain("terminal:server-error");
  expect(h.owner.counts().jobs).toBe(0);
});
it("panic stops the child and preserves panic as the terminal state", async () => {
  const h = await setup();
  await h.reserve();
  await h.start();
  h.end({ status: "panicked" });
  await vi.advanceTimersByTimeAsync(0);
  expect(h.events.filter((e) => e.startsWith("terminal:"))).toEqual(["terminal:panicked"]);
  expect(h.events).toContain("dispose");
});
it("refused action recording prevents sending keys", async () => {
  const h = await setup({ actionError: true });
  await h.reserve();
  await h.start();
  expect((await h.owner.handle("send-keys", { job: JOB, keys: "a" }, never)).status).toBe(502);
  expect(h.events).not.toContain("keys");
  await h.owner.shutdown();
});
it("a failed stop retains capacity and makes shutdown fail", async () => {
  const h = await setup({ stopError: true });
  await h.reserve();
  await h.start();
  expect((await h.owner.abort({ job: JOB })).status).toBe(502);
  expect(h.events).not.toContain("dispose");
  expect(h.owner.counts().jobs).toBe(1);
  expect(jarl.is_err(await h.owner.shutdown())).toBe(true);
});
it("unused reservations expire", async () => {
  const h = await setup();
  await h.reserve();
  await vi.advanceTimersByTimeAsync(h.config.qemuRunner.reservationTimeout);
  await h.owner.sweep();
  expect(h.owner.counts().jobs).toBe(0);
});
it("intent lines carry the job and run, and a second open intent is refused", async () => {
  const h = await setup();
  await h.reserve();
  expect(
    (await h.owner.handle("intent/start", { job: JOB, message: "open settings" }, never)).status,
  ).toBe(200);
  expect((await h.owner.handle("intent/start", { job: JOB, message: "again" }, never)).status).toBe(
    409,
  );
  expect(h.log.said[0]).toMatchObject({
    text: "intent start; open settings",
    report: { jobId: JOB, runId: OTHER },
  });
  await h.owner.shutdown();
});
it("a failed save preserves the powered-off guest for cleanup", async () => {
  const h = await setup({ save: async () => jarl.err(new Q.QemuFailed("disk full")) });
  await h.reserve();
  await h.start();
  h.end({ status: "shutdown" });
  await vi.advanceTimersByTimeAsync(0);
  expect((await h.owner.handle("save", { job: JOB }, never)).status).toBe(502);
  expect(h.events).not.toContain("dispose");
  await h.owner.shutdown();
  expect(h.events).toContain("dispose");
});
