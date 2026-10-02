import { randomUUID } from "node:crypto";
import * as ClientRoutes from "@oligarchy/automation-client/routes";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, describe, expect, it } from "vitest";
import { FIRST, MODELS, SECOND, cleanUp, dispatching, errors, gate } from "./dispatching.ts";

afterEach(cleanUp);

const ended: ClientRoutes.Sessions["run"] = async () => jarl.ok("ended");

type At = Awaited<ReturnType<typeof dispatching>>;

// Starts the next job and waits for its /run to answer and its close to end.
const closeNext = async (at: At) => {
  expect(await at.dispatcher.startNextJob()).toBe(true);
  await at.dispatcher.waitForRuns();
};

const diagnoseOf = async (at: At, runId: string) => {
  const queued = jarl.unwrap(await at.tests.latestJob(runId, "diagnose"));
  if (queued === undefined) {
    throw new Error(`no diagnose on test run ${runId}`);
  }
  return queued;
};

const drives = (suite: Stores.Tests.TestSuiteDetails) =>
  suite.runs.map(({ jobs }) => {
    const [filed] = jobs;
    if (filed === undefined) {
      throw new Error("a test run filed with no job");
    }
    return filed;
  });

const record = async (
  at: At,
  jobId: string,
  verdict: Stores.Diagnosis.Verdict,
  summary: string,
  errorType: string | null = null,
) =>
  jarl.unwrap(
    await at.diagnosis.saveDiagnosis({
      jobId,
      verdict,
      errorType,
      summary,
      model: MODELS.diagnose,
    }),
  );

