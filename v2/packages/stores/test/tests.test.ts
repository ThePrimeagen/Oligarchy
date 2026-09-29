import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { eq } from "drizzle-orm";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Tests from "../src/tests.ts";
import { database } from "./support.ts";

type Store = Tests.Tests;
type Setup = Awaited<ReturnType<typeof database>>;
type Outcome = Promise<jarl.Result<unknown, Error>>;
type JobStatus = Tests.JobRow["status"];
type RunStatus = Tests.RunRow["status"];
type SuiteStatus = Tests.SuiteRow["status"];

const JOB_STATES = DbSchema.jobStatus.enumValues;
const RUN_STATES = DbSchema.testRunStatus.enumValues;
const SUITE_STATES = DbSchema.testSuiteStatus.enumValues;

const except = <S extends string>(all: ReadonlyArray<S>, accepted: ReadonlyArray<NoInfer<S>>) =>
  all.filter((state) => !accepted.includes(state));

// What a call came to, in one line: ok, or the refusal's name and what it said.
const said = (result: jarl.Result<unknown, Error>) =>
  result.ok ? "ok" : `${result.error.name}: ${result.error.message}`;

const SUITE: Tests.SuiteInput = {
  name: "nightly",
  iso: "https://example.com/omarchy.iso",
  serverUrl: "http://qemu-1",
};

const definition = async (tests: Store, name = "lock-screen") =>
  jarl.unwrap(
    await tests.defineTestDefinition({ name, description: "", instruction: "", proof: "" }),
  ).id;

const newSuite = async (tests: Store) => jarl.unwrap(await tests.createTestSuite(SUITE));

const newRun = async (tests: Store, suiteId?: string, name?: string) => {
  const suite = suiteId ?? (await newSuite(tests)).id;
  return jarl.unwrap(await tests.createTestRun(suite, await definition(tests, name)));
};

const newJob = async (tests: Store, runId?: string, action: Tests.JobAction = "drive") => {
  const run = runId ?? (await newRun(tests)).id;
  return jarl.unwrap(await tests.createJob(run, action));
};

// Puts a row straight into a state, so a test starts from any state without walking there.
const setJob = (db: Db.Database, id: string, status: JobStatus) =>
  db.run((d) => d.update(DbSchema.jobs).set({ status }).where(eq(DbSchema.jobs.id, id)));
const setRun = (db: Db.Database, id: string, status: RunStatus) =>
  db.run((d) => d.update(DbSchema.testRuns).set({ status }).where(eq(DbSchema.testRuns.id, id)));
const setSuite = (db: Db.Database, id: string, status: SuiteStatus) =>
  db.run((d) =>
    d.update(DbSchema.testSuites).set({ status }).where(eq(DbSchema.testSuites.id, id)),
  );

const jobIn = async (setup: Setup, status: JobStatus, action: Tests.JobAction = "drive") => {
  const job = await newJob(setup.tests, undefined, action);
  await setJob(setup.db, job.id, status);
  return job;
};
const runIn = async (setup: Setup, status: RunStatus) => {
  const run = await newRun(setup.tests);
  await setRun(setup.db, run.id, status);
  return run;
};
const suiteIn = async (setup: Setup, status: SuiteStatus) => {
  const suite = await newSuite(setup.tests);
  await setSuite(setup.db, suite.id, status);
  return suite;
};

const jobCount = (db: Db.Database, runId: string) =>
  db.run((d) => d.$count(DbSchema.jobs, eq(DbSchema.jobs.runId, runId)));

// Every state but the accepted ones is refused, and the row is left exactly as it was.
const refusesOtherJobStates = (
  fn: string,
  accepted: ReadonlyArray<JobStatus>,
  need: string,
  call: (tests: Store, id: string) => Outcome,
) =>
  it.each(except(JOB_STATES, accepted))(
    "refuses a %s drive, which stays as it was (unhappy)",
    async (status) => {
      const setup = await database();
      const job = await jobIn(setup, status);
      const before = jarl.unwrap(await setup.tests.getJob(job.id));

      expect(said(await call(setup.tests, job.id))).toBe(
        `InvalidState: ${fn}: job ${job.id} is ${status} drive; needs ${need}`,
      );
      expect(jarl.unwrap(await setup.tests.getJob(job.id))).toEqual(before);
    },
  );

