import { isDeepStrictEqual } from "node:util";
import * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { eq, sql } from "drizzle-orm";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Tests from "../src/tests.ts";
import { database } from "./support.ts";

type Store = Tests.Tests;
type Setup = Awaited<ReturnType<typeof database>>;
type Outcome = Promise<jarl.Result<{ readonly status: string }, Error>>;
type Move = (tests: Store, id: string) => Outcome;
type SuiteStatus = Tests.SuiteRow["status"];

const ENDED_JOB_STATES = ["succeeded", "failed", "errored", "timed_out", "aborted"] as const;
const ENDED_RUN_STATES = DbSchema.testRunStatus.enumValues.filter(
  (status) => status !== "pending" && status !== "running",
);
const ENDED_SUITE_STATES = DbSchema.testSuiteStatus.enumValues.filter(
  (status) => status !== "pending" && status !== "running",
);

const SERVER = "11111111-1111-4111-8111-111111111111";
const MODEL = "meta/muse-spark-1.3-contributor";
const MISSING = "00000000-0000-4000-8000-000000000000";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

// What a call came to, in one line: ok, or the refusal's name and what it said, ids as <id>.
const said = (result: jarl.Result<unknown, Error>) =>
  jarl.is_ok(result)
    ? "ok"
    : `${result.error.name}: ${result.error.message.replaceAll(UUID, "<id>")}`;

const SUITE = { iso: "https://iso.omarchy.org/omarchy-4.0.4.iso", serverUrl: "http://qemu-1" };

const SINGLE = { iso: "https://iso.omarchy.org/omarchy-4.1.0.iso", serverUrl: "http://qemu-2" };

const definition = async (tests: Store, name = "lock-screen", resume = true) =>
  jarl.unwrap(
    await tests.defineTestDefinition({ name, description: "", instruction: "", proof: "", resume }),
  ).id;

// A suite of the named definitions, written whole.
const newSuite = async (tests: Store, names: ReadonlyArray<string> = ["lock-screen"]) => {
  const definitionIds: Array<number> = [];
  for (const name of names) {
    definitionIds.push(await definition(tests, name));
  }
  return jarl.unwrap(await tests.createTestSuite({ ...SUITE, definitionIds }));
};

// A test run on its own, with the drive it was filed with.
const newRun = async (tests: Store, name?: string) =>
  jarl.unwrap(
    await tests.createTestRun({ definitionId: await definition(tests, name), ...SINGLE }),
  );

// A job on a test run of its own: that run's drive, or a job of another action after the drive
// was aborted.
const newJob = async (tests: Store, action: Tests.JobAction = "drive") => {
  const { run, job } = await newRun(tests);
  if (action === "drive") {
    return job;
  }
  jarl.unwrap(await tests.abortJob(job.id, "making way"));
  return jarl.unwrap(await tests.createJob(run.id, action));
};

// Puts a row straight into a state, so a test starts from any state without walking there.
const setJob = (db: Db.Database, id: string, status: Tests.JobStatus) =>
  db.run((d) => d.update(DbSchema.jobs).set({ status }).where(eq(DbSchema.jobs.id, id)));
const setRun = (db: Db.Database, id: string, status: Tests.RunStatus) =>
  db.run((d) => d.update(DbSchema.testRuns).set({ status }).where(eq(DbSchema.testRuns.id, id)));
const setSuite = (db: Db.Database, id: string, status: SuiteStatus) =>
  db.run((d) =>
    d.update(DbSchema.testSuites).set({ status }).where(eq(DbSchema.testSuites.id, id)),
  );

// Every insert into jobs fails from here on, so a write that reaches it must roll back.
const refuseJobs = async (db: Db.Database) => {
  jarl.unwrap(
    await db.run((d) =>
      d.execute(
        sql.raw(
          "create function refuse_jobs() returns trigger language plpgsql as $$ begin raise exception 'jobs refused by the test'; end $$",
        ),
      ),
    ),
  );
  jarl.unwrap(
    await db.run((d) =>
      d.execute(
        sql.raw(
          "create trigger refuse_jobs before insert on jobs for each row execute function refuse_jobs()",
        ),
      ),
    ),
  );
};

// Every update of a setup lock fails from here on, so naming a job on one must roll the run back.
const refuseLockJob = async (db: Db.Database) => {
  jarl.unwrap(
    await db.run((d) =>
      d.execute(
        sql.raw(
          "create function refuse_lock_job() returns trigger language plpgsql as $$ begin raise exception 'setup lock refused by the test'; end $$",
        ),
      ),
    ),
  );
  jarl.unwrap(
    await db.run((d) =>
      d.execute(
        sql.raw(
          "create trigger refuse_lock_job before update on setup_requests for each row execute function refuse_lock_job()",
        ),
      ),
    ),
  );
};

const counted = async (db: Db.Database) =>
  jarl.unwrap(
    await db.run(async (d) => ({
      suites: await d.$count(DbSchema.testSuites),
      runs: await d.$count(DbSchema.testRuns),
      jobs: await d.$count(DbSchema.jobs),
    })),
  );

