import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { and, asc, desc, eq, getTableColumns, inArray, notInArray, sql } from "drizzle-orm";
import { alias, type PgUpdateSetSource } from "drizzle-orm/pg-core";
import * as jarl from "jarl";
import { type Answer, settle } from "./answer.ts";
import { claimLock } from "./setup-requests.ts";

// A transition asked of a row that is not in a state it moves from, or a create given nothing
// to create. The message says what was asked and what was needed.
export const InvalidState = jarl.error.define("InvalidState");
export type InvalidState = InstanceType<typeof InvalidState>;

export const NotFound = jarl.error.define("NotFound");
export type NotFound = InstanceType<typeof NotFound>;

export type DefinitionRow = typeof DbSchema.testDefinitions.$inferSelect;

export type BasePromptRow = typeof DbSchema.testBasePrompts.$inferSelect;

export type SuiteRow = typeof DbSchema.testSuites.$inferSelect;

export type RunRow = typeof DbSchema.testRuns.$inferSelect;

export type JobRow = typeof DbSchema.jobs.$inferSelect;

export type JobAction = JobRow["action"];

export type JobStatus = JobRow["status"];

export type RunStatus = RunRow["status"];

// runs counts the suite's test runs in each status. In a summary, test is the definition's
// name and suite the suite's, null for a test run filed on its own.
export type TestSuiteSummary = SuiteRow & { readonly runs: Readonly<Record<RunStatus, number>> };

export type TestRunSummary = RunRow & { readonly test: string; readonly suite: string | null };

export type JobSummary = JobRow & { readonly test: string };

// clientUrl is the automation client that claimed the job, serverUrl the qemu server holding
// its guest; each is null until there is one, and clientUrl once that client is forgotten.
export type QueuedJob = JobSummary & {
  readonly clientUrl: string | null;
  readonly serverUrl: string | null;
};

// The live queue, each list in queue order.
export type Queue = {
  readonly running: ReadonlyArray<QueuedJob>;
  readonly pending: ReadonlyArray<QueuedJob>;
};

// Test runs and jobs in the details are oldest first.
export type TestSuiteDetails = {
  readonly suite: SuiteRow;
  readonly runs: ReadonlyArray<{
    readonly run: RunRow;
    readonly test: string;
    readonly jobs: ReadonlyArray<JobRow>;
  }>;
};

// suite is null for a test run filed on its own.
export type TestRunDetails = {
  readonly run: RunRow;
  readonly suite: SuiteRow | null;
  readonly definition: DefinitionRow;
  readonly jobs: ReadonlyArray<JobRow>;
};

export type JobDetails = {
  readonly job: JobRow;
  readonly run: RunRow;
  readonly suite: SuiteRow | null;
  readonly definition: DefinitionRow;
};

export type DefinitionInput = {
  readonly name: string;
  readonly description: string;
  readonly instruction: string;
  readonly proof: string;
  readonly resume: boolean;
};

export type DefinedDefinition = {
  readonly id: number;
  // The row's place among its name's rows by id: 1 for a new name.
  readonly version: number;
};

// definitionIds may name a definition more than once: each is a test run of its own.
// setupServers, when given, is one qemu server per id, in the same order: a suite of the
// setup definition, each run claiming that server's lock.
export type SuiteInput = {
  readonly iso: string;
  readonly serverUrl: string;
  readonly definitionIds: ReadonlyArray<number>;
  readonly setupServers?: ReadonlyArray<string>;
};

export type RunInput = {
  readonly definitionId: number;
  readonly iso: string;
  readonly serverUrl: string;
  // The qemu server whose setup lock a setup run names its job on. A drive names none.
  readonly setupServer?: string;
};

// A test run filed on its own, and the job it was filed with.
export type NewTestRun = { readonly run: RunRow; readonly job: JobRow };

