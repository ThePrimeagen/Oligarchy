import { randomUUID } from "node:crypto";
import * as Db from "@oligarchy/db";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, describe, expect, it } from "vitest";
import * as Abort from "../src/abort.ts";
import {
  FIRST,
  SECOND,
  UNREACHABLE,
  cleanUp,
  dispatching,
  errors,
  stoppable,
} from "./dispatching.ts";

afterEach(cleanUp);

type At = Awaited<ReturnType<typeof dispatching>>;

const drives = (suite: Stores.Tests.TestSuiteDetails) =>
  suite.runs.map(({ jobs }) => {
    const [filed] = jobs;
    if (filed === undefined) {
      throw new Error("a test run filed with no job");
    }
    return filed;
  });

const clientIdOf = async (at: At, url: string) => {
  const id = await at.clientId(url);
  if (id === undefined) {
    throw new Error(`${url} is not live`);
  }
  return id;
};

const said = (at: At, jobId: string) =>
  at.said.filter((one) => one.report.jobId === jobId).map((one) => [one.level, one.text]);

const ABORTED = { status: "aborted", reason: Abort.REASON };

describe("aborting by job id or by suite id", () => {
  it("a running job is stopped at its client and aborted with its test run; then its suite's running job is stopped, its pending one aborted, each test run aborted and the suite aborted, and the closes of the stopped runs write nothing more (happy)", async () => {
    const at = await dispatching({ [FIRST]: stoppable(), [SECOND]: stoppable() });
    await at.live(FIRST, SECOND);
    const suite = await at.suite(3);
    const [first, second, third] = drives(suite);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("a suite of three filed fewer runs");
    }
    expect(await at.dispatcher.startNextJob()).toBe(true);
    expect(await at.dispatcher.startNextJob()).toBe(true);

    expect(jarl.is_ok(await at.aborter.abort({ jobId: first.id }))).toBe(true);

    expect(await at.job(first.id)).toEqual(ABORTED);
    expect(await at.run(first.runId)).toMatchObject(ABORTED);
    expect(jarl.unwrap(await at.tests.getTestSuite(suite.suite.id)).status).toBe("running");

    expect(jarl.is_ok(await at.aborter.abort({ suiteId: suite.suite.id }))).toBe(true);
    await at.dispatcher.waitForRuns();

    for (const job of [first, second, third]) {
      expect(await at.job(job.id)).toEqual(ABORTED);
      expect(await at.run(job.runId)).toMatchObject(ABORTED);
      const lines = at.said.filter((line) => line.report.jobId === job.id);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.report).toMatchObject({ jobId: job.id, runId: job.runId });
      }
    }
    const { status, reason } = jarl.unwrap(await at.tests.getTestSuite(suite.suite.id));
    expect({ status, reason }).toEqual(ABORTED);
    expect(at.posted("/abort")).toEqual([
      [FIRST, { jobId: first.id }],
      [SECOND, { jobId: second.id }],
    ]);
    expect(said(at, first.id)).toEqual([
      ["info", `reserved drive; ${FIRST}`],
      ["info", `aborted running drive; stopped at ${FIRST}`],
    ]);
    expect(said(at, third.id)).toEqual([["info", "aborted pending drive"]]);
    expect(errors(at.said)).toEqual([]);
  });

  it("an unknown job and an unknown suite are NotFound, and nothing is written or asked (unhappy)", async () => {
    const at = await dispatching();
    const job = randomUUID();
    const suite = randomUUID();

    const byJob = await at.aborter.abort({ jobId: job });
    const bySuite = await at.aborter.abort({ suiteId: suite });

    expect(jarl.error.is(byJob, Stores.Tests.NotFound)).toBe(true);
    expect(jarl.error.is(bySuite, Stores.Tests.NotFound)).toBe(true);
    expect(at.asked()).toEqual([]);
    expect(errors(at.said)).toEqual([]);
  });

  it("a job or a suite no longer open is NothingToAbort naming how it ended, and nothing is asked (unhappy)", async () => {
    const at = await dispatching();
    const { job } = await at.drive();
    await at.runOn(job, randomUUID());
    jarl.unwrap(await at.tests.completeJob(job.id));
    const suite = await at.suite(1);
    jarl.unwrap(await at.aborter.abort({ suiteId: suite.suite.id }));

    const byJob = await at.aborter.abort({ jobId: job.id });
    const bySuite = await at.aborter.abort({ suiteId: suite.suite.id });

    if (!jarl.error.is(byJob, Abort.NothingToAbort)) {
      throw new Error("expected NothingToAbort for the job");
    }
    if (!jarl.error.is(bySuite, Abort.NothingToAbort)) {
      throw new Error("expected NothingToAbort for the suite");
    }
    expect(byJob.error.message).toBe(`job ${job.id} is completed; nothing to abort`);
    expect(bySuite.error.message).toBe(`suite ${suite.suite.id} is aborted; nothing to abort`);
    expect(await at.job(job.id)).toEqual({ status: "completed", reason: null });
    expect(at.asked()).toEqual([]);
  });

  it("a client that cannot be reached is NotStopped naming it and why: its job stays running with an error line under it, while the suite's other job is aborted and the suite stays open (unhappy)", async () => {
    const at = await dispatching();
    await at.live(UNREACHABLE);
    const suite = await at.suite(2);
    const [first, second] = drives(suite);
    if (first === undefined || second === undefined) {
      throw new Error("a suite of two filed fewer runs");
    }
    await at.runOn(first, await clientIdOf(at, UNREACHABLE));

    const aborted = await at.aborter.abort({ suiteId: suite.suite.id });

    if (!jarl.error.is(aborted, Abort.NotStopped)) {
      throw new Error("expected NotStopped");
    }
    const why = `POST ${UNREACHABLE}/abort: fetch failed`;
    expect(aborted.error.message).toBe(`job ${first.id} could not be stopped: ${why}`);
    expect(await at.job(first.id)).toEqual({ status: "running", reason: null });
    expect(await at.run(first.runId)).toMatchObject({ status: "running" });
    expect(await at.job(second.id)).toEqual(ABORTED);
    expect(await at.run(second.runId)).toMatchObject(ABORTED);
    expect(jarl.unwrap(await at.tests.getTestSuite(suite.suite.id)).status).toBe("running");
    expect(said(at, first.id)).toEqual([["error", `abort failed; ${why}`]]);
  });

  it("a job whose client is forgotten has nothing to stop: it is aborted all the same, a warning under it (unhappy)", async () => {
    const at = await dispatching();
    const { job, run } = await at.drive();
    await at.runOn(job, randomUUID());

    expect(jarl.is_ok(await at.aborter.abort({ jobId: job.id }))).toBe(true);

    expect(await at.job(job.id)).toEqual(ABORTED);
    expect(await at.run(run.id)).toMatchObject(ABORTED);
    expect(at.asked()).toEqual([]);
    expect(said(at, job.id)).toEqual([
      [
        "warning",
        "aborted running drive; its automation client is forgotten, so nothing was stopped",
      ],
    ]);
  });

  it("a client that holds no such job answers not-held: the job is aborted all the same, a warning under it (unhappy)", async () => {
    const at = await dispatching({ [FIRST]: { abort: async () => "not-held" } });
    await at.live(FIRST);
    const { job, run } = await at.drive();
    await at.runOn(job, await clientIdOf(at, FIRST));

    expect(jarl.is_ok(await at.aborter.abort({ jobId: job.id }))).toBe(true);

    expect(await at.job(job.id)).toEqual(ABORTED);
    expect(await at.run(run.id)).toMatchObject(ABORTED);
    expect(said(at, job.id)).toEqual([
      ["warning", `aborted running drive; ${FIRST} was not running it`],
    ]);
  });

  it("a job that ends while it is being stopped is NothingToAbort, and the close of its end stands (unhappy)", async () => {
    let end: () => void = () => undefined;
    const at = await dispatching((tests) => ({
      [FIRST]: {
        run: () =>
          new Promise((resolve) => {
            end = () => resolve(jarl.ok("ended"));
          }),
        // The driver had already finished when the abort came: the run answers ended, and the
        // client answers the abort only once that end is closed.
        abort: async ({ jobId }) => {
          end();
          for (;;) {
            const found = jarl.unwrap(await tests.getJob(jobId));
            if (found.status !== "running") {
              return "not-held";
            }
          }
        },
      },
    }));
    await at.live(FIRST);
    const { job, run } = await at.drive();
    expect(await at.dispatcher.startNextJob()).toBe(true);

    const aborted = await at.aborter.abort({ jobId: job.id });

    if (!jarl.error.is(aborted, Abort.NothingToAbort)) {
      throw new Error("expected NothingToAbort");
    }
    expect(aborted.error.message).toBe(
      `job ${job.id} completed while it was being stopped; nothing to abort`,
    );
    expect(await at.job(job.id)).toEqual({ status: "completed", reason: null });
    expect(await at.run(run.id)).toMatchObject({ status: "running" });
    expect(jarl.unwrap(await at.tests.latestJob(run.id, "diagnose"))?.status).toBe("pending");
  });

  it("with the database gone is a DatabaseError, and nothing is asked (unhappy)", async () => {
    const at = await dispatching();
    const { job } = await at.drive();
    await at.fake.stop();

    const aborted = await at.aborter.abort({ jobId: job.id });

    expect(jarl.error.is(aborted, Db.DatabaseError)).toBe(true);
    expect(at.asked()).toEqual([]);
  });
});