const jobIn = async (setup: Setup, status: Tests.JobStatus, action: Tests.JobAction = "drive") => {
  const job = await newJob(setup.tests, action);
  await setJob(setup.db, job.id, status);
  return job;
};
// A test run in a state, its drive aborted so no job holds it.
const runIn = async (setup: Setup, status: Tests.RunStatus) => {
  const { run, job } = await newRun(setup.tests);
  await setJob(setup.db, job.id, "aborted");
  await setRun(setup.db, run.id, status);
  return run;
};
// A suite in a state, its one test run passed so no test run holds it.
const suiteIn = async (setup: Setup, status: SuiteStatus) => {
  const { suite, runs } = await newSuite(setup.tests);
  for (const listed of runs) {
    await setRun(setup.db, listed.run.id, "passed");
  }
  await setSuite(setup.db, suite.id, status);
  return suite;
};

// Tries each move on a fresh row from `make`. An accepted move reads as the state it left its
// row in; a refusal as what it said, or CHANGED if it moved the row all the same.
const tryEach = async (
  setup: Setup,
  moves: Readonly<Record<string, Move>>,
  make: () => Promise<string>,
  read: (id: string) => Promise<unknown>,
) => {
  const seen: Record<string, string> = {};
  for (const [name, move] of Object.entries(moves)) {
    const id = await make();
    const before = await read(id);
    const result = await move(setup.tests, id);
    if (jarl.is_ok(result)) {
      seen[name] = jarl.value(result).status;
    } else {
      seen[name] = isDeepStrictEqual(await read(id), before) ? said(result) : "CHANGED";
    }
  }
  return seen;
};

// Every move of a level, each refused as `what` needing its state, but for those accepted.
const expected = (
  needs: Readonly<Record<string, string>>,
  what: string,
  accepted: Readonly<Record<string, string>> = {},
) =>
  Object.fromEntries(
    Object.entries(needs).map(([fn, need]) => [
      fn,
      accepted[fn] ?? `InvalidState: ${fn}: ${what}; needs ${need}`,
    ]),
  );

const JOB_MOVES: Readonly<Record<string, Move>> = {
  runJob: (tests, id) => tests.runJob(id, SERVER),
  completeJob: (tests, id) => tests.completeJob(id),
  finalizeJob: (tests, id) => tests.finalizeJob(id, "succeeded", null),
  errorJob: (tests, id) => tests.errorJob(id, "harness died"),
  timeoutJob: (tests, id) => tests.timeoutJob(id, "no command for 30 minutes"),
  abortJob: (tests, id) => tests.abortJob(id, "operator"),
};
const JOB_NEEDS = {
  runJob: "pending",
  completeJob: "running",
  finalizeJob: "a completed drive or setup",
  errorJob: "running, or a completed drive or setup",
  timeoutJob: "running",
  abortJob: "pending or running",
};

// What a test run's own moves meet while it holds one job in a state.
const RUN_MOVES_WITH_A_JOB: Readonly<Record<string, Move>> = {
  createJob: (tests, id) => tests.createJob(id, "diagnose"),
  errorRun: (tests, id) => tests.errorRun(id, "given up"),
  timeoutRun: (tests, id) => tests.timeoutRun(id, "run ceiling of 60000 ms passed"),
  abortRun: (tests, id) => tests.abortRun(id, "operator"),
};

const RUN_MOVES: Readonly<Record<string, Move>> = {
  startRun: (tests, id) => tests.startRun(id, MODEL),
  completeRun: (tests, id) => tests.completeRun(id, "passed", null),
  errorRun: (tests, id) => tests.errorRun(id, "given up"),
  timeoutRun: (tests, id) => tests.timeoutRun(id, "run ceiling of 60000 ms passed"),
  abortRun: (tests, id) => tests.abortRun(id, "operator"),
  createJob: (tests, id) => tests.createJob(id, "drive"),
};
const RUN_NEEDS = {
  startRun: "pending",
  completeRun: "running",
  errorRun: "running",
  timeoutRun: "running",
  abortRun: "pending or running",
  createJob: "pending or running",
};

// What a suite's own moves meet while it holds one test run in a state.
const SUITE_MOVES_WITH_A_RUN: Readonly<Record<string, Move>> = {
  completeSuite: (tests, id) => tests.completeSuite(id, "passed", null),
  abortSuite: (tests, id) => tests.abortSuite(id, "operator"),
};

const SUITE_MOVES: Readonly<Record<string, Move>> = SUITE_MOVES_WITH_A_RUN;
const SUITE_NEEDS = {
  completeSuite: "running",
  abortSuite: "pending or running",
};

const jobMoves = (setup: Setup, status: Tests.JobStatus, action: Tests.JobAction = "drive") =>
  tryEach(
    setup,
    JOB_MOVES,
    async () => (await jobIn(setup, status, action)).id,
    (id) => setup.tests.getJob(id),
  );

