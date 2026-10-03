import * as Db from "@oligarchy/db";
import * as FakeStores from "@oligarchy/stores/testing";
import * as jarl from "jarl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Abort from "../src/abort.ts";
import { restart } from "../src/restart.ts";
import { shutdown } from "../src/shutdown.ts";
import { cleanUp, dispatching, FIRST, UNREACHABLE } from "./dispatching.ts";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(async () => {
  await cleanUp();
  vi.useRealTimers();
});

it("restart stops and aborts an inherited job and run, leaving pending jobs queued", async () => {
  const at = await dispatching({ [FIRST]: { abort: async () => "stopped" } });
  await at.live(FIRST);
  const { job, run } = await at.drive();
  const queued = await at.drive();
  await at.runOn(job, (await at.clientId(FIRST))!);
  jarl.unwrap(await restart(at.services, at.lifecycleOptions));
  expect(at.posted("/abort")).toEqual([[FIRST, { jobId: job.id }]]);
  expect(await at.job(job.id)).toMatchObject({
    status: "aborted",
    reason: expect.stringContaining("restarted"),
  });
  expect(await at.run(run.id)).toMatchObject({ status: "aborted" });
  expect(await at.job(queued.job.id)).toMatchObject({ status: "pending" });
});

it("restart stops every inherited job beyond the queue display limit", async () => {
  const at = await dispatching({ [FIRST]: { abort: async () => "stopped" } });
  await at.live(FIRST);
  const suite = await at.suite(27);
  const clientId = (await at.clientId(FIRST))!;
  for (const run of suite.runs) await at.runOn(run.jobs[0]!, clientId);
  expect(jarl.unwrap(await at.tests.listJobs()).running).toHaveLength(25);
  jarl.unwrap(await restart(at.services, at.lifecycleOptions));
  expect(at.posted("/abort")).toHaveLength(27);
  expect(jarl.unwrap(await at.tests.listRunningJobs())).toEqual([]);
  for (const { run, jobs } of suite.runs) {
    expect(await at.job(jobs[0]!.id)).toMatchObject({ status: "aborted" });
    expect(await at.run(run.id)).toMatchObject({ status: "aborted" });
  }
  expect(jarl.unwrap(await at.tests.getTestSuite(suite.suite.id))).toMatchObject({
    status: "failed",
  });
});

it("shutdown visits every running job beyond the queue display limit", async () => {
  const at = await dispatching();
  const filed = await at.suite(27);
  for (const row of filed.runs) await at.runOn(row.jobs[0]!, crypto.randomUUID());
  const stopped: string[] = [];
  // Query the real queue, but fake each cleanup so this tests enumeration without relying on
  // multiple concurrent transactions through the test database's single backend connection.
  const tests = FakeStores.tests({
    listRunningJobs: at.tests.listRunningJobs,
    getJob: async (id) => {
      const job = filed.runs.flatMap((row) => row.jobs).find((candidate) => candidate.id === id)!;
      return jarl.ok({ ...job, status: "running", serverId: null, test: "lock-screen" });
    },
    abortJob: async (id) => {
      stopped.push(id);
      const job = filed.runs.flatMap((row) => row.jobs).find((candidate) => candidate.id === id)!;
      return jarl.ok({ ...job, status: "aborted" });
    },
    abortRun: async (id) =>
      jarl.ok({ ...filed.runs.find((row) => row.run.id === id)!.run, status: "aborted" }),
    getTestRun: async (id) =>
      jarl.ok({
        ...filed.runs.find((row) => row.run.id === id)!.run,
        suiteId: null,
        suite: null,
        test: "lock-screen",
      }),
  });
  jarl.unwrap(await shutdown({ ...at.services, tests }, at.lifecycleOptions));
  expect(new Set(stopped)).toEqual(
    new Set(filed.runs.flatMap((row) => row.jobs.map((job) => job.id))),
  );
  expect(stopped).toHaveLength(27);
});

it.each([restart, shutdown])(
  "aborts a running job even when its client has already finished and released it",
  async (end) => {
    const at = await dispatching({ [FIRST]: { abort: async () => "not-held" } });
    await at.live(FIRST);
    const { job, run } = await at.drive();
    await at.runOn(job, (await at.clientId(FIRST))!);
    jarl.unwrap(await end(at.services, at.lifecycleOptions));
    expect(await at.job(job.id)).toMatchObject({ status: "aborted" });
    expect(await at.run(run.id)).toMatchObject({ status: "aborted" });
    expect(jarl.unwrap(await at.tests.latestJob(run.id, "diagnose"))).toBeUndefined();
  },
);

it.each([restart, shutdown])("a client stop failure retains the running job", async (end) => {
  const at = await dispatching();
  await at.live(UNREACHABLE);
  const { job, run } = await at.drive();
  await at.runOn(job, (await at.clientId(UNREACHABLE))!);
  expect(jarl.error.is(await end(at.services, at.lifecycleOptions), Abort.NotStopped)).toBe(true);
  expect(await at.job(job.id)).toMatchObject({ status: "running" });
  expect(await at.run(run.id)).toMatchObject({ status: "running" });
});

it("shutdown aborts running jobs after client cleanup and leaves queued jobs for restart", async () => {
  const at = await dispatching({ [FIRST]: { abort: async () => "stopped" } });
  await at.live(FIRST);
  const { job, run } = await at.drive();
  const queued = await at.drive();
  await at.runOn(job, (await at.clientId(FIRST))!);
  jarl.unwrap(await shutdown(at.services, at.lifecycleOptions));
  expect(at.posted("/abort")).toEqual([[FIRST, { jobId: job.id }]]);
  expect(await at.job(job.id)).toMatchObject({
    status: "aborted",
    reason: "automation server shutting down",
  });
  expect(await at.run(run.id)).toMatchObject({ status: "aborted" });
  expect(await at.job(queued.job.id)).toMatchObject({ status: "pending" });
});

it.each([restart, shutdown])(
  "a database failure prevents lifecycle cleanup from claiming success",
  async (end) => {
    const at = await dispatching();
    await at.fake.stop();
    expect(jarl.error.is(await end(at.services, at.lifecycleOptions), Db.DatabaseError)).toBe(true);
    expect(at.asked()).toEqual([]);
  },
);