const refusesOtherRunStates = (
  fn: string,
  accepted: ReadonlyArray<RunStatus>,
  need: string,
  call: (tests: Store, id: string) => Outcome,
) =>
  it.each(except(RUN_STATES, accepted))(
    "refuses a %s test run, which stays as it was (unhappy)",
    async (status) => {
      const setup = await database();
      const run = await runIn(setup, status);
      const before = jarl.unwrap(await setup.tests.getTestRun(run.id));

      expect(said(await call(setup.tests, run.id))).toBe(
        `InvalidState: ${fn}: test run ${run.id} is ${status}; needs ${need}`,
      );
      expect(jarl.unwrap(await setup.tests.getTestRun(run.id))).toEqual(before);
    },
  );

const refusesOtherSuiteStates = (
  fn: string,
  accepted: ReadonlyArray<SuiteStatus>,
  need: string,
  call: (tests: Store, id: string) => Outcome,
) =>
  it.each(except(SUITE_STATES, accepted))(
    "refuses a %s suite, which stays as it was (unhappy)",
    async (status) => {
      const setup = await database();
      const suite = await suiteIn(setup, status);
      const before = jarl.unwrap(await setup.tests.getTestSuite(suite.id));

      expect(said(await call(setup.tests, suite.id))).toBe(
        `InvalidState: ${fn}: test suite ${suite.id} is ${status}; needs ${need}`,
      );
      expect(jarl.unwrap(await setup.tests.getTestSuite(suite.id))).toEqual(before);
    },
  );

// A pending or running job holds its test run: the call is refused and nothing changes.
const refusesWhileAJobIsOpen = (fn: string, call: (tests: Store, runId: string) => Outcome) =>
  it.each(["pending", "running"] as const)(
    "refuses while the test run has a %s job (unhappy)",
    async (status) => {
      const setup = await database();
      const run = await newRun(setup.tests);
      await setRun(setup.db, run.id, "running");
      const job = await newJob(setup.tests, run.id);
      await setJob(setup.db, job.id, status);
      const before = jarl.unwrap(await setup.tests.getTestRun(run.id));

      expect(said(await call(setup.tests, run.id))).toBe(
        `InvalidState: ${fn}: test run ${run.id} has job ${job.id} ${status}; needs no pending or running job`,
      );
      expect(jarl.unwrap(await setup.tests.getTestRun(run.id))).toEqual(before);
    },
  );

// A pending or running test run holds its suite: the call is refused and nothing changes.
const refusesWhileATestRunIsOpen = (fn: string, call: (tests: Store, suiteId: string) => Outcome) =>
  it.each(["pending", "running"] as const)(
    "refuses while the suite has a %s test run (unhappy)",
    async (status) => {
      const setup = await database();
      const suite = await newSuite(setup.tests);
      const run = await newRun(setup.tests, suite.id);
      await setRun(setup.db, run.id, status);
      await setSuite(setup.db, suite.id, "running");
      const before = jarl.unwrap(await setup.tests.getTestSuite(suite.id));

      expect(said(await call(setup.tests, suite.id))).toBe(
        `InvalidState: ${fn}: test suite ${suite.id} has test run ${run.id} ${status}; needs no pending or running test run`,
      );
      expect(jarl.unwrap(await setup.tests.getTestSuite(suite.id))).toEqual(before);
    },
  );