const runMovesWithAJob = (setup: Setup, status: Tests.JobStatus) =>
  tryEach(
    setup,
    RUN_MOVES_WITH_A_JOB,
    async () => {
      const { run, job } = await newRun(setup.tests);
      await setRun(setup.db, run.id, "running");
      await setJob(setup.db, job.id, status);
      return run.id;
    },
    (id) => setup.tests.getTestRunDetails(id),
  );

const runMoves = (setup: Setup, status: Tests.RunStatus) =>
  tryEach(
    setup,
    RUN_MOVES,
    async () => (await runIn(setup, status)).id,
    (id) => setup.tests.getTestRunDetails(id),
  );

const suiteMovesWithARun = (setup: Setup, status: Tests.RunStatus) =>
  tryEach(
    setup,
    SUITE_MOVES_WITH_A_RUN,
    async () => {
      const { suite, runs } = await newSuite(setup.tests);
      for (const listed of runs) {
        await setRun(setup.db, listed.run.id, status);
      }
      return suite.id;
    },
    (id) => setup.tests.getTestSuiteDetails(id),
  );

const suiteMoves = (setup: Setup, status: SuiteStatus) =>
  tryEach(
    setup,
    SUITE_MOVES,
    async () => (await suiteIn(setup, status)).id,
    (id) => setup.tests.getTestSuiteDetails(id),
  );

const heldByJob = (status: string) =>
  Object.fromEntries(
    Object.keys(RUN_MOVES_WITH_A_JOB).map((fn) => [
      fn,
      `InvalidState: ${fn}: test run <id> has job <id> ${status}; needs no pending or running job`,
    ]),
  );

const heldByRun = (status: string) =>
  Object.fromEntries(
    Object.keys(SUITE_MOVES_WITH_A_RUN).map((fn) => [
      fn,
      `InvalidState: ${fn}: test suite <id> has test run <id> ${status}; needs no pending or running test run`,
    ]),
  );

// Stamps a job's creation time, so the order among jobs made in one test is known.
const createdAt = (db: Db.Database, id: string, second: number) =>
  db.run((d) =>
    d
      .update(DbSchema.jobs)
      .set({ createdAt: new Date(Date.UTC(2026, 8, 29, 12, 0, second)) })
      .where(eq(DbSchema.jobs.id, id)),
  );

describe("a suite's name", () => {
  it("is the version in its ISO's file name (happy)", () => {
    expect(Tests.suiteName("https://iso.omarchy.org/omarchy-4.0.4.iso")).toBe("4.0.4");
  });

  it("is the whole ISO url when its file name names no version, whatever its host (unhappy)", () => {
    const iso = "http://10.0.0.5:8080/omarchy-latest.iso";
    expect(Tests.suiteName(iso)).toBe(iso);
  });
});

describe("a test, start to finish", () => {
  it("its suite is written running with its drive queued; it starts on its model, its drive completes, its diagnose passes it, and the suite passes (happy)", async () => {
    const { tests } = await database();
    const trail: Array<string> = [];
    const step = async <T extends { readonly status: string }>(
      label: string,
      result: Promise<jarl.Result<T, Error>>,
    ) => {
      const row = jarl.unwrap(await result);
      trail.push(`${label} ${row.status}`);
      return row;
    };

    const filed = jarl.unwrap(
      await tests.createTestSuite({ ...SUITE, definitionIds: [await definition(tests)] }),
    );
    const [listed] = filed.runs;
    const run = listed?.run;
    const drive = listed?.jobs[0];
    if (run === undefined || drive === undefined) {
      throw new Error("the suite was written without its test run and drive");
    }
    trail.push(
      `createTestSuite ${filed.suite.status}, its run ${run.status}, its drive ${drive.status}`,
    );
    const queued = jarl.unwrap(await tests.nextPendingJob());
    await step("startRun", tests.startRun(run.id, MODEL));
    await step("runJob drive", tests.runJob(drive.id, SERVER));
    await step("completeJob drive", tests.completeJob(drive.id));
    const diagnose = await step("createJob diagnose", tests.createJob(run.id, "diagnose"));
    await step("runJob diagnose", tests.runJob(diagnose.id, SERVER));
    await step("finalizeJob drive", tests.finalizeJob(drive.id, "succeeded", null));
    await step("completeRun", tests.completeRun(run.id, "passed", null));
    await step("completeJob diagnose", tests.completeJob(diagnose.id));
    await step("completeSuite", tests.completeSuite(filed.suite.id, "passed", null));

    expect(queued?.id).toBe(drive.id);
    expect(trail).toEqual([
      "createTestSuite running, its run pending, its drive pending",
      "startRun running",
      "runJob drive running",
      "completeJob drive completed",
      "createJob diagnose pending",
      "runJob diagnose running",
      "finalizeJob drive succeeded",
      "completeRun passed",
      "completeJob diagnose completed",
      "completeSuite passed",
    ]);
    expect(
      jarl
        .unwrap(await tests.getTestRunDetails(run.id))
        .jobs.map((job) => `${job.action} ${job.status}`),
    ).toEqual(["drive succeeded", "diagnose completed"]);
    expect(jarl.unwrap(await tests.getTestRun(run.id)).model).toBe(MODEL);
    expect(filed.suite.name).toBe("4.0.4");
    const details = jarl.unwrap(await tests.getJobDetails(drive.id));
    expect({
      suite: details.suite?.id,
      iso: details.run.iso,
      serverUrl: details.run.serverUrl,
      resume: details.definition.resume,
    }).toEqual({ suite: filed.suite.id, ...SUITE, resume: true });
  });
});

