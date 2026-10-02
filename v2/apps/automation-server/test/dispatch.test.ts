import { randomUUID } from "node:crypto";
import * as ClientRoutes from "@oligarchy/automation-client/routes";
import * as jarl from "jarl";
import { afterEach, describe, expect, it } from "vitest";
import {
  FIRST,
  HANGING,
  ISO,
  MODELS,
  QEMU_SERVER,
  SECOND,
  cleanUp,
  dispatching,
  errors,
} from "./dispatching.ts";

afterEach(cleanUp);

describe("starting the next job", () => {
  it("reserves each pending job in queue order on the live clients round robin, a drive resuming its ISO only when its definition resumes and a setup on its lock's server, moves it to running naming the client that took it, starts a drive's or setup's test run with its model, sends /run with a prompt only for a diagnose, and with nothing left says to wait (happy)", async () => {
    const at = await dispatching({ [FIRST]: {}, [SECOND]: {} });
    await at.live(FIRST, SECOND);
    const setup = await at.setup();
    const diagnose = await at.diagnose();
    const resumed = await at.drive(true);
    const fresh = await at.drive(false);

    const started = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      started.push(await at.dispatcher.startNextJob());
    }

    expect(started).toEqual([true, true, true, true, false]);
    expect(at.posted("/reserve")).toEqual([
      [FIRST, { jobId: setup.id, action: "setup", setupServer: QEMU_SERVER }],
      [SECOND, { jobId: diagnose.job.id, action: "diagnose" }],
      [FIRST, { jobId: resumed.job.id, action: "drive", resume: ISO }],
      [SECOND, { jobId: fresh.job.id, action: "drive" }],
    ]);
    const runs = at.posted("/run");
    expect(runs).toEqual([
      [FIRST, { jobId: setup.id }],
      [SECOND, { jobId: diagnose.job.id, prompt: expect.any(String) }],
      [FIRST, { jobId: resumed.job.id }],
      [SECOND, { jobId: fresh.job.id }],
    ]);
    const prompt = ClientRoutes.RunRequest.parse(runs[1]?.[1]).prompt;
    expect(prompt).toContain(diagnose.judged.id);
    expect(prompt).toContain(MODELS.diagnose);
    const first = await at.clientId(FIRST);
    const second = await at.clientId(SECOND);
    const placed = [];
    for (const one of [setup, diagnose.job, resumed.job, fresh.job]) {
      const { status, serverId, runId } = jarl.unwrap(await at.tests.getJob(one.id));
      const run = await at.run(runId);
      placed.push({ status, serverId, run: { status: run.status, model: run.model } });
    }
    expect(placed).toEqual([
      { status: "running", serverId: first, run: { status: "running", model: MODELS.setup } },
      { status: "running", serverId: second, run: { status: "running", model: MODELS.drive } },
      { status: "running", serverId: first, run: { status: "running", model: MODELS.drive } },
      { status: "running", serverId: second, run: { status: "running", model: MODELS.drive } },
    ]);
    expect(errors(at.said)).toEqual([]);
  });

  it("with no live client asks nothing, leaves the job pending and says to wait (unhappy)", async () => {
    const at = await dispatching({ [FIRST]: {} });
    const { job } = await at.drive();

    expect(await at.dispatcher.startNextJob()).toBe(false);

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

    expect(await at.dispatcher.startNextJob()).toBe(false);

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

    expect(await at.dispatcher.startNextJob()).toBe(true);

    const failed = at.said.filter((one) => one.level === "error");
    expect(failed.map((one) => one.text)).toEqual([
      `reserve failed; ${FIRST}: POST ${FIRST}/reserve: 500: {"error":"reserving a guest failed"}`,
    ]);
    expect(failed[0]?.report).toMatchObject({ jobId: job.id, runId: job.runId });
    const { status, serverId } = jarl.unwrap(await at.tests.getJob(job.id));
    expect({ status, serverId }).toEqual({
      status: "running",
      serverId: await at.clientId(SECOND),
    });
  });

  it("a client that cannot be reached is an error line naming it, and the job stays pending (unhappy)", async () => {
    const at = await dispatching();
    await at.live(FIRST);
    const { job } = await at.drive();

    expect(await at.dispatcher.startNextJob()).toBe(false);

    expect(errors(at.said)).toEqual([
      `reserve failed; ${FIRST}: POST ${FIRST}/reserve: fetch failed`,
    ]);
    expect((await at.job(job.id)).status).toBe("pending");
  });

  it("a shutdown during a reserve ends it: no error line, no other client asked, the job left pending (unhappy)", async () => {
    const at = await dispatching({ [SECOND]: {} });
    await at.live(HANGING, SECOND);
    const { job } = await at.drive();

    const starting = at.dispatcher.startNextJob();
    await at.hangingReserveEntered;
    at.stop();

    expect(await starting).toBe(false);
    expect(at.asked().map(([url]) => url)).toEqual([`${HANGING}/reserve`]);
    expect(errors(at.said)).toEqual([]);
    expect((await at.job(job.id)).status).toBe("pending");
  });

  it("a job that left pending while its client reserved it is given back at that client with /abort, an error line says why, and it says to wait (unhappy)", async () => {
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

    expect(await at.dispatcher.startNextJob()).toBe(false);

    expect(at.handed[FIRST]).toEqual([
      { jobId: job.id, action: "drive", resume: ISO },
      { jobId: job.id },
    ]);
    expect(errors(at.said)).toEqual([
      `running write failed; ${FIRST}: runJob: job ${job.id} is aborted drive; needs pending`,
    ]);
    expect((await at.job(job.id)).status).toBe("aborted");
  });

  it("a setup whose lock its qemu server cleared on a restart can never be reserved: it is aborted saying so, nothing is asked, and the next job is asked for at once (unhappy)", async () => {
    const at = await dispatching({ [FIRST]: {} });
    await at.live(FIRST);
    const setup = await at.setup();
    jarl.unwrap(await at.setupRequests.removeServer(QEMU_SERVER));

    expect(await at.dispatcher.startNextJob()).toBe(true);

    expect(await at.job(setup.id)).toEqual({
      status: "aborted",
      reason: "no setup lock names this setup's server",
    });
    expect(errors(at.said)).toEqual(["setup aborted: no setup lock names this setup's server"]);
    expect(at.asked()).toEqual([]);
  });

  it("a diagnose whose test run has no completed drive or setup has nothing to judge and can never run: it is aborted saying so, nothing is asked, and the next job is asked for at once (unhappy)", async () => {
    const at = await dispatching({ [FIRST]: {} });
    await at.live(FIRST);
    const filed = await at.drive();
    jarl.unwrap(await at.tests.abortJob(filed.job.id, "making way"));
    const diagnose = jarl.unwrap(await at.tests.createJob(filed.run.id, "diagnose"));

    expect(await at.dispatcher.startNextJob()).toBe(true);

    const reason = "no completed drive or setup on its test run to judge";
    expect(await at.job(diagnose.id)).toEqual({ status: "aborted", reason });
    const failed = at.said.filter((one) => one.level === "error");
    expect(failed.map((one) => one.text)).toEqual([`diagnose aborted: ${reason}`]);
    expect(failed[0]?.report).toMatchObject({ jobId: diagnose.id, runId: diagnose.runId });
    expect(at.asked()).toEqual([]);
  });

  it("a test run that cannot be started is an error line under the job, which still runs; one already running, as a retried drive's is, says nothing (unhappy)", async () => {
    const at = await dispatching({ [FIRST]: {} });
    await at.live(FIRST);
    // Each drive ran once and errored, and was tried again on its running test run.
    const triedAgain = async () => {
      const filed = await at.drive();
      jarl.unwrap(await at.tests.runJob(filed.job.id, randomUUID()));
      jarl.unwrap(await at.tests.startRun(filed.run.id, MODELS.drive));
      jarl.unwrap(await at.tests.errorJob(filed.job.id, "the proxy restarted"));
      return { run: filed.run, job: jarl.unwrap(await at.tests.createJob(filed.run.id, "drive")) };
    };
    const retried = await triedAgain();
    const closed = await triedAgain();
    jarl.unwrap(await at.tests.completeRun(closed.run.id, "failed", "closed by hand"));

    expect(await at.dispatcher.startNextJob()).toBe(true);
    expect(await at.dispatcher.startNextJob()).toBe(true);

    const failed = at.said.filter((one) => one.level === "error");
    expect(failed.map((one) => one.text)).toEqual([
      `test run start failed: startRun: test run ${closed.run.id} is failed; needs pending`,
    ]);
    expect(failed[0]?.report).toMatchObject({ jobId: closed.job.id, runId: closed.job.runId });
    expect((await at.job(retried.job.id)).status).toBe("running");
    expect((await at.job(closed.job.id)).status).toBe("running");
    expect(at.posted("/run")).toEqual([
      [FIRST, { jobId: retried.job.id }],
      [FIRST, { jobId: closed.job.id }],
    ]);
  });

  it("a /run a shutdown ended closes nothing and says nothing: the job is left running (unhappy)", async () => {
    const at = await dispatching({ [FIRST]: {} });
    await at.live(FIRST);
    const { job } = await at.drive();
    expect(await at.dispatcher.startNextJob()).toBe(true);

    at.stop();
    await at.dispatcher.waitForRuns();

    expect(at.posted("/run")).toEqual([[FIRST, { jobId: job.id }]]);
    expect(await at.job(job.id)).toEqual({ status: "running", reason: null });
    expect(at.said.map((one) => one.text)).toEqual([`reserved drive; ${FIRST}`]);
  });

  it("with the database gone is an error line, asks no client, and says to wait (unhappy)", async () => {
    const at = await dispatching({ [FIRST]: {} });
    await at.live(FIRST);
    await at.drive();
    await at.fake.stop();

    expect(await at.dispatcher.startNextJob()).toBe(false);

    const failed = errors(at.said);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatch(/^dispatch failed: Failed query: /);
    expect(at.asked()).toEqual([]);
  });
});