describe("createTestRun: one test inside a suite", () => {
  it("starts pending, in a pending suite (happy)", async () => {
    const { tests } = await database();

    const run = await newRun(tests);

    expect(run.status).toBe("pending");
  });

  it("refuses a definition the suite already has (unhappy)", async () => {
    const { db, tests } = await database();
    const suite = await newSuite(tests);
    const lockScreen = await definition(tests);
    await tests.createTestRun(suite.id, lockScreen);

    expect(said(await tests.createTestRun(suite.id, lockScreen))).toBe(
      `Duplicate: createTestRun: test suite ${suite.id} already has test definition ${String(lockScreen)}`,
    );
    expect(
      jarl.unwrap(
        await db.run((d) => d.$count(DbSchema.testRuns, eq(DbSchema.testRuns.suiteId, suite.id))),
      ),
    ).toBe(1);
  });

  it("refuses a definition that does not exist (unhappy)", async () => {
    const { tests } = await database();
    const suite = await newSuite(tests);

    expect(said(await tests.createTestRun(suite.id, 999))).toBe(
      "NotFound: createTestRun: no test definition 999",
    );
  });

  it.each(except(SUITE_STATES, ["pending"]))(
    "refuses a %s suite: tests are added before it starts (unhappy)",
    async (status) => {
      const setup = await database();
      const suite = await suiteIn(setup, status);

      expect(said(await setup.tests.createTestRun(suite.id, await definition(setup.tests)))).toBe(
        `InvalidState: createTestRun: test suite ${suite.id} is ${status}; needs pending`,
      );
    },
  );
});

describe("createJob: one mint, drive or diagnose for a test run", () => {
  it("a drive that failed stays failed; trying again is a new drive on the same test run (happy)", async () => {
    const { db, tests } = await database();
    const run = await newRun(tests);
    const first = await newJob(tests, run.id);
    await setJob(db, first.id, "failed");

    const again = jarl.unwrap(await tests.createJob(run.id, "drive"));

    expect(again).toMatchObject({ runId: run.id, action: "drive", status: "pending" });
    expect(again.id).not.toBe(first.id);
    expect(jarl.unwrap(await tests.getJob(first.id)).status).toBe("failed");
  });

  it("a completed drive does not hold the test run: its diagnose is created (happy)", async () => {
    const { db, tests } = await database();
    const run = await newRun(tests);
    const drive = await newJob(tests, run.id);
    await setJob(db, drive.id, "completed");

    expect(said(await tests.createJob(run.id, "diagnose"))).toBe("ok");
  });

  it.each(["pending", "running"] as const)(
    "refuses a second job while the test run has a %s one (unhappy)",
    async (status) => {
      const { db, tests } = await database();
      const run = await newRun(tests);
      const open = await newJob(tests, run.id);
      await setJob(db, open.id, status);

      expect(said(await tests.createJob(run.id, "drive"))).toBe(
        `InvalidState: createJob: test run ${run.id} has job ${open.id} ${status}; needs no pending or running job`,
      );
      expect(jarl.unwrap(await jobCount(db, run.id))).toBe(1);
    },
  );

  it.each(except(RUN_STATES, ["pending", "running"]))(
    "refuses a %s test run, and creates nothing (unhappy)",
    async (status) => {
      const setup = await database();
      const run = await runIn(setup, status);

      expect(said(await setup.tests.createJob(run.id, "drive"))).toBe(
        `InvalidState: createJob: test run ${run.id} is ${status}; needs pending or running`,
      );
      expect(jarl.unwrap(await jobCount(setup.db, run.id))).toBe(0);
    },
  );
});

describe("runJob: a pending job runs on the client that took it", () => {
  it("moves a pending job to running on that client, with a start time (happy)", async () => {
    const { tests } = await database();
    const job = await newJob(tests);
    const serverId = crypto.randomUUID();

    const ran = jarl.unwrap(await tests.runJob(job.id, serverId));

    expect(ran).toMatchObject({ status: "running", serverId });
    expect(ran.startedAt).toBeInstanceOf(Date);
  });

  refusesOtherJobStates("runJob", ["pending"], "pending", (tests, id) =>
    tests.runJob(id, crypto.randomUUID()),
  );
});