describe("a suite, written whole", () => {
  it("holds a test run for each definition named, a definition as often as named, each with one pending drive, and reads back the same (happy)", async () => {
    const { tests } = await database();
    const lockScreen = await definition(tests, "lock-screen");
    const wifi = await definition(tests, "wifi");

    const filed = jarl.unwrap(
      await tests.createTestSuite({ ...SUITE, definitionIds: [lockScreen, wifi, lockScreen] }),
    );

    expect(
      filed.runs.map(({ run, test, jobs }) => ({
        test,
        status: run.status,
        iso: run.iso,
        serverUrl: run.serverUrl,
        jobs: jobs.map((job) => `${job.action} ${job.status}`),
      })),
    ).toEqual(
      ["lock-screen", "wifi", "lock-screen"].map((test) => ({
        test,
        status: "pending",
        ...SUITE,
        jobs: ["drive pending"],
      })),
    );
    expect(jarl.unwrap(await tests.getTestSuiteDetails(filed.suite.id))).toEqual(filed);
  });

  it("naming a definition that does not exist is refused, and nothing is written or queued (unhappy)", async () => {
    const { db, tests } = await database();
    const lockScreen = await definition(tests);

    const refused = await tests.createTestSuite({ ...SUITE, definitionIds: [lockScreen, 999] });

    expect(said(refused)).toBe("NotFound: createTestSuite: no test definition 999");
    expect(await counted(db)).toEqual({ suites: 0, runs: 0, jobs: 0 });
    expect(jarl.unwrap(await tests.nextPendingJob())).toBeUndefined();
  });

  it("naming no definitions is refused, and nothing is written (unhappy)", async () => {
    const { db, tests } = await database();

    const refused = await tests.createTestSuite({ ...SUITE, definitionIds: [] });

    expect(said(refused)).toBe("InvalidState: createTestSuite: needs at least one test definition");
    expect(await counted(db)).toEqual({ suites: 0, runs: 0, jobs: 0 });
  });

  it("when its drives cannot be written, it is the database's error and none of it is left: no suite, no test run (unhappy)", async () => {
    const { db, tests } = await database();
    const lockScreen = await definition(tests);
    await refuseJobs(db);

    const failed = await tests.createTestSuite({ ...SUITE, definitionIds: [lockScreen] });

    expect(jarl.error.is(failed, Db.DatabaseError)).toBe(true);
    expect(said(failed)).toMatch(/jobs refused by the test/);
    expect(await counted(db)).toEqual({ suites: 0, runs: 0, jobs: 0 });
  });
});

describe("a single test run, with no suite", () => {
  it("is written with its pending drive, carries its own iso and server, is queued and takes its verdict; nothing names a suite (happy)", async () => {
    const { tests } = await database();

    const { run, job: drive } = jarl.unwrap(
      await tests.createTestRun({ definitionId: await definition(tests), ...SINGLE }),
    );
    const queued = jarl.unwrap(await tests.nextPendingJob());
    jarl.unwrap(await tests.startRun(run.id, MODEL));
    jarl.unwrap(await tests.runJob(drive.id, SERVER));
    jarl.unwrap(await tests.completeJob(drive.id));
    jarl.unwrap(await tests.finalizeJob(drive.id, "succeeded", null));
    const closed = jarl.unwrap(await tests.completeRun(run.id, "passed", null));

    expect(`${drive.action} ${drive.status}`).toBe("drive pending");
    expect(queued?.id).toBe(drive.id);
    expect(closed.status).toBe("passed");
    expect({ suiteId: run.suiteId, iso: run.iso, serverUrl: run.serverUrl }).toEqual({
      suiteId: null,
      ...SINGLE,
    });
    expect(jarl.unwrap(await tests.getTestRun(run.id)).suite).toBeNull();
    expect(jarl.unwrap(await tests.getTestRunDetails(run.id)).suite).toBeNull();
    expect(jarl.unwrap(await tests.getJobDetails(drive.id)).suite).toBeNull();
  });

  it("when its drive cannot be written, it is the database's error and no test run is left (unhappy)", async () => {
    const { db, tests } = await database();
    const lockScreen = await definition(tests);
    await refuseJobs(db);

    const failed = await tests.createTestRun({ definitionId: lockScreen, ...SINGLE });

    expect(jarl.error.is(failed, Db.DatabaseError)).toBe(true);
    expect(await counted(db)).toEqual({ suites: 0, runs: 0, jobs: 0 });
  });
});

const QEMU_A = "http://qemu-a";
const QEMU_B = "http://qemu-b";