describe("closing a job once its /run answers", () => {
  it("a drive that ended is completed with a diagnose queued; a diagnose that ended finalizes the drive by the recorded verdict and closes its test run, and the suite closes once its last run has, failed when any run failed (happy)", async () => {
    const at = await dispatching({ [FIRST]: { run: ended } });
    await at.live(FIRST);
    const suite = await at.suite(2);
    const [first, second] = drives(suite);
    if (first === undefined || second === undefined) {
      throw new Error("a suite of two filed fewer runs");
    }
    const passed = "the last image shows the lock screen with the clock";
    const failed = "the serial stops after 'Waiting for root device'";

    await closeNext(at);

    expect(await at.job(first.id)).toEqual({ status: "completed", reason: null });
    const firstDiagnose = await diagnoseOf(at, first.runId);
    expect(firstDiagnose.status).toBe("pending");

    await record(at, first.id, "passed", passed);
    await closeNext(at);

    expect(await at.job(firstDiagnose.id)).toEqual({ status: "completed", reason: null });
    expect(await at.job(first.id)).toEqual({ status: "succeeded", reason: passed });
    expect(await at.run(first.runId)).toMatchObject({ status: "passed", reason: passed });
    expect(jarl.unwrap(await at.tests.getTestSuite(suite.suite.id)).status).toBe("running");

    await closeNext(at);
    jarl.unwrap(
      await at.diagnosis.createErrorType("guest_boot_hang", "the guest never reached its login"),
    );
    await record(at, second.id, "failed", failed, "guest_boot_hang");
    await closeNext(at);

    expect(await at.job(second.id)).toEqual({ status: "failed", reason: failed });
    expect(await at.run(second.runId)).toMatchObject({ status: "failed", reason: failed });
    const { status, reason } = jarl.unwrap(await at.tests.getTestSuite(suite.suite.id));
    expect({ status, reason }).toEqual({ status: "failed", reason: null });
    expect(errors(at.said)).toEqual([]);
  });

  it("the last two runs of a suite closing at once each find nothing open, and the one that completes the suite second is refused with no error line (unhappy)", async () => {
    // Each close reads its suite only once both have closed their runs.
    const bothClosed = gate();
    let reads = 0;
    const at = await dispatching(
      { [FIRST]: { run: ended }, [SECOND]: { run: ended } },
      (tests) => ({
        ...tests,
        getTestSuite: async (suiteId) => {
          reads += 1;
          if (reads === 2) {
            bothClosed.release();
          }
          await bothClosed.opened;
          return tests.getTestSuite(suiteId);
        },
      }),
    );
    await at.live(FIRST, SECOND);
    const suite = await at.suite(2);
    const [first, second] = drives(suite);
    if (first === undefined || second === undefined) {
      throw new Error("a suite of two filed fewer runs");
    }
    // Both drives run before either diagnose is queued.
    jarl.unwrap(await at.tests.runJob(first.id, randomUUID()));
    jarl.unwrap(await at.tests.runJob(second.id, randomUUID()));
    for (const drive of [first, second]) {
      jarl.unwrap(await at.tests.startRun(drive.runId, MODELS.drive));
      jarl.unwrap(await at.tests.completeJob(drive.id));
      jarl.unwrap(await at.tests.createJob(drive.runId, "diagnose"));
      await record(at, drive.id, "passed", "the proof is on the last image");
    }

    expect(await at.dispatcher.startNextJob()).toBe(true);
    expect(await at.dispatcher.startNextJob()).toBe(true);
    await at.dispatcher.waitForRuns();

    expect(reads).toBe(2);
    const { status, runs } = jarl.unwrap(await at.tests.getTestSuite(suite.suite.id));
    expect({ status, passed: runs.passed }).toEqual({ status: "passed", passed: 2 });
    expect(errors(at.said)).toEqual([]);
  });

  it("a diagnose that ended with no diagnosis recorded is errored saying so, an error line under it, and its drive and test run are left as they were (unhappy)", async () => {
    const at = await dispatching({ [FIRST]: { run: ended } });
    await at.live(FIRST);
    const { job: drive, run } = await at.drive();
    await closeNext(at);
    const diagnose = await diagnoseOf(at, run.id);

    await closeNext(at);

    const reason = `the diagnosing agent recorded no diagnosis for job ${drive.id}`;
    expect(await at.job(diagnose.id)).toEqual({ status: "errored", reason });
    expect(await at.job(drive.id)).toEqual({ status: "completed", reason: null });
    expect(await at.run(run.id)).toMatchObject({ status: "running", reason: null });
    const failed = at.said.filter((one) => one.level === "error");
    expect(failed.map((one) => one.text)).toEqual([`diagnose errored: ${reason}`]);
    expect(failed[0]?.report.agentId).toBe(diagnose.id);
  });

  it("a /run that failed at its client is errored with why and an error line under it; no diagnose is queued and its test run is left running for a try again (unhappy)", async () => {
    const at = await dispatching({
      [FIRST]: {
        run: async () =>
          jarl.err(new ClientRoutes.RunFailed("driver exited 1: OpenRouterUnreachable")),
      },
    });
    await at.live(FIRST);
    const { job, run } = await at.drive();

    await closeNext(at);

    const reason = `POST ${FIRST}/run: 500: {"error":"driver exited 1: OpenRouterUnreachable"}`;
    expect(await at.job(job.id)).toEqual({ status: "errored", reason });
    expect(jarl.unwrap(await at.tests.latestJob(run.id, "diagnose"))).toBeUndefined();
    expect(await at.run(run.id)).toMatchObject({ status: "running", reason: null });
    const failed = at.said.filter((one) => one.level === "error");
    expect(failed.map((one) => one.text)).toEqual([`run failed: ${reason}`]);
    expect(failed[0]?.report.agentId).toBe(job.id);
  });

  it("a /run that timed out at its client is timed out with why, and so is its test run, with a warning under it; no diagnose is queued, a diagnose's drive is left completed, and the suite closes failed (unhappy)", async () => {
    const timesOut = new Set<string>();
    const why = "driver timed out: run ceiling of 60000 ms";
    const at = await dispatching({
      [FIRST]: {
        run: async ({ jobId, prompt }) =>
          timesOut.has(jobId) || prompt !== undefined
            ? jarl.err(new ClientRoutes.RunTimedOut(why))
            : jarl.ok("ended"),
      },
    });
    await at.live(FIRST);
    const suite = await at.suite(2);
    const [first, second] = drives(suite);
    if (first === undefined || second === undefined) {
      throw new Error("a suite of two filed fewer runs");
    }
    timesOut.add(first.id);

    await closeNext(at);
    await closeNext(at);
    const diagnose = await diagnoseOf(at, second.runId);
    await closeNext(at);

    const reason = `POST ${FIRST}/run: 504: {"error":"${why}"}`;
    expect(await at.job(first.id)).toEqual({ status: "timed_out", reason });
    expect(jarl.unwrap(await at.tests.latestJob(first.runId, "diagnose"))).toBeUndefined();
    expect(await at.run(first.runId)).toMatchObject({ status: "timed_out", reason });
    expect(await at.job(diagnose.id)).toEqual({ status: "timed_out", reason });
    expect(await at.job(second.id)).toEqual({ status: "completed", reason: null });
    expect(await at.run(second.runId)).toMatchObject({ status: "timed_out", reason });
    expect(jarl.unwrap(await at.tests.getTestSuite(suite.suite.id)).status).toBe("failed");
    const warned = at.said.filter((one) => one.level === "warning");
    expect(warned.map((one) => [one.text, one.report.agentId])).toEqual([
      [`drive timed out: ${reason}`, first.id],
      [`diagnose timed out: ${reason}`, diagnose.id],
    ]);
    expect(errors(at.said)).toEqual([]);
  });

  it("a /run an abort ended is aborted at its client; a job already aborted, as by an operator, stays as it was and nothing is said of it (unhappy)", async () => {
    const at = await dispatching((tests) => ({
      [FIRST]: { run: async () => jarl.ok("aborted") },
      [SECOND]: {
        run: async ({ jobId }) => {
          jarl.unwrap(await tests.abortJob(jobId, "an operator aborted it"));
          return jarl.ok("aborted");
        },
      },
    }));
    await at.live(FIRST, SECOND);
    const atClient = await at.drive();
    const byOperator = await at.drive();

    await closeNext(at);
    await closeNext(at);

    expect(await at.job(atClient.job.id)).toEqual({
      status: "aborted",
      reason: "aborted at its automation client",
    });
    expect(await at.job(byOperator.job.id)).toEqual({
      status: "aborted",
      reason: "an operator aborted it",
    });
    expect(
      at.said.filter((one) => one.report.agentId === byOperator.job.id).map((one) => one.text),
    ).toEqual([`reserved drive; ${SECOND}`]);
    expect(errors(at.said)).toEqual([]);
  });

  it("with the database gone during a close is one error line under the job, and the close stops there (unhappy)", async () => {
    const diagnoseEnds = gate();
    const at = await dispatching({
      [FIRST]: {
        run: async (request) => {
          if (request.prompt !== undefined) {
            await diagnoseEnds.opened;
          }
          return jarl.ok("ended");
        },
      },
    });
    await at.live(FIRST);
    const { run } = await at.drive();
    await closeNext(at);
    const diagnose = await diagnoseOf(at, run.id);
    expect(await at.dispatcher.startNextJob()).toBe(true);
    await at.fake.stop();

    diagnoseEnds.release();
    await at.dispatcher.waitForRuns();

    const failed = at.said.filter((one) => one.level === "error");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.text).toMatch(/^close failed: Failed query: /);
    expect(failed[0]?.report.agentId).toBe(diagnose.id);
  });
});
