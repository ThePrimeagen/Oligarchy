import * as Db from "@oligarchy/db";
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

it("restart stops an inherited job and marks its unknown outcome errored, leaving pending jobs queued", async () => {
  const at = await dispatching({ [FIRST]: { abort: async () => "stopped" } });
  await at.live(FIRST);
  const { job, run } = await at.drive();
  const queued = await at.drive();
  await at.runOn(job, (await at.clientId(FIRST))!);
  jarl.unwrap(await restart(at.services, at.lifecycleOptions));
  expect(at.posted("/abort")).toEqual([[FIRST, { jobId: job.id }]]);
  expect(await at.job(job.id)).toMatchObject({
    status: "errored",
    reason: expect.stringContaining("restarted"),
  });
  expect(await at.run(run.id)).toMatchObject({ status: "errored" });
  expect(await at.job(queued.job.id)).toMatchObject({ status: "pending" });
});

it("restart preserves a result committed while stopping the inherited client", async () => {
  const at = await dispatching((tests) => ({
    [FIRST]: {
      abort: async ({ jobId }) => {
        jarl.unwrap(await tests.completeJob(jobId));
        return "not-held";
      },
    },
  }));
  await at.live(FIRST);
  const { job } = await at.drive();
  await at.runOn(job, (await at.clientId(FIRST))!);
  jarl.unwrap(await restart(at.services, at.lifecycleOptions));
  expect(await at.job(job.id)).toEqual({ status: "completed", reason: null });
});

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