describe("a setup definition is filed with a setup job", () => {
  it("a single setup run names the job on the server's lock and queues that setup (happy)", async () => {
    const { tests, setupRequests } = await database();
    const setupId = await definition(tests, "setup");
    jarl.unwrap(await setupRequests.insert(SINGLE.iso, QEMU_A));

    const { run, job } = jarl.unwrap(
      await tests.createTestRun({ definitionId: setupId, ...SINGLE, setupServer: QEMU_A }),
    );
    const queued = jarl.unwrap(await tests.nextPendingJob());

    expect(`${job.action} ${job.status}`).toBe("setup pending");
    expect(queued?.id).toBe(job.id);
    expect(jarl.unwrap(await setupRequests.inspect(SINGLE.iso, QEMU_A))?.jobId).toBe(job.id);
    expect({ suiteId: run.suiteId, iso: run.iso, serverUrl: run.serverUrl }).toEqual({
      suiteId: null,
      ...SINGLE,
    });
  });

  it("a setup suite claims one lock per server and queues a setup job for each (happy)", async () => {
    const { tests, setupRequests } = await database();
    const setupId = await definition(tests, "setup");

    const filed = jarl.unwrap(
      await tests.createTestSuite({
        ...SUITE,
        definitionIds: [setupId, setupId],
        setupServers: [QEMU_A, QEMU_B],
      }),
    );
    const queued = jarl.unwrap(await tests.nextPendingJob());
    const [first, second] = filed.runs;

    expect(filed.suite.status).toBe("running");
    expect(
      filed.runs.map(({ test, jobs }) => ({
        test,
        jobs: jobs.map((job) => `${job.action} ${job.status}`),
      })),
    ).toEqual([
      { test: "setup", jobs: ["setup pending"] },
      { test: "setup", jobs: ["setup pending"] },
    ]);
    expect(jarl.unwrap(await setupRequests.inspect(SUITE.iso, QEMU_A))?.jobId).toBe(
      first?.jobs[0]?.id,
    );
    expect(jarl.unwrap(await setupRequests.inspect(SUITE.iso, QEMU_B))?.jobId).toBe(
      second?.jobs[0]?.id,
    );
    expect(queued?.id).toBe(first?.jobs[0]?.id);
    expect(jarl.unwrap(await tests.getTestSuiteDetails(filed.suite.id))).toEqual(filed);
  });

  it("a setup run with no server is refused, and nothing is written (unhappy)", async () => {
    const { db, tests } = await database();
    const setupId = await definition(tests, "setup");

    const refused = await tests.createTestRun({ definitionId: setupId, ...SINGLE });

    expect(said(refused)).toBe(
      "InvalidState: createTestRun: a setup needs the server whose lock it takes",
    );
    expect(await counted(db)).toEqual({ suites: 0, runs: 0, jobs: 0 });
  });

  it("a setup run whose lock was never inserted is refused, and nothing is written (unhappy)", async () => {
    const { db, tests, setupRequests } = await database();
    const setupId = await definition(tests, "setup");

    const refused = await tests.createTestRun({
      definitionId: setupId,
      ...SINGLE,
      setupServer: QEMU_A,
    });

    expect(said(refused)).toBe(
      `NotFound: createTestRun: no setup lock for ${SINGLE.iso} on ${QEMU_A}`,
    );
    expect(await counted(db)).toEqual({ suites: 0, runs: 0, jobs: 0 });
    expect(jarl.unwrap(await setupRequests.list())).toEqual([]);
  });

  it("a setup run whose lock already has a job is refused, and that job stays (unhappy)", async () => {
    const { db, tests, setupRequests } = await database();
    const setupId = await definition(tests, "setup");
    jarl.unwrap(await setupRequests.insert(SINGLE.iso, QEMU_A));
    jarl.unwrap(await setupRequests.setJob(SINGLE.iso, QEMU_A, MISSING));

    const refused = await tests.createTestRun({
      definitionId: setupId,
      ...SINGLE,
      setupServer: QEMU_A,
    });

    expect(said(refused)).toBe(
      `InvalidState: createTestRun: setup lock for ${SINGLE.iso} on ${QEMU_A} already has a job`,
    );
    expect(await counted(db)).toEqual({ suites: 0, runs: 0, jobs: 0 });
    expect(jarl.unwrap(await setupRequests.inspect(SINGLE.iso, QEMU_A))?.jobId).toBe(MISSING);
  });

  it("a drive that names a setup server is refused, and the lock is left alone (unhappy)", async () => {
    const { db, tests, setupRequests } = await database();
    const wifi = await definition(tests, "wifi");
    jarl.unwrap(await setupRequests.insert(SINGLE.iso, QEMU_A));

    const refused = await tests.createTestRun({
      definitionId: wifi,
      ...SINGLE,
      setupServer: QEMU_A,
    });

    expect(said(refused)).toBe("InvalidState: createTestRun: a drive names no setup server");
    expect(await counted(db)).toEqual({ suites: 0, runs: 0, jobs: 0 });
    expect(jarl.unwrap(await setupRequests.inspect(SINGLE.iso, QEMU_A))?.jobId).toBeNull();
  });

  it("when the lock cannot take the job, it is the database's error and no run or job is left (unhappy)", async () => {
    const { db, tests, setupRequests } = await database();
    const setupId = await definition(tests, "setup");
    jarl.unwrap(await setupRequests.insert(SINGLE.iso, QEMU_A));
    await refuseLockJob(db);

    const failed = await tests.createTestRun({
      definitionId: setupId,
      ...SINGLE,
      setupServer: QEMU_A,
    });

    expect(jarl.error.is(failed, Db.DatabaseError)).toBe(true);
    expect(said(failed)).toMatch(/setup lock refused by the test/);
    expect(await counted(db)).toEqual({ suites: 0, runs: 0, jobs: 0 });
    expect(jarl.unwrap(await setupRequests.inspect(SINGLE.iso, QEMU_A))?.jobId).toBeNull();
  });

  it("a suite of a setup and a drive is refused, and nothing is written (unhappy)", async () => {
    const { db, tests } = await database();
    const setupId = await definition(tests, "setup");
    const wifi = await definition(tests, "wifi");

    const refused = await tests.createTestSuite({
      ...SUITE,
      definitionIds: [setupId, wifi],
    });

    expect(said(refused)).toBe(
      "InvalidState: createTestSuite: a setup definition and a drive definition cannot share a suite",
    );
    expect(await counted(db)).toEqual({ suites: 0, runs: 0, jobs: 0 });
  });

  it("a setup suite with no server for a run is refused, and nothing is written (unhappy)", async () => {
    const { db, tests, setupRequests } = await database();
    const setupId = await definition(tests, "setup");

    const omitted = await tests.createTestSuite({ ...SUITE, definitionIds: [setupId] });
    const short = await tests.createTestSuite({
      ...SUITE,
      definitionIds: [setupId, setupId],
      setupServers: [QEMU_A],
    });

    expect(said(omitted)).toBe(
      "InvalidState: createTestSuite: a setup suite needs one server per test run",
    );
    expect(said(short)).toBe(
      "InvalidState: createTestSuite: a setup suite needs one server per test run",
    );
    expect(await counted(db)).toEqual({ suites: 0, runs: 0, jobs: 0 });
    expect(jarl.unwrap(await setupRequests.list())).toEqual([]);
  });

  it("a drive suite that names setup servers is refused, and nothing is written (unhappy)", async () => {
    const { db, tests } = await database();
    const wifi = await definition(tests, "wifi");

    const refused = await tests.createTestSuite({
      ...SUITE,
      definitionIds: [wifi],
      setupServers: [QEMU_A],
    });

    expect(said(refused)).toBe(
      "InvalidState: createTestSuite: a drive suite names no setup server",
    );
    expect(await counted(db)).toEqual({ suites: 0, runs: 0, jobs: 0 });
  });

  it("a setup suite whose server a live setup holds is refused, and that lock stays (unhappy)", async () => {
    const { db, tests, setupRequests } = await database();
    const setupId = await definition(tests, "setup");
    const held = await newJob(tests, "setup");
    jarl.unwrap(await setupRequests.claim(SUITE.iso, QEMU_B, held.id));
    const before = await counted(db);

    const refused = await tests.createTestSuite({
      ...SUITE,
      definitionIds: [setupId, setupId],
      setupServers: [QEMU_A, QEMU_B],
    });

    expect(said(refused)).toBe(
      `InvalidState: createTestSuite: ${QEMU_B} did not take its setup lock`,
    );
    expect(await counted(db)).toEqual(before);
    expect(jarl.unwrap(await setupRequests.inspect(SUITE.iso, QEMU_A))).toBeUndefined();
    expect(jarl.unwrap(await setupRequests.inspect(SUITE.iso, QEMU_B))?.jobId).toBe(held.id);
  });
});

