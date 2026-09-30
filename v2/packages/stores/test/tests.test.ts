import { isDeepStrictEqual } from "node:util";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { eq } from "drizzle-orm";
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
const setJob = (db: Db.Database, id: string, status: Tests.JobStatus) =>
  db.run((d) => d.update(DbSchema.jobs).set({ status }).where(eq(DbSchema.jobs.id, id)));
const setRun = (db: Db.Database, id: string, status: Tests.RunStatus) =>
  db.run((d) => d.update(DbSchema.testRuns).set({ status }).where(eq(DbSchema.testRuns.id, id)));
const setSuite = (db: Db.Database, id: string, status: SuiteStatus) =>
  db.run((d) =>
    d.update(DbSchema.testSuites).set({ status }).where(eq(DbSchema.testSuites.id, id)),
  );

const jobIn = async (setup: Setup, status: Tests.JobStatus, action: Tests.JobAction = "drive") => {
  const job = await newJob(setup.tests, undefined, action);
  await setJob(setup.db, job.id, status);
  return job;
};
const runIn = async (setup: Setup, status: Tests.RunStatus) => {
  const run = await newRun(setup.tests);
  await setRun(setup.db, run.id, status);
  return run;
};
const suiteIn = async (setup: Setup, status: SuiteStatus) => {
  const suite = await newSuite(setup.tests);
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
  finalizeJob: "a completed drive or mint",
  errorJob: "running, or a completed drive or mint",
  timeoutJob: "running",
  abortJob: "pending or running",
};

// What a test run's own moves meet while it holds one job in a state.
const RUN_MOVES_WITH_A_JOB: Readonly<Record<string, Move>> = {
  createJob: (tests, id) => tests.createJob(id, "diagnose"),
  errorRun: (tests, id) => tests.errorRun(id, "given up"),
  abortRun: (tests, id) => tests.abortRun(id, "operator"),
};

const RUN_MOVES: Readonly<Record<string, Move>> = {
  startRun: (tests, id) => tests.startRun(id, MODEL),
  completeRun: (tests, id) => tests.completeRun(id, "passed", null),
  errorRun: (tests, id) => tests.errorRun(id, "given up"),
  abortRun: (tests, id) => tests.abortRun(id, "operator"),
  createJob: (tests, id) => tests.createJob(id, "drive"),
};
const RUN_NEEDS = {
  startRun: "pending",
  completeRun: "running",
  errorRun: "running",
  abortRun: "pending or running",
  createJob: "pending or running",
};

// What a suite's own moves meet while it holds one test run in a state.
const SUITE_MOVES_WITH_A_RUN: Readonly<Record<string, Move>> = {
  completeSuite: (tests, id) => tests.completeSuite(id, "passed", null),
  abortSuite: (tests, id) => tests.abortSuite(id, "operator"),
};