// The version in the ISO's file name (`omarchy-4.0.4.iso` is `4.0.4`), or the whole url when
// it names none. Only the file name is read, so a host such as 10.0.0.5 is never a version.
export const suiteName = (iso: string): string => {
  const file = iso.split(/[?#]/, 1)[0]?.split("/").pop() ?? "";
  return /\d+(?:\.\d+){2,}/.exec(file)?.[0] ?? iso;
};

export type SuiteVerdict = "passed" | "failed";

export type RunVerdict = "passed" | "failed";

export type JobVerdict = "succeeded" | "failed";

export type Moved<T> = Promise<jarl.Result<T, Db.DatabaseError | InvalidState | NotFound>>;

export type Found<T> = Promise<jarl.Result<T, Db.DatabaseError | NotFound>>;

export type Tests = {
  readonly service: "tests";
  readonly listTestDefinitions: () => Answer<ReadonlyArray<DefinitionRow>>;
  readonly findTestDefinition: (name: string) => Answer<DefinitionRow | undefined>;
  readonly listTestDefinitionHistory: (name?: string) => Answer<ReadonlyArray<DefinitionRow>>;
  readonly defineTestDefinition: (input: DefinitionInput) => Answer<DefinedDefinition>;
  readonly listTestBasePrompts: () => Answer<ReadonlyArray<BasePromptRow>>;
  readonly definitionName: (id: number) => Answer<string | undefined>;

  readonly createTestSuite: (input: SuiteInput) => Moved<TestSuiteDetails>;
  readonly getTestSuite: (suiteId: string) => Found<TestSuiteSummary>;
  readonly getTestSuiteDetails: (suiteId: string) => Found<TestSuiteDetails>;
  readonly listTestSuites: (limit: number) => Answer<ReadonlyArray<TestSuiteSummary>>;
  readonly completeSuite: (
    suiteId: string,
    status: SuiteVerdict,
    reason: string | null,
  ) => Moved<SuiteRow>;
  readonly abortSuite: (suiteId: string, reason: string) => Moved<SuiteRow>;

  readonly createTestRun: (input: RunInput) => Moved<NewTestRun>;
  readonly getTestRun: (runId: string) => Found<TestRunSummary>;
  readonly getTestRunDetails: (runId: string) => Found<TestRunDetails>;
  readonly listTestRuns: (suiteId: string) => Answer<ReadonlyArray<TestRunSummary>>;
  readonly startRun: (runId: string, model: string) => Moved<RunRow>;
  readonly completeRun: (runId: string, status: RunVerdict, reason: string | null) => Moved<RunRow>;
  readonly errorRun: (runId: string, reason: string) => Moved<RunRow>;
  readonly abortRun: (runId: string, reason: string) => Moved<RunRow>;

  readonly createJob: (runId: string, action: JobAction) => Moved<JobRow>;
  readonly getJob: (jobId: string) => Found<JobSummary>;
  readonly getJobDetails: (jobId: string) => Found<JobDetails>;
  readonly listJobs: (limit?: number) => Answer<Queue>;
  readonly latestJob: (runId: string, action: JobAction) => Answer<JobRow | undefined>;
  readonly nextPendingJob: (except: ReadonlyArray<string>) => Answer<JobRow | undefined>;
  readonly runJob: (jobId: string, serverId: string) => Moved<JobRow>;
  readonly completeJob: (jobId: string) => Moved<JobRow>;
  readonly finalizeJob: (jobId: string, status: JobVerdict, reason: string | null) => Moved<JobRow>;
  readonly errorJob: (jobId: string, reason: string) => Moved<JobRow>;
  readonly timeoutJob: (jobId: string, reason: string) => Moved<JobRow>;
  readonly abortJob: (jobId: string, reason: string) => Moved<JobRow>;
};

declare module "@oligarchy/app" {
  interface Services {
    tests: App.Register<"tests", Tests>;
  }
}

type Tx = Parameters<Parameters<Db.Drizzle["transaction"]>[0]>[0];

type Refusal = InvalidState | NotFound;

// Which states a transition moves from, and how its refusal says so.
type Rule<Row> = { readonly accepts: (row: Row) => boolean; readonly need: string };

// A test run or suite held by a pending or running row below it: the refusal, or undefined.
type Guard = (tx: Tx, id: string) => Promise<string | undefined>;

const OPEN = ["pending", "running"] as const;

const only = <T>(rows: ReadonlyArray<T>, what: string): T => {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`${what}: the write returned no row`);
  }
  return row;
};

const now = sql`now()`;

// The time of the write itself, not of its transaction's start, so rows written one after
// another in a transaction keep that order.
const clock = sql`clock_timestamp()`;

type Placement = Pick<
  typeof DbSchema.testRuns.$inferInsert,
  "suiteId" | "definitionId" | "iso" | "serverUrl"
>;

// The definition that installs an ISO. Filing it writes a setup job; every other definition
// writes a drive. A caller does not choose the action, so a setup cannot be filed as a drive.
const SETUP = "setup";

const filedAction = (name: string): "drive" | "setup" => (name === SETUP ? "setup" : "drive");

// A test run and the pending job it is filed with. The action is the definition's.
const fileRun = async (
  tx: Tx,
  fn: string,
  placement: Placement,
  action: "drive" | "setup",
): Promise<NewTestRun> => {
  const filed = only(
    await tx
      .insert(DbSchema.testRuns)
      .values({ ...placement, createdAt: clock })
      .returning(),
    fn,
  );
  const job = only(
    await tx
      .insert(DbSchema.jobs)
      .values({ runId: filed.id, action, createdAt: clock })
      .returning(),
    fn,
  );
  return { run: filed, job };
};