describe("a job, state by state", () => {
  it("pending: it runs or is aborted, refuses every other move, and holds its test run (unhappy)", async () => {
    const setup = await database();

    expect(await jobMoves(setup, "pending")).toEqual(
      expected(JOB_NEEDS, "job <id> is pending drive", { runJob: "running", abortJob: "aborted" }),
    );
    expect(await runMovesWithAJob(setup, "pending")).toEqual(heldByJob("pending"));
  });

  it("running: it completes, errors, times out or is aborted, refuses running again, and holds its test run (unhappy)", async () => {
    const setup = await database();
    const job = await jobIn(setup, "running");

    expect(await jobMoves(setup, "running")).toEqual(
      expected(JOB_NEEDS, "job <id> is running drive", {
        completeJob: "completed",
        errorJob: "errored",
        timeoutJob: "timed_out",
        abortJob: "aborted",
      }),
    );
    expect(await runMovesWithAJob(setup, "running")).toEqual(heldByJob("running"));
    expect(
      jarl.unwrap(await setup.tests.errorJob(job.id, "harness died")).finishedAt,
    ).toBeInstanceOf(Date);
  });

  it("completed drive: it is finalized or errored, keeping its finish time, refuses the rest, and no longer holds its test run (unhappy)", async () => {
    const setup = await database();
    const ended = new Date(Date.UTC(2026, 8, 29, 12, 8));
    const drive = await jobIn(setup, "completed");
    await setup.db.run((d) =>
      d.update(DbSchema.jobs).set({ finishedAt: ended }).where(eq(DbSchema.jobs.id, drive.id)),
    );
    const diagnose = jarl.unwrap(await setup.tests.createJob(drive.runId, "diagnose"));
    await setJob(setup.db, diagnose.id, "running");

    expect(await jobMoves(setup, "completed")).toEqual(
      expected(JOB_NEEDS, "job <id> is completed drive", {
        finalizeJob: "succeeded",
        errorJob: "errored",
      }),
    );
    expect(await runMovesWithAJob(setup, "completed")).toEqual({
      createJob: "pending",
      errorRun: "errored",
      timeoutRun: "timed_out",
      abortRun: "aborted",
    });
    jarl.unwrap(await setup.tests.abortJob(diagnose.id, "operator"));
    expect(jarl.unwrap(await setup.tests.getJob(drive.id)).status).toBe("completed");
    expect(
      jarl.unwrap(await setup.tests.errorJob(drive.id, "the guest lost its network")).finishedAt,
    ).toEqual(ended);
  });

  it("completed diagnose: nothing moves it, since nothing judges a diagnosis (unhappy)", async () => {
    const setup = await database();

    expect(await jobMoves(setup, "completed", "diagnose")).toEqual(
      expected(JOB_NEEDS, "job <id> is completed diagnose"),
    );
  });

  it("succeeded, failed, errored, timed out or aborted: nothing moves it, and its test run takes a new job (unhappy)", async () => {
    const setup = await database();

    for (const status of ENDED_JOB_STATES) {
      expect(await jobMoves(setup, status), status).toEqual(
        expected(JOB_NEEDS, `job <id> is ${status} drive`),
      );
      expect(await runMovesWithAJob(setup, status), status).toEqual({
        createJob: "pending",
        errorRun: "errored",
        timeoutRun: "timed_out",
        abortRun: "aborted",
      });
    }
  });
});