const SUITE_MOVES: Readonly<Record<string, Move>> = {
  startSuite: (tests, id) => tests.startSuite(id),
  completeSuite: (tests, id) => tests.completeSuite(id, "passed", null),
  abortSuite: (tests, id) => tests.abortSuite(id, "operator"),
  createTestRun: async (tests, id) => tests.createTestRun(id, await definition(tests, "wifi")),
};
const SUITE_NEEDS = {
  startSuite: "pending",
  completeSuite: "running",
  abortSuite: "pending or running",
  createTestRun: "pending",
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
      const run = await runIn(setup, "running");
      await setJob(setup.db, (await newJob(setup.tests, run.id)).id, status);
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
      const suite = await newSuite(setup.tests);
      await setRun(setup.db, (await newRun(setup.tests, suite.id)).id, status);
      await setSuite(setup.db, suite.id, "running");
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

describe("a test, start to finish", () => {
  it("it starts on its model, its drive runs and completes, its diagnose passes it, and the suite passes (happy)", async () => {
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

    const suite = await step("createTestSuite", tests.createTestSuite(SUITE));
    const run = await step("createTestRun", tests.createTestRun(suite.id, await definition(tests)));
    await step("startSuite", tests.startSuite(suite.id));
    await step("startRun", tests.startRun(run.id, MODEL));
    const drive = await step("createJob drive", tests.createJob(run.id, "drive"));
    const queued = jarl.unwrap(await tests.nextPendingJob([]));
    await step("runJob drive", tests.runJob(drive.id, SERVER));
    await step("completeJob drive", tests.completeJob(drive.id));
    const diagnose = await step("createJob diagnose", tests.createJob(run.id, "diagnose"));
    await step("runJob diagnose", tests.runJob(diagnose.id, SERVER));
    await step("finalizeJob drive", tests.finalizeJob(drive.id, "succeeded", null));
    await step("completeRun", tests.completeRun(run.id, "passed", null));
    await step("completeJob diagnose", tests.completeJob(diagnose.id));
    await step("completeSuite", tests.completeSuite(suite.id, "passed", null));

    expect(queued?.id).toBe(drive.id);
    expect(trail).toEqual([
      "createTestSuite pending",
      "createTestRun pending",
      "startSuite running",
      "startRun running",
      "createJob drive pending",
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
    const diagnose = await newJob(setup.tests, drive.runId, "diagnose");
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

  it("running: it takes its verdict, errors, is aborted or takes a job, refuses starting again, and holds its suite (unhappy)", async () => {
    const setup = await database();

    expect(await runMoves(setup, "running")).toEqual(
      expected(RUN_NEEDS, "test run <id> is running", {
        completeRun: "passed",
        errorRun: "errored",
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
  it("pending: it starts, is aborted or takes test runs, one per definition, and refuses completing (unhappy)", async () => {
    const setup = await database();
    const suite = await newSuite(setup.tests);
    const lockScreen = await definition(setup.tests);
    jarl.unwrap(await setup.tests.createTestRun(suite.id, lockScreen));

    expect(await suiteMoves(setup, "pending")).toEqual(
      expected(SUITE_NEEDS, "test suite <id> is pending", {
        startSuite: "running",
        abortSuite: "aborted",
        createTestRun: "pending",
      }),
    );
    expect(said(await setup.tests.createTestRun(suite.id, lockScreen))).toBe(
      `Duplicate: createTestRun: test suite <id> already has test definition ${String(lockScreen)}`,
    );
    expect(said(await setup.tests.createTestRun(suite.id, 999))).toBe(
      "NotFound: createTestRun: no test definition 999",
    );
  });

  it("running: it takes its verdict or is aborted, and refuses starting again and new test runs (unhappy)", async () => {
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
  it("the queue hands out mints, then diagnoses, then drives, oldest first, skips what it is told to, and ends empty", async () => {
    const setup = await database();
    const queued: Array<[Tests.JobAction, number]> = [
      ["drive", 1],
      ["diagnose", 2],
      ["mint", 3],
      ["drive", 0],
      ["mint", 4],
      ["diagnose", 5],
    ];
    const names = new Map<string, string>();
    for (const [action, second] of queued) {
      const job = await newJob(setup.tests, undefined, action);
      await createdAt(setup.db, job.id, second);
      names.set(job.id, `${action} ${String(second)}`);
    }
    const first = jarl.unwrap(await setup.tests.nextPendingJob([]));
    const skipped = jarl.unwrap(
      await setup.tests.nextPendingJob(first === undefined ? [] : [first.id]),
    );

    const handed: Array<string | undefined> = [];
    for (let next = first; next !== undefined;) {
      handed.push(names.get(next.id));
      await setJob(setup.db, next.id, "running");
      next = jarl.unwrap(await setup.tests.nextPendingJob([]));
    }

    expect(handed).toEqual(["mint 3", "mint 4", "diagnose 2", "diagnose 5", "drive 0", "drive 1"]);
    expect(names.get(skipped?.id ?? "")).toBe("mint 4");
    expect(jarl.unwrap(await setup.tests.nextPendingJob([]))).toBeUndefined();
  });

  it("latestJob is a test run's newest job of an action, or nothing", async () => {
    const { db, tests } = await database();
    const run = await newRun(tests);
    const first = await newJob(tests, run.id);
    await setJob(db, first.id, "failed");
    const again = await newJob(tests, run.id);
    await createdAt(db, first.id, 0);
    await createdAt(db, again.id, 1);

    expect(jarl.unwrap(await tests.latestJob(run.id, "drive"))?.id).toBe(again.id);
    expect(jarl.unwrap(await tests.latestJob(run.id, "mint"))).toBeUndefined();
  });

  it("a suite's test runs are counted by status, the same in getTestSuite and listTestSuites", async () => {
    const { db, tests } = await database();
    const suite = await newSuite(tests);
    const statuses: ReadonlyArray<Tests.RunStatus> = [
      "pending",
      "running",
      "passed",
      "passed",
      "failed",
    ];
    for (const [index, status] of statuses.entries()) {
      await setRun(db, (await newRun(tests, suite.id, `test-${String(index)}`)).id, status);
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

describe("a row that does not exist", () => {
  it("every call that names one by id refuses it with NotFound (unhappy)", async () => {
    const { tests } = await database();
    const calls: Readonly<Record<string, () => Promise<jarl.Result<unknown, Error>>>> = {
      createTestRun: () => tests.createTestRun(MISSING, 1),
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
      abortRun: () => tests.abortRun(MISSING, "x"),
      startSuite: () => tests.startSuite(MISSING),
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
      createTestRun: "test suite",
      createJob: "test run",
      startRun: "test run",
      completeRun: "test run",
      errorRun: "test run",
      abortRun: "test run",
      getTestRun: "test run",
      getTestRunDetails: "test run",
      startSuite: "test suite",
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
  });
});
