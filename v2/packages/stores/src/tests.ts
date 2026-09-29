import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import * as jarl from "jarl";
import type { Answer } from "./answer.ts";

// A transition asked of a row that is not in a state it moves from, or a create whose parent
// is not ready for it. The message names the row, the state it is in, and what was needed.
export const InvalidState = jarl.error.define("InvalidState");
export type InvalidState = InstanceType<typeof InvalidState>;

export const NotFound = jarl.error.define("NotFound");
export type NotFound = InstanceType<typeof NotFound>;

// A suite already holds a test run for that definition.
export const Duplicate = jarl.error.define("Duplicate");
export type Duplicate = InstanceType<typeof Duplicate>;

export type DefinitionRow = typeof DbSchema.testDefinitions.$inferSelect;

export type BasePromptRow = typeof DbSchema.testBasePrompts.$inferSelect;

export type SuiteRow = typeof DbSchema.testSuites.$inferSelect;

export type RunRow = typeof DbSchema.testRuns.$inferSelect;

export type JobRow = typeof DbSchema.jobs.$inferSelect;

export type JobAction = JobRow["action"];

export type DefinitionInput = {
  readonly name: string;
  readonly description: string;
  readonly instruction: string;
  readonly proof: string;
};

export type DefinedDefinition = {
  readonly id: number;
  // The row's place among its name's rows by id: 1 for a new name.
  readonly version: number;
};

export type SuiteInput = {
  readonly name: string;
  readonly iso: string;
  readonly serverUrl: string;
};

export type SuiteVerdict = "passed" | "failed";

export type RunVerdict = "passed" | "failed";

export type JobVerdict = "succeeded" | "failed";

// The row as the transition left it, or why it did not move.
export type Moved<T> = Promise<jarl.Result<T, Db.DatabaseError | InvalidState | NotFound>>;

export type Tests = {
  readonly service: "tests";
  readonly listTestDefinitions: () => Answer<ReadonlyArray<DefinitionRow>>;
  readonly findTestDefinition: (name: string) => Answer<DefinitionRow | undefined>;
  readonly listTestDefinitionHistory: (name?: string) => Answer<ReadonlyArray<DefinitionRow>>;
  readonly defineTestDefinition: (input: DefinitionInput) => Answer<DefinedDefinition>;
  readonly listTestBasePrompts: () => Answer<ReadonlyArray<BasePromptRow>>;
  readonly definitionName: (id: number) => Answer<string | undefined>;

  readonly createTestSuite: (input: SuiteInput) => Answer<SuiteRow>;
  readonly findTestSuite: (suiteId: string) => Answer<SuiteRow | undefined>;
  readonly startSuite: (suiteId: string) => Moved<SuiteRow>;
  readonly completeSuite: (
    suiteId: string,
    status: SuiteVerdict,
    reason: string | null,
  ) => Moved<SuiteRow>;
  readonly abortSuite: (suiteId: string, reason: string) => Moved<SuiteRow>;

  readonly createTestRun: (
    suiteId: string,
    definitionId: number,
  ) => Promise<jarl.Result<RunRow, Db.DatabaseError | InvalidState | NotFound | Duplicate>>;
  readonly findTestRun: (runId: string) => Answer<RunRow | undefined>;
  readonly startRun: (runId: string) => Moved<RunRow>;
  readonly completeRun: (runId: string, status: RunVerdict, reason: string | null) => Moved<RunRow>;
  readonly errorRun: (runId: string, reason: string) => Moved<RunRow>;
  readonly abortRun: (runId: string, reason: string) => Moved<RunRow>;

  readonly createJob: (runId: string, action: JobAction) => Moved<JobRow>;
  readonly findJob: (jobId: string) => Answer<JobRow | undefined>;
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

const settle = <T, E>(
  answer: jarl.Result<jarl.Result<T, E>, Db.DatabaseError>,
): jarl.Result<T, E | Db.DatabaseError> => (answer.ok ? answer.value : answer);

const only = <T>(rows: ReadonlyArray<T>, what: string): T => {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`${what}: the write returned no row`);
  }
  return row;
};

const now = sql`now()`;

const job = {
  pending: { accepts: (row) => row.status === "pending", need: "pending" },
  running: { accepts: (row) => row.status === "running", need: "running" },
  completedJudged: {
    accepts: (row) => row.status === "completed" && row.action !== "diagnose",
    need: "a completed drive or mint",
  },
  errorable: {
    accepts: (row) =>
      row.status === "running" || (row.status === "completed" && row.action !== "diagnose"),
    need: "running, or a completed drive or mint",
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
  pending: { accepts: (row) => row.status === "pending", need: "pending" },
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
export const create = (db: Db.Database): Tests => {
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

    createTestSuite: (input) =>
      db.run(async (d) =>
        only(await d.insert(DbSchema.testSuites).values(input).returning(), "createTestSuite"),
      ),

    findTestSuite: (suiteId) =>
      db.run(async (d) => {
        const [row] = await d
          .select()
          .from(DbSchema.testSuites)
          .where(eq(DbSchema.testSuites.id, suiteId));
        return row;
      }),

    startSuite: (suiteId) => moveSuite("startSuite", suiteId, suite.pending, { status: "running" }),

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

    createTestRun: (suiteId, definitionId) =>
      db
        .run((d) =>
          d.transaction(
            async (tx): Promise<jarl.Result<RunRow, InvalidState | NotFound | Duplicate>> => {
              const [held] = await tx
                .select({ status: DbSchema.testSuites.status })
                .from(DbSchema.testSuites)
                .where(eq(DbSchema.testSuites.id, suiteId))
                .for("update");
              if (held === undefined) {
                return jarl.err(new NotFound(`createTestRun: no test suite ${suiteId}`));
              }
              if (held.status !== "pending") {
                return jarl.err(
                  new InvalidState(
                    `createTestRun: test suite ${suiteId} is ${held.status}; needs pending`,
                  ),
                );
              }
              const [known] = await tx
                .select({ id: DbSchema.testDefinitions.id })
                .from(DbSchema.testDefinitions)
                .where(eq(DbSchema.testDefinitions.id, definitionId));
              if (known === undefined) {
                return jarl.err(
                  new NotFound(`createTestRun: no test definition ${String(definitionId)}`),
                );
              }
              const [twin] = await tx
                .select({ id: DbSchema.testRuns.id })
                .from(DbSchema.testRuns)
                .where(
                  and(
                    eq(DbSchema.testRuns.suiteId, suiteId),
                    eq(DbSchema.testRuns.definitionId, definitionId),
                  ),
                );
              if (twin !== undefined) {
                return jarl.err(
                  new Duplicate(
                    `createTestRun: test suite ${suiteId} already has test definition ${String(definitionId)}`,
                  ),
                );
              }
              return jarl.ok(
                only(
                  await tx.insert(DbSchema.testRuns).values({ suiteId, definitionId }).returning(),
                  "createTestRun",
                ),
              );
            },
          ),
        )
        .then(settle),

    findTestRun: (runId) =>
      db.run(async (d) => {
        const [row] = await d
          .select()
          .from(DbSchema.testRuns)
          .where(eq(DbSchema.testRuns.id, runId));
        return row;
      }),

    startRun: (runId) => moveRun("startRun", runId, run.pending, { status: "running" }),

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

    findJob: (jobId) =>
      db.run(async (d) => {
        const [row] = await d.select().from(DbSchema.jobs).where(eq(DbSchema.jobs.id, jobId));
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
};