describe("a test run, state by state", () => {
  it("pending: it starts, is aborted or takes a job, refuses the rest, and holds its suite (unhappy)", async () => {
    const setup = await database();

    expect(await runMoves(setup, "pending")).toEqual(
      expected(RUN_NEEDS, "test run <id> is pending", {
        startRun: "running",
        abortRun: "aborted",
        createJob: "pending",
      }),
    );
    expect(await suiteMovesWithARun(setup, "pending")).toEqual(heldByRun("pending"));
  });

  it("running: it takes its verdict, errors, times out, is aborted or takes a job, refuses starting again, and holds its suite (unhappy)", async () => {
    const setup = await database();

    expect(await runMoves(setup, "running")).toEqual(
      expected(RUN_NEEDS, "test run <id> is running", {
        completeRun: "passed",
        errorRun: "errored",
        timeoutRun: "timed_out",
        abortRun: "aborted",
        createJob: "pending",
      }),
    );
    expect(await suiteMovesWithARun(setup, "running")).toEqual(heldByRun("running"));
  });

  it("ended: nothing moves it, it takes no job, and its suite can end (unhappy)", async () => {
    const setup = await database();

    for (const status of ENDED_RUN_STATES) {
      expect(await runMoves(setup, status), status).toEqual(
        expected(RUN_NEEDS, `test run <id> is ${status}`),
      );
      expect(await suiteMovesWithARun(setup, status), status).toEqual({
        completeSuite: "passed",
        abortSuite: "aborted",
      });
    }
  });
});

describe("a suite, state by state", () => {
  it("running, as it is written: it takes its verdict or is aborted", async () => {
    const setup = await database();

    expect(await suiteMoves(setup, "running")).toEqual(
      expected(SUITE_NEEDS, "test suite <id> is running", {
        completeSuite: "passed",
        abortSuite: "aborted",
      }),
    );
  });

  it("ended: nothing moves it (unhappy)", async () => {
    const setup = await database();

    for (const status of ENDED_SUITE_STATES) {
      expect(await suiteMoves(setup, status), status).toEqual(
        expected(SUITE_NEEDS, `test suite <id> is ${status}`),
      );
    }
  });
});