describe("completeJob: a running job ran to its end", () => {
  it("moves a running job to completed, with a finish time (happy)", async () => {
    const setup = await database();
    const job = await jobIn(setup, "running");

    const completed = jarl.unwrap(await setup.tests.completeJob(job.id));

    expect(completed.status).toBe("completed");
    expect(completed.finishedAt).toBeInstanceOf(Date);
  });

  refusesOtherJobStates("completeJob", ["running"], "running", (tests, id) =>
    tests.completeJob(id),
  );
});

describe("finalizeJob: a completed drive or mint gets its verdict", () => {
  it.each(["succeeded", "failed"] as const)(
    "moves a completed drive to %s, with its reason (happy)",
    async (status) => {
      const setup = await database();
      const job = await jobIn(setup, "completed");

      const finalized = jarl.unwrap(await setup.tests.finalizeJob(job.id, status, "the proof"));

      expect(finalized).toMatchObject({ status, reason: "the proof" });
    },
  );

  it("finalizes a completed mint (happy)", async () => {
    const setup = await database();
    const mint = await jobIn(setup, "completed", "mint");

    expect(said(await setup.tests.finalizeJob(mint.id, "succeeded", null))).toBe("ok");
  });

  it("refuses a completed diagnose: nothing judges a diagnosis (unhappy)", async () => {
    const setup = await database();
    const diagnose = await jobIn(setup, "completed", "diagnose");

    expect(said(await setup.tests.finalizeJob(diagnose.id, "succeeded", null))).toBe(
      `InvalidState: finalizeJob: job ${diagnose.id} is completed diagnose; needs a completed drive or mint`,
    );
  });

  refusesOtherJobStates("finalizeJob", ["completed"], "a completed drive or mint", (tests, id) =>
    tests.finalizeJob(id, "succeeded", null),
  );
});

describe("errorJob: the system failed the job", () => {
  it.each(["running", "completed"] as const)(
    "moves a %s drive to errored, with its reason (happy)",
    async (status) => {
      const setup = await database();
      const job = await jobIn(setup, status);

      const errored = jarl.unwrap(await setup.tests.errorJob(job.id, "harness died"));

      expect(errored).toMatchObject({ status: "errored", reason: "harness died" });
    },
  );

  it("refuses a completed diagnose: its end is final (unhappy)", async () => {
    const setup = await database();
    const diagnose = await jobIn(setup, "completed", "diagnose");

    expect(said(await setup.tests.errorJob(diagnose.id, "late"))).toBe(
      `InvalidState: errorJob: job ${diagnose.id} is completed diagnose; needs running, or a completed drive or mint`,
    );
  });

  refusesOtherJobStates(
    "errorJob",
    ["running", "completed"],
    "running, or a completed drive or mint",
    (tests, id) => tests.errorJob(id, "harness died"),
  );
});

describe("timeoutJob: a running job ran out of time", () => {
  it("moves a running job to timed_out, with its reason (happy)", async () => {
    const setup = await database();
    const job = await jobIn(setup, "running");

    const timedOut = jarl.unwrap(await setup.tests.timeoutJob(job.id, "no command for 30 minutes"));

    expect(timedOut).toMatchObject({ status: "timed_out", reason: "no command for 30 minutes" });
  });

  refusesOtherJobStates("timeoutJob", ["running"], "running", (tests, id) =>
    tests.timeoutJob(id, "late"),
  );
});