// A refusal thrown inside a transaction, so the transaction rolls back, then returned as the
// result. Any other throw stays a throw, and the database's run reports it.
const caught = (error: unknown): Refusal | undefined =>
  error instanceof InvalidState || error instanceof NotFound ? error : undefined;

// Each definition's name, for those of the ids that name one.
const definitionNames = async (tx: Tx, ids: ReadonlyArray<number>) => {
  const rows = await tx
    .select({ id: DbSchema.testDefinitions.id, name: DbSchema.testDefinitions.name })
    .from(DbSchema.testDefinitions)
    .where(inArray(DbSchema.testDefinitions.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row.name]));
};

const noRuns = (): Record<RunStatus, number> => ({
  pending: 0,
  running: 0,
  passed: 0,
  failed: 0,
  aborted: 0,
  timed_out: 0,
  completed: 0,
  errored: 0,
});

// Each suite's test runs counted by status, in one grouped read; a suite with none counts zeros.
const countRuns = async (d: Db.Drizzle, suiteIds: ReadonlyArray<string>) => {
  const counts = new Map(suiteIds.map((id) => [id, noRuns()]));
  if (suiteIds.length === 0) {
    return counts;
  }
  const rows = await d
    .select({
      suiteId: DbSchema.testRuns.suiteId,
      status: DbSchema.testRuns.status,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(DbSchema.testRuns)
    .where(inArray(DbSchema.testRuns.suiteId, [...suiteIds]))
    .groupBy(DbSchema.testRuns.suiteId, DbSchema.testRuns.status);
  for (const row of rows) {
    const counted = row.suiteId === null ? undefined : counts.get(row.suiteId);
    if (counted !== undefined) {
      counted[row.status] = row.count;
    }
  }
  return counts;
};

// Queue order: every pending setup, then every pending diagnose, then every pending drive,
// each oldest first; id breaks a tie. A setup is the install a resume waits on, so it never
// waits behind that resume, and a diagnose closes a drive already done.
const queueRank = sql`case ${DbSchema.jobs.action} when 'setup' then 0 when 'diagnose' then 1 else 2 end`;

const runSummary = {
  ...getTableColumns(DbSchema.testRuns),
  test: DbSchema.testDefinitions.name,
  suite: DbSchema.testSuites.name,
};

const jobSummary = { ...getTableColumns(DbSchema.jobs), test: DbSchema.testDefinitions.name };

const QUEUE_LIMIT = 25;

const client = alias(DbSchema.servers, "client");

const queuedJob = {
  ...jobSummary,
  clientUrl: client.url,
  serverUrl: DbSchema.jobServers.serverUrl,
};

const job = {
  pending: { accepts: (row) => row.status === "pending", need: "pending" },
  running: { accepts: (row) => row.status === "running", need: "running" },
  completedJudged: {
    accepts: (row) => row.status === "completed" && row.action !== "diagnose",
    need: "a completed drive or setup",
  },
  errorable: {
    accepts: (row) =>
      row.status === "running" || (row.status === "completed" && row.action !== "diagnose"),
    need: "running, or a completed drive or setup",
  },
  open: {
    accepts: (row) => row.status === "pending" || row.status === "running",
    need: "pending or running",
  },
} satisfies Record<string, Rule<JobRow>>;

const run = {
  pending: { accepts: (row) => row.status === "pending", need: "pending" },
  running: { accepts: (row) => row.status === "running", need: "running" },
  open: {
    accepts: (row) => row.status === "pending" || row.status === "running",
    need: "pending or running",
  },
} satisfies Record<string, Rule<RunRow>>;

const suite = {
  running: { accepts: (row) => row.status === "running", need: "running" },
  open: {
    accepts: (row) => row.status === "pending" || row.status === "running",
    need: "pending or running",
  },
} satisfies Record<string, Rule<SuiteRow>>;

const openJobOf =
  (fn: string): Guard =>
  async (tx, runId) => {
    const [open] = await tx
      .select({ id: DbSchema.jobs.id, status: DbSchema.jobs.status })
      .from(DbSchema.jobs)
      .where(and(eq(DbSchema.jobs.runId, runId), inArray(DbSchema.jobs.status, [...OPEN])))
      .limit(1);
    return open === undefined
      ? undefined
      : `${fn}: test run ${runId} has job ${open.id} ${open.status}; needs no pending or running job`;
  };

const openRunOf =
  (fn: string): Guard =>
  async (tx, suiteId) => {
    const [open] = await tx
      .select({ id: DbSchema.testRuns.id, status: DbSchema.testRuns.status })
      .from(DbSchema.testRuns)
      .where(
        and(eq(DbSchema.testRuns.suiteId, suiteId), inArray(DbSchema.testRuns.status, [...OPEN])),
      )
      .limit(1);
    return open === undefined
      ? undefined
      : `${fn}: test suite ${suiteId} has test run ${open.id} ${open.status}; needs no pending or running test run`;
  };

// Each transition locks its row, checks the state it is in and whatever holds it, and only
// then writes: a refused call changes nothing, and two calls cannot both pass one check.
export const create = App.createService<Db.Database, App.NoOptions, Tests>(({ db }) => {
  const moveJob = (
    fn: string,
    id: string,
    rule: Rule<JobRow>,
    set: PgUpdateSetSource<typeof DbSchema.jobs>,
  ) =>
    db
      .run((d) =>
        d.transaction(async (tx): Promise<jarl.Result<JobRow, Refusal>> => {
          const [row] = await tx
            .select()
            .from(DbSchema.jobs)
            .where(eq(DbSchema.jobs.id, id))
            .for("update");
          if (row === undefined) {
            return jarl.err(new NotFound(`${fn}: no job ${id}`));
          }
          if (!rule.accepts(row)) {
            return jarl.err(
              new InvalidState(
                `${fn}: job ${id} is ${row.status} ${row.action}; needs ${rule.need}`,
              ),
            );
          }
          return jarl.ok(
            only(
              await tx.update(DbSchema.jobs).set(set).where(eq(DbSchema.jobs.id, id)).returning(),
              fn,
            ),
          );
        }),
      )
      .then(settle);

  const moveRun = (
    fn: string,
    id: string,
    rule: Rule<RunRow>,
    set: PgUpdateSetSource<typeof DbSchema.testRuns>,
    guard?: Guard,
  ) =>
    db
      .run((d) =>
        d.transaction(async (tx): Promise<jarl.Result<RunRow, Refusal>> => {
          const [row] = await tx
            .select()
            .from(DbSchema.testRuns)
            .where(eq(DbSchema.testRuns.id, id))
            .for("update");
          if (row === undefined) {
            return jarl.err(new NotFound(`${fn}: no test run ${id}`));
          }
          if (!rule.accepts(row)) {
            return jarl.err(
              new InvalidState(`${fn}: test run ${id} is ${row.status}; needs ${rule.need}`),
            );
          }
          const held = guard === undefined ? undefined : await guard(tx, id);
          if (held !== undefined) {
            return jarl.err(new InvalidState(held));
          }
          return jarl.ok(
            only(
              await tx
                .update(DbSchema.testRuns)
                .set(set)
                .where(eq(DbSchema.testRuns.id, id))
                .returning(),
              fn,
            ),
          );
        }),
      )
      .then(settle);

  const moveSuite = (
    fn: string,
    id: string,
    rule: Rule<SuiteRow>,
    set: PgUpdateSetSource<typeof DbSchema.testSuites>,
    guard?: Guard,
  ) =>
    db
      .run((d) =>
        d.transaction(async (tx): Promise<jarl.Result<SuiteRow, Refusal>> => {
          const [row] = await tx
            .select()
            .from(DbSchema.testSuites)
            .where(eq(DbSchema.testSuites.id, id))
            .for("update");
          if (row === undefined) {
            return jarl.err(new NotFound(`${fn}: no test suite ${id}`));
          }
          if (!rule.accepts(row)) {
            return jarl.err(
              new InvalidState(`${fn}: test suite ${id} is ${row.status}; needs ${rule.need}`),
            );
          }
          const held = guard === undefined ? undefined : await guard(tx, id);
          if (held !== undefined) {
            return jarl.err(new InvalidState(held));
          }
          return jarl.ok(
            only(
              await tx
                .update(DbSchema.testSuites)
                .set(set)
                .where(eq(DbSchema.testSuites.id, id))
                .returning(),
              fn,
            ),
          );
        }),
      )
      .then(settle);

  return {
    service: "tests",

    listTestDefinitions: () =>
      db.run((d) =>
        d
          .selectDistinctOn([DbSchema.testDefinitions.name])
          .from(DbSchema.testDefinitions)
          .orderBy(DbSchema.testDefinitions.name, desc(DbSchema.testDefinitions.id)),
      ),

    findTestDefinition: (name) =>
      db.run(async (d) => {
        const [row] = await d
          .select()
          .from(DbSchema.testDefinitions)
          .where(eq(DbSchema.testDefinitions.name, name))
          .orderBy(desc(DbSchema.testDefinitions.id))
          .limit(1);
        return row;
      }),

    listTestDefinitionHistory: (name) =>
      db.run((d) =>
        d
          .select()
          .from(DbSchema.testDefinitions)
          .where(name === undefined ? undefined : eq(DbSchema.testDefinitions.name, name))
          .orderBy(DbSchema.testDefinitions.name, DbSchema.testDefinitions.id),
      ),

    defineTestDefinition: (input) =>
      db.run((d) =>
        d.transaction(async (tx) => {
          const row = only(
            await tx
              .insert(DbSchema.testDefinitions)
              .values(input)
              .returning({ id: DbSchema.testDefinitions.id }),
            "defineTestDefinition",
          );
          const version = await tx.$count(
            DbSchema.testDefinitions,
            eq(DbSchema.testDefinitions.name, input.name),
          );
          return { id: row.id, version };
        }),
      ),

    listTestBasePrompts: () =>
      db.run((d) =>
        d.select().from(DbSchema.testBasePrompts).orderBy(DbSchema.testBasePrompts.name),
      ),

    definitionName: (id) =>
      db.run(async (d) => {
        const [row] = await d
          .select({ name: DbSchema.testDefinitions.name })
          .from(DbSchema.testDefinitions)
          .where(eq(DbSchema.testDefinitions.id, id));
        return row?.name;
      }),

    // The whole suite in one transaction: the suite, running, and each test run with its pending
    // job, in the order named. A setup definition files a setup job and claims that run's server;
    // any other files a drive. The queue never sees part of a suite, nor a setup job with no lock.
    createTestSuite: ({ iso, serverUrl, definitionIds, setupServers }) =>
      db
        .run(async (d): Promise<jarl.Result<TestSuiteDetails, Refusal>> => {
          try {
            return await d.transaction(
              async (tx): Promise<jarl.Result<TestSuiteDetails, Refusal>> => {
                if (definitionIds.length === 0) {
                  return jarl.err(
                    new InvalidState("createTestSuite: needs at least one test definition"),
                  );
                }
                const names = await definitionNames(tx, definitionIds);
                const named: Array<{ readonly definitionId: number; readonly test: string }> = [];
                for (const definitionId of definitionIds) {
                  const test = names.get(definitionId);
                  if (test === undefined) {
                    return jarl.err(
                      new NotFound(`createTestSuite: no test definition ${String(definitionId)}`),
                    );
                  }
                  named.push({ definitionId, test });
                }
                const setups = named.filter(({ test }) => test === SETUP).length;
                if (setups > 0 && setups < named.length) {
                  return jarl.err(
                    new InvalidState(
                      "createTestSuite: a setup definition and a drive definition cannot share a suite",
                    ),
                  );
                }
                if (setups === named.length && setupServers?.length !== named.length) {
                  return jarl.err(
                    new InvalidState(
                      "createTestSuite: a setup suite needs one server per test run",
                    ),
                  );
                }
                if (setups === 0 && setupServers !== undefined) {
                  return jarl.err(
                    new InvalidState("createTestSuite: a drive suite names no setup server"),
                  );
                }
                const filed = only(
                  await tx
                    .insert(DbSchema.testSuites)
                    .values({ iso, serverUrl, name: suiteName(iso), status: "running" })
                    .returning(),
                  "createTestSuite",
                );
                const runs: Array<TestSuiteDetails["runs"][number]> = [];
                for (const [index, { definitionId, test }] of named.entries()) {
                  const action = filedAction(test);
                  const written = await fileRun(
                    tx,
                    "createTestSuite",
                    { suiteId: filed.id, definitionId, iso, serverUrl },
                    action,
                  );
                  if (action === "setup") {
                    const server = setupServers?.[index];
                    if (server === undefined) {
                      throw new InvalidState(
                        "createTestSuite: a setup suite needs one server per test run",
                      );
                    }
                    const claimed = await claimLock(tx, iso, server, written.job.id);
                    if (!claimed) {
                      throw new InvalidState(
                        `createTestSuite: ${server} did not take its setup lock`,
                      );
                    }
                  }
                  runs.push({ run: written.run, test, jobs: [written.job] });
                }
                return jarl.ok({ suite: filed, runs });
              },
            );
          } catch (error) {
            const refusal = caught(error);
            if (refusal !== undefined) {
              return jarl.err(refusal);
            }
            throw error;
          }
        })
        .then(settle),

    getTestSuite: (suiteId) =>
      db
        .run(async (d): Promise<jarl.Result<TestSuiteSummary, NotFound>> => {
          const [row] = await d
            .select()
            .from(DbSchema.testSuites)
            .where(eq(DbSchema.testSuites.id, suiteId));
          if (row === undefined) {
            return jarl.err(new NotFound(`getTestSuite: no test suite ${suiteId}`));
          }
          const counts = await countRuns(d, [suiteId]);
          return jarl.ok({ ...row, runs: counts.get(suiteId) ?? noRuns() });
        })
        .then(settle),

    getTestSuiteDetails: (suiteId) =>
      db
        .run(async (d): Promise<jarl.Result<TestSuiteDetails, NotFound>> => {
          const [found] = await d
            .select()
            .from(DbSchema.testSuites)
            .where(eq(DbSchema.testSuites.id, suiteId));
          if (found === undefined) {
            return jarl.err(new NotFound(`getTestSuiteDetails: no test suite ${suiteId}`));
          }
          const runs = await d
            .select({ run: DbSchema.testRuns, test: DbSchema.testDefinitions.name })
            .from(DbSchema.testRuns)
            .innerJoin(
              DbSchema.testDefinitions,
              eq(DbSchema.testDefinitions.id, DbSchema.testRuns.definitionId),
            )
            .where(eq(DbSchema.testRuns.suiteId, suiteId))
            .orderBy(asc(DbSchema.testRuns.createdAt), asc(DbSchema.testRuns.id));
          const history =
            runs.length === 0
              ? []
              : await d
                  .select()
                  .from(DbSchema.jobs)
                  .where(
                    inArray(
                      DbSchema.jobs.runId,
                      runs.map((listed) => listed.run.id),
                    ),
                  )
                  .orderBy(asc(DbSchema.jobs.createdAt), asc(DbSchema.jobs.id));
          return jarl.ok({
            suite: found,
            runs: runs.map((listed) => ({
              ...listed,
              jobs: history.filter((taken) => taken.runId === listed.run.id),
            })),
          });
        })
        .then(settle),

    listTestSuites: (limit) =>
      db.run(async (d) => {
        const rows = await d
          .select()
          .from(DbSchema.testSuites)
          .orderBy(desc(DbSchema.testSuites.startedAt), desc(DbSchema.testSuites.id))
          .limit(limit);
        const counts = await countRuns(
          d,
          rows.map((row) => row.id),
        );
        return rows.map((row) => ({ ...row, runs: counts.get(row.id) ?? noRuns() }));
      }),

    completeSuite: (suiteId, status, reason) =>
      moveSuite(
        "completeSuite",
        suiteId,
        suite.running,
        { status, reason, endedAt: now },
        openRunOf("completeSuite"),
      ),

    abortSuite: (suiteId, reason) =>
      moveSuite(
        "abortSuite",
        suiteId,
        suite.open,
        { status: "aborted", reason, endedAt: now },
        openRunOf("abortSuite"),
      ),

    // A test run on its own and its pending job, in one transaction. A setup names that job on
    // the server's existing lock before the transaction commits, so a crash cannot leave the
    // job with no server, or the lock with no job.
    createTestRun: ({ definitionId, iso, serverUrl, setupServer }) =>
      db
        .run(async (d): Promise<jarl.Result<NewTestRun, Refusal>> => {
          try {
            return await d.transaction(async (tx): Promise<jarl.Result<NewTestRun, Refusal>> => {
              const names = await definitionNames(tx, [definitionId]);
              const name = names.get(definitionId);
              if (name === undefined) {
                return jarl.err(
                  new NotFound(`createTestRun: no test definition ${String(definitionId)}`),
                );
              }
              if (name === SETUP) {
                if (setupServer === undefined) {
                  return jarl.err(
                    new InvalidState("createTestRun: a setup needs the server whose lock it takes"),
                  );
                }
                const [lock] = await tx
                  .select({ jobId: DbSchema.setupRequests.jobId })
                  .from(DbSchema.setupRequests)
                  .where(
                    and(
                      eq(DbSchema.setupRequests.iso, iso),
                      eq(DbSchema.setupRequests.serverUrl, setupServer),
                    ),
                  )
                  .for("update");
                if (lock === undefined) {
                  return jarl.err(
                    new NotFound(`createTestRun: no setup lock for ${iso} on ${setupServer}`),
                  );
                }
                if (lock.jobId !== null) {
                  return jarl.err(
                    new InvalidState(
                      `createTestRun: setup lock for ${iso} on ${setupServer} already has a job`,
                    ),
                  );
                }
                const filed = await fileRun(
                  tx,
                  "createTestRun",
                  { suiteId: null, definitionId, iso, serverUrl },
                  "setup",
                );
                const named = await tx
                  .update(DbSchema.setupRequests)
                  .set({ jobId: filed.job.id })
                  .where(
                    and(
                      eq(DbSchema.setupRequests.iso, iso),
                      eq(DbSchema.setupRequests.serverUrl, setupServer),
                      sql`${DbSchema.setupRequests.jobId} is null`,
                    ),
                  )
                  .returning({ iso: DbSchema.setupRequests.iso });
                if (named.length === 0) {
                  throw new InvalidState(
                    `createTestRun: setup lock for ${iso} on ${setupServer} already has a job`,
                  );
                }
                return jarl.ok(filed);
              }
              if (setupServer !== undefined) {
                return jarl.err(new InvalidState("createTestRun: a drive names no setup server"));
              }
              return jarl.ok(
                await fileRun(
                  tx,
                  "createTestRun",
                  { suiteId: null, definitionId, iso, serverUrl },
                  "drive",
                ),
              );
            });
          } catch (error) {
            const refusal = caught(error);
            if (refusal !== undefined) {
              return jarl.err(refusal);
            }
            throw error;
          }
        })
        .then(settle),

    getTestRun: (runId) =>
      db
        .run(async (d): Promise<jarl.Result<TestRunSummary, NotFound>> => {
          const [row] = await d
            .select(runSummary)
            .from(DbSchema.testRuns)
            .innerJoin(
              DbSchema.testDefinitions,
              eq(DbSchema.testDefinitions.id, DbSchema.testRuns.definitionId),
            )
            .leftJoin(DbSchema.testSuites, eq(DbSchema.testSuites.id, DbSchema.testRuns.suiteId))
            .where(eq(DbSchema.testRuns.id, runId));
          return row === undefined
            ? jarl.err(new NotFound(`getTestRun: no test run ${runId}`))
            : jarl.ok(row);
        })
        .then(settle),

    getTestRunDetails: (runId) =>
      db
        .run(async (d): Promise<jarl.Result<TestRunDetails, NotFound>> => {
          const [row] = await d
            .select({
              run: DbSchema.testRuns,
              suite: DbSchema.testSuites,
              definition: DbSchema.testDefinitions,
            })
            .from(DbSchema.testRuns)
            .leftJoin(DbSchema.testSuites, eq(DbSchema.testSuites.id, DbSchema.testRuns.suiteId))
            .innerJoin(
              DbSchema.testDefinitions,
              eq(DbSchema.testDefinitions.id, DbSchema.testRuns.definitionId),
            )
            .where(eq(DbSchema.testRuns.id, runId));
          if (row === undefined) {
            return jarl.err(new NotFound(`getTestRunDetails: no test run ${runId}`));
          }
          const history = await d
            .select()
            .from(DbSchema.jobs)
            .where(eq(DbSchema.jobs.runId, runId))
            .orderBy(asc(DbSchema.jobs.createdAt), asc(DbSchema.jobs.id));
          return jarl.ok({ ...row, jobs: history });
        })
        .then(settle),

    listTestRuns: (suiteId) =>
      db.run((d) =>
        d
          .select(runSummary)
          .from(DbSchema.testRuns)
          .innerJoin(
            DbSchema.testDefinitions,
            eq(DbSchema.testDefinitions.id, DbSchema.testRuns.definitionId),
          )
          .leftJoin(DbSchema.testSuites, eq(DbSchema.testSuites.id, DbSchema.testRuns.suiteId))
          .where(eq(DbSchema.testRuns.suiteId, suiteId))
          .orderBy(asc(DbSchema.testRuns.createdAt), asc(DbSchema.testRuns.id)),
      ),

    startRun: (runId, model) =>
      moveRun("startRun", runId, run.pending, { status: "running", model }),

    completeRun: (runId, status, reason) =>
      moveRun("completeRun", runId, run.running, { status, reason, finishedAt: now }),

    errorRun: (runId, reason) =>
      moveRun(
        "errorRun",
        runId,
        run.running,
        { status: "errored", reason, finishedAt: now },
        openJobOf("errorRun"),
      ),

    abortRun: (runId, reason) =>
      moveRun(
        "abortRun",
        runId,
        run.open,
        { status: "aborted", reason, finishedAt: now },
        openJobOf("abortRun"),
      ),

    createJob: (runId, action) =>
      db
        .run((d) =>
          d.transaction(async (tx): Promise<jarl.Result<JobRow, Refusal>> => {
            const [held] = await tx
              .select()
              .from(DbSchema.testRuns)
              .where(eq(DbSchema.testRuns.id, runId))
              .for("update");
            if (held === undefined) {
              return jarl.err(new NotFound(`createJob: no test run ${runId}`));
            }
            if (!run.open.accepts(held)) {
              return jarl.err(
                new InvalidState(
                  `createJob: test run ${runId} is ${held.status}; needs ${run.open.need}`,
                ),
              );
            }
            const open = await openJobOf("createJob")(tx, runId);
            if (open !== undefined) {
              return jarl.err(new InvalidState(open));
            }
            return jarl.ok(
              only(
                await tx.insert(DbSchema.jobs).values({ runId, action }).returning(),
                "createJob",
              ),
            );
          }),
        )
        .then(settle),

    getJob: (jobId) =>
      db
        .run(async (d): Promise<jarl.Result<JobSummary, NotFound>> => {
          const [row] = await d
            .select(jobSummary)
            .from(DbSchema.jobs)
            .innerJoin(DbSchema.testRuns, eq(DbSchema.testRuns.id, DbSchema.jobs.runId))
            .innerJoin(
              DbSchema.testDefinitions,
              eq(DbSchema.testDefinitions.id, DbSchema.testRuns.definitionId),
            )
            .where(eq(DbSchema.jobs.id, jobId));
          return row === undefined
            ? jarl.err(new NotFound(`getJob: no job ${jobId}`))
            : jarl.ok(row);
        })
        .then(settle),

    getJobDetails: (jobId) =>
      db
        .run(async (d): Promise<jarl.Result<JobDetails, NotFound>> => {
          const [row] = await d
            .select({
              job: DbSchema.jobs,
              run: DbSchema.testRuns,
              suite: DbSchema.testSuites,
              definition: DbSchema.testDefinitions,
            })
            .from(DbSchema.jobs)
            .innerJoin(DbSchema.testRuns, eq(DbSchema.testRuns.id, DbSchema.jobs.runId))
            .leftJoin(DbSchema.testSuites, eq(DbSchema.testSuites.id, DbSchema.testRuns.suiteId))
            .innerJoin(
              DbSchema.testDefinitions,
              eq(DbSchema.testDefinitions.id, DbSchema.testRuns.definitionId),
            )
            .where(eq(DbSchema.jobs.id, jobId));
          return row === undefined
            ? jarl.err(new NotFound(`getJobDetails: no job ${jobId}`))
            : jarl.ok(row);
        })
        .then(settle),

    // One repeatable-read snapshot, so a job claimed between the two reads is in exactly one list.
    listJobs: (limit = QUEUE_LIMIT) =>
      db.run((d) =>
        d.transaction(
          async (tx): Promise<Queue> => {
            const listed = (status: JobStatus) =>
              tx
                .select(queuedJob)
                .from(DbSchema.jobs)
                .innerJoin(DbSchema.testRuns, eq(DbSchema.testRuns.id, DbSchema.jobs.runId))
                .innerJoin(
                  DbSchema.testDefinitions,
                  eq(DbSchema.testDefinitions.id, DbSchema.testRuns.definitionId),
                )
                .leftJoin(client, eq(client.id, DbSchema.jobs.serverId))
                .leftJoin(DbSchema.jobServers, eq(DbSchema.jobServers.jobId, DbSchema.jobs.id))
                .where(eq(DbSchema.jobs.status, status))
                .orderBy(queueRank, asc(DbSchema.jobs.createdAt), asc(DbSchema.jobs.id))
                .limit(limit);
            return { running: await listed("running"), pending: await listed("pending") };
          },
          { isolationLevel: "repeatable read", accessMode: "read only" },
        ),
      ),

    latestJob: (runId, action) =>
      db.run(async (d) => {
        const [row] = await d
          .select()
          .from(DbSchema.jobs)
          .where(and(eq(DbSchema.jobs.runId, runId), eq(DbSchema.jobs.action, action)))
          .orderBy(desc(DbSchema.jobs.createdAt), desc(DbSchema.jobs.id))
          .limit(1);
        return row;
      }),

    nextPendingJob: (except) =>
      db.run(async (d) => {
        const pending = eq(DbSchema.jobs.status, "pending");
        const [row] = await d
          .select()
          .from(DbSchema.jobs)
          .where(
            except.length === 0 ? pending : and(pending, notInArray(DbSchema.jobs.id, [...except])),
          )
          .orderBy(queueRank, asc(DbSchema.jobs.createdAt), asc(DbSchema.jobs.id))
          .limit(1);
        return row;
      }),

    runJob: (jobId, serverId) =>
      moveJob("runJob", jobId, job.pending, { status: "running", serverId, startedAt: now }),

    completeJob: (jobId) =>
      moveJob("completeJob", jobId, job.running, { status: "completed", finishedAt: now }),

    finalizeJob: (jobId, status, reason) =>
      moveJob("finalizeJob", jobId, job.completedJudged, { status, reason }),

    errorJob: (jobId, reason) =>
      moveJob("errorJob", jobId, job.errorable, {
        status: "errored",
        reason,
        finishedAt: sql`coalesce(${DbSchema.jobs.finishedAt}, now())`,
      }),

    timeoutJob: (jobId, reason) =>
      moveJob("timeoutJob", jobId, job.running, { status: "timed_out", reason, finishedAt: now }),

    abortJob: (jobId, reason) =>
      moveJob("abortJob", jobId, job.open, { status: "aborted", reason, finishedAt: now }),
  };
});