describe("the reads with rules of their own", () => {
  it("the queue hands out setups, then diagnoses, then drives, oldest first, and ends empty", async () => {
    const setup = await database();
    const queued: Array<[Tests.JobAction, number]> = [
      ["drive", 1],
      ["diagnose", 2],
      ["setup", 3],
      ["drive", 0],
      ["setup", 4],
      ["diagnose", 5],
    ];
    const names = new Map<string, string>();
    for (const [action, second] of queued) {
      const job = await newJob(setup.tests, action);
      await createdAt(setup.db, job.id, second);
      names.set(job.id, `${action} ${String(second)}`);
    }
    const handed: Array<string | undefined> = [];
    for (let next = jarl.unwrap(await setup.tests.nextPendingJob()); next !== undefined;) {
      handed.push(names.get(next.id));
      await setJob(setup.db, next.id, "running");
      next = jarl.unwrap(await setup.tests.nextPendingJob());
    }

    expect(handed).toEqual([
      "setup 3",
      "setup 4",
      "diagnose 2",
      "diagnose 5",
      "drive 0",
      "drive 1",
    ]);
    expect(jarl.unwrap(await setup.tests.nextPendingJob())).toBeUndefined();
  });

  it("a definition's resume is kept with each wording: a newer wording that boots fresh does not resume, the older still does", async () => {
    const { tests } = await database();
    await definition(tests, "lock-screen", true);
    await definition(tests, "lock-screen", false);

    expect(jarl.unwrap(await tests.findTestDefinition("lock-screen"))?.resume).toBe(false);
    expect(
      jarl.unwrap(await tests.listTestDefinitionHistory("lock-screen")).map((row) => row.resume),
    ).toEqual([true, false]);
  });

  it("latestJob is a test run's newest job of an action, or nothing", async () => {
    const { db, tests } = await database();
    const { run, job: first } = await newRun(tests);
    await setJob(db, first.id, "failed");
    const again = jarl.unwrap(await tests.createJob(run.id, "drive"));
    await createdAt(db, first.id, 0);
    await createdAt(db, again.id, 1);

    expect(jarl.unwrap(await tests.latestJob(run.id, "drive"))?.id).toBe(again.id);
    expect(jarl.unwrap(await tests.latestJob(run.id, "setup"))).toBeUndefined();
  });

  it("a suite's test runs are counted by status, the same in getTestSuite and listTestSuites", async () => {
    const { db, tests } = await database();
    const statuses: ReadonlyArray<Tests.RunStatus> = [
      "pending",
      "running",
      "passed",
      "passed",
      "failed",
    ];
    const { suite, runs } = await newSuite(
      tests,
      statuses.map((_, index) => `test-${String(index)}`),
    );
    for (const [index, listed] of runs.entries()) {
      await setRun(db, listed.run.id, statuses[index] ?? "pending");
    }
    const tally = {
      pending: 1,
      running: 1,
      passed: 2,
      failed: 1,
      aborted: 0,
      errored: 0,
      completed: 0,
      timed_out: 0,
    };

    expect(jarl.unwrap(await tests.getTestSuite(suite.id)).runs).toEqual(tally);
    expect(
      jarl.unwrap(await tests.listTestSuites(10)).find((listed) => listed.id === suite.id)?.runs,
    ).toEqual(tally);
  });
});

describe("a row that does not exist", () => {
  it("every call that names one by id refuses it with NotFound (unhappy)", async () => {
    const { tests } = await database();
    const calls: Readonly<Record<string, () => Promise<jarl.Result<unknown, Error>>>> = {
      createJob: () => tests.createJob(MISSING, "drive"),
      runJob: () => tests.runJob(MISSING, SERVER),
      completeJob: () => tests.completeJob(MISSING),
      finalizeJob: () => tests.finalizeJob(MISSING, "succeeded", null),
      errorJob: () => tests.errorJob(MISSING, "x"),
      timeoutJob: () => tests.timeoutJob(MISSING, "x"),
      abortJob: () => tests.abortJob(MISSING, "x"),
      startRun: () => tests.startRun(MISSING, MODEL),
      completeRun: () => tests.completeRun(MISSING, "passed", null),
      errorRun: () => tests.errorRun(MISSING, "x"),
      timeoutRun: () => tests.timeoutRun(MISSING, "x"),
      abortRun: () => tests.abortRun(MISSING, "x"),
      completeSuite: () => tests.completeSuite(MISSING, "passed", null),
      abortSuite: () => tests.abortSuite(MISSING, "x"),
      getTestSuite: () => tests.getTestSuite(MISSING),
      getTestSuiteDetails: () => tests.getTestSuiteDetails(MISSING),
      getTestRun: () => tests.getTestRun(MISSING),
      getTestRunDetails: () => tests.getTestRunDetails(MISSING),
      getJob: () => tests.getJob(MISSING),
      getJobDetails: () => tests.getJobDetails(MISSING),
    };
    const nouns: Readonly<Record<string, string>> = {
      createJob: "test run",
      startRun: "test run",
      completeRun: "test run",
      errorRun: "test run",
      timeoutRun: "test run",
      abortRun: "test run",
      getTestRun: "test run",
      getTestRunDetails: "test run",
      completeSuite: "test suite",
      abortSuite: "test suite",
      getTestSuite: "test suite",
      getTestSuiteDetails: "test suite",
    };

    const answered: Record<string, string> = {};
    for (const [fn, call] of Object.entries(calls)) {
      answered[fn] = said(await call());
    }

    expect(answered).toEqual(
      Object.fromEntries(
        Object.keys(calls).map((fn) => [fn, `NotFound: ${fn}: no ${nouns[fn] ?? "job"} <id>`]),
      ),
    );
    expect(said(await tests.createTestRun({ definitionId: 999, ...SINGLE }))).toBe(
      "NotFound: createTestRun: no test definition 999",
    );
  });
});