describe("abortJob: a job stopped on purpose before it finished", () => {
  it.each(["pending", "running"] as const)(
    "moves a %s job to aborted, with its reason (happy)",
    async (status) => {
      const setup = await database();
      const job = await jobIn(setup, status);

      const aborted = jarl.unwrap(await setup.tests.abortJob(job.id, "operator"));

      expect(aborted).toMatchObject({ status: "aborted", reason: "operator" });
    },
  );

  it("aborting a diagnose leaves the drive it was judging completed (happy)", async () => {
    const { db, tests } = await database();
    const run = await newRun(tests);
    const drive = await newJob(tests, run.id);
    await setJob(db, drive.id, "completed");
    const diagnose = await newJob(tests, run.id, "diagnose");
    await setJob(db, diagnose.id, "running");

    jarl.unwrap(await tests.abortJob(diagnose.id, "operator"));

    expect(jarl.unwrap(await tests.getJob(drive.id)).status).toBe("completed");
  });

  refusesOtherJobStates("abortJob", ["pending", "running"], "pending or running", (tests, id) =>
    tests.abortJob(id, "operator"),
  );
});

describe("startRun: a test run begins", () => {
  it("moves a pending test run to running (happy)", async () => {
    const { tests } = await database();
    const run = await newRun(tests);

    expect(jarl.unwrap(await tests.startRun(run.id)).status).toBe("running");
  });

  refusesOtherRunStates("startRun", ["pending"], "pending", (tests, id) => tests.startRun(id));
});

describe("completeRun: a test run gets its verdict", () => {
  it.each(["passed", "failed"] as const)(
    "moves a running test run to %s, with its reason and a finish time (happy)",
    async (status) => {
      const setup = await database();
      const run = await runIn(setup, "running");

      const completed = jarl.unwrap(await setup.tests.completeRun(run.id, status, "the proof"));

      expect(completed).toMatchObject({ status, reason: "the proof" });
      expect(completed.finishedAt).toBeInstanceOf(Date);
    },
  );

  it("takes the verdict while the diagnose that decided it is still running (happy)", async () => {
    const setup = await database();
    const run = await runIn(setup, "running");
    const diagnose = await newJob(setup.tests, run.id, "diagnose");
    await setJob(setup.db, diagnose.id, "running");

    expect(said(await setup.tests.completeRun(run.id, "passed", null))).toBe("ok");
  });

  refusesOtherRunStates("completeRun", ["running"], "running", (tests, id) =>
    tests.completeRun(id, "passed", null),
  );
});

describe("errorRun: the test run is given up on", () => {
  it("moves a running test run to errored, with its reason (happy)", async () => {
    const setup = await database();
    const run = await runIn(setup, "running");

    const errored = jarl.unwrap(await setup.tests.errorRun(run.id, "three drives errored"));

    expect(errored).toMatchObject({ status: "errored", reason: "three drives errored" });
  });

  refusesWhileAJobIsOpen("errorRun", (tests, id) => tests.errorRun(id, "given up"));

  refusesOtherRunStates("errorRun", ["running"], "running", (tests, id) =>
    tests.errorRun(id, "given up"),
  );
});

describe("abortRun: a test run stopped on purpose", () => {
  it.each(["pending", "running"] as const)(
    "moves a %s test run to aborted, with its reason (happy)",
    async (status) => {
      const setup = await database();
      const run = await runIn(setup, status);

      const aborted = jarl.unwrap(await setup.tests.abortRun(run.id, "operator"));

      expect(aborted).toMatchObject({ status: "aborted", reason: "operator" });
    },
  );

  refusesWhileAJobIsOpen("abortRun", (tests, id) => tests.abortRun(id, "operator"));

  refusesOtherRunStates("abortRun", ["pending", "running"], "pending or running", (tests, id) =>
    tests.abortRun(id, "operator"),
  );
});

describe("startSuite: a suite begins", () => {
  it("moves a pending suite to running (happy)", async () => {
    const { tests } = await database();
    const suite = await newSuite(tests);

    expect(jarl.unwrap(await tests.startSuite(suite.id)).status).toBe("running");
  });

  refusesOtherSuiteStates("startSuite", ["pending"], "pending", (tests, id) =>
    tests.startSuite(id),
  );
});

describe("completeSuite: a suite gets its verdict", () => {
  it.each(["passed", "failed"] as const)(
    "moves a running suite whose test runs have ended to %s, with its reason and an end time (happy)",
    async (status) => {
      const setup = await database();
      const suite = await newSuite(setup.tests);
      const run = await newRun(setup.tests, suite.id);
      await setRun(setup.db, run.id, status);
      await setSuite(setup.db, suite.id, "running");

      const completed = jarl.unwrap(await setup.tests.completeSuite(suite.id, status, "the runs"));

      expect(completed).toMatchObject({ status, reason: "the runs" });
      expect(completed.endedAt).toBeInstanceOf(Date);
    },
  );

  refusesWhileATestRunIsOpen("completeSuite", (tests, id) =>
    tests.completeSuite(id, "passed", null),
  );

  refusesOtherSuiteStates("completeSuite", ["running"], "running", (tests, id) =>
    tests.completeSuite(id, "passed", null),
  );
});

describe("abortSuite: a suite stopped on purpose", () => {
  it.each(["pending", "running"] as const)(
    "moves a %s suite to aborted, with its reason (happy)",
    async (status) => {
      const setup = await database();
      const suite = await suiteIn(setup, status);

      const aborted = jarl.unwrap(await setup.tests.abortSuite(suite.id, "operator"));

      expect(aborted).toMatchObject({ status: "aborted", reason: "operator" });
    },
  );

  refusesWhileATestRunIsOpen("abortSuite", (tests, id) => tests.abortSuite(id, "operator"));

  refusesOtherSuiteStates("abortSuite", ["pending", "running"], "pending or running", (tests, id) =>
    tests.abortSuite(id, "operator"),
  );
});

// Stamps a job's creation time, so the order among jobs made in one test is known.
const createdAt = (db: Db.Database, id: string, second: number) =>
  db.run((d) =>
    d
      .update(DbSchema.jobs)
      .set({ createdAt: new Date(Date.UTC(2026, 8, 29, 12, 0, second)) })
      .where(eq(DbSchema.jobs.id, id)),
  );

describe("nextPendingJob: the queue", () => {
  it("hands out every mint first, then every diagnose, then every drive, oldest first within each (happy)", async () => {
    const setup = await database();
    const queued: Array<[Tests.JobAction, number]> = [
      ["drive", 1],
      ["diagnose", 2],
      ["mint", 3],
      ["drive", 0],
      ["mint", 4],
      ["diagnose", 5],
    ];
    const ids = new Map<string, string>();
    for (const [action, second] of queued) {
      const job = await newJob(setup.tests, undefined, action);
      await createdAt(setup.db, job.id, second);
      ids.set(job.id, `${action} ${String(second)}`);
    }

    const handed: Array<string | undefined> = [];
    for (let next = jarl.unwrap(await setup.tests.nextPendingJob([])); next !== undefined;) {
      handed.push(ids.get(next.id));
      await setJob(setup.db, next.id, "running");
      next = jarl.unwrap(await setup.tests.nextPendingJob([]));
    }

    expect(handed).toEqual(["mint 3", "mint 4", "diagnose 2", "diagnose 5", "drive 0", "drive 1"]);
  });

  it("skips the jobs it is told to skip (happy)", async () => {
    const { db, tests } = await database();
    const older = await newJob(tests);
    const newer = await newJob(tests);
    await createdAt(db, older.id, 0);
    await createdAt(db, newer.id, 1);

    expect(jarl.unwrap(await tests.nextPendingJob([older.id]))?.id).toBe(newer.id);
  });

  it("hands out nothing when no job is pending (unhappy)", async () => {
    const setup = await database();
    await jobIn(setup, "running");

    expect(jarl.unwrap(await setup.tests.nextPendingJob([]))).toBeUndefined();
  });
});

describe("latestJob: the newest job of one action on a test run", () => {
  it("is the newest drive, not the first (happy)", async () => {
    const { db, tests } = await database();
    const run = await newRun(tests);
    const first = await newJob(tests, run.id);
    await setJob(db, first.id, "failed");
    const again = await newJob(tests, run.id);
    await createdAt(db, first.id, 0);
    await createdAt(db, again.id, 1);

    expect(jarl.unwrap(await tests.latestJob(run.id, "drive"))?.id).toBe(again.id);
  });

  it("is nothing when the test run has no job of that action (unhappy)", async () => {
    const { tests } = await database();
    const run = await newRun(tests);
    await newJob(tests, run.id);

    expect(jarl.unwrap(await tests.latestJob(run.id, "mint"))).toBeUndefined();
  });
});

describe("a suite's test runs, counted by status", () => {
  it("counts them the same in getTestSuite and listTestSuites (happy)", async () => {
    const { db, tests } = await database();
    const suite = await newSuite(tests);
    const statuses: ReadonlyArray<RunStatus> = ["pending", "running", "passed", "passed", "failed"];
    for (const [index, status] of statuses.entries()) {
      const run = await newRun(tests, suite.id, `test-${String(index)}`);
      await setRun(db, run.id, status);
    }
    const counted = {
      pending: 1,
      running: 1,
      passed: 2,
      failed: 1,
      aborted: 0,
      errored: 0,
      completed: 0,
      timed_out: 0,
    };

    expect(jarl.unwrap(await tests.getTestSuite(suite.id)).runs).toEqual(counted);
    expect(
      jarl.unwrap(await tests.listTestSuites(10)).find((listed) => listed.id === suite.id)?.runs,
    ).toEqual(counted);
  });
});

const MISSING = "00000000-0000-4000-8000-000000000000";

describe("a row that does not exist", () => {
  it.each([
    ["createTestRun", "test suite", (tests: Store) => tests.createTestRun(MISSING, 1)],
    ["createJob", "test run", (tests: Store) => tests.createJob(MISSING, "drive")],
    ["runJob", "job", (tests: Store) => tests.runJob(MISSING, MISSING)],
    ["completeJob", "job", (tests: Store) => tests.completeJob(MISSING)],
    ["finalizeJob", "job", (tests: Store) => tests.finalizeJob(MISSING, "succeeded", null)],
    ["errorJob", "job", (tests: Store) => tests.errorJob(MISSING, "x")],
    ["timeoutJob", "job", (tests: Store) => tests.timeoutJob(MISSING, "x")],
    ["abortJob", "job", (tests: Store) => tests.abortJob(MISSING, "x")],
    ["startRun", "test run", (tests: Store) => tests.startRun(MISSING)],
    ["completeRun", "test run", (tests: Store) => tests.completeRun(MISSING, "passed", null)],
    ["errorRun", "test run", (tests: Store) => tests.errorRun(MISSING, "x")],
    ["abortRun", "test run", (tests: Store) => tests.abortRun(MISSING, "x")],
    ["startSuite", "test suite", (tests: Store) => tests.startSuite(MISSING)],
    ["completeSuite", "test suite", (tests: Store) => tests.completeSuite(MISSING, "passed", null)],
    ["abortSuite", "test suite", (tests: Store) => tests.abortSuite(MISSING, "x")],
    ["getTestSuite", "test suite", (tests: Store) => tests.getTestSuite(MISSING)],
    ["getTestSuiteDetails", "test suite", (tests: Store) => tests.getTestSuiteDetails(MISSING)],
    ["getTestRun", "test run", (tests: Store) => tests.getTestRun(MISSING)],
    ["getTestRunDetails", "test run", (tests: Store) => tests.getTestRunDetails(MISSING)],
    ["getJob", "job", (tests: Store) => tests.getJob(MISSING)],
    ["getJobDetails", "job", (tests: Store) => tests.getJobDetails(MISSING)],
  ] as const)("%s refuses a %s that does not exist (unhappy)", async (fn, noun, call) => {
    const { tests } = await database();

    expect(said(await call(tests))).toBe(`NotFound: ${fn}: no ${noun} ${MISSING}`);
  });
});
