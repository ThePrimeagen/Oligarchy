import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import * as jarl from "jarl";
import type { Answer } from "./answer.ts";

export type Status = (typeof DbSchema.jobStatus.enumValues)[number];

export type Kind = (typeof DbSchema.jobKind.enumValues)[number];

export type Verdict = (typeof DbSchema.verdict.enumValues)[number];

// What the driving agent claimed, before anyone reviewed it.
export type Report = { readonly status: Verdict; readonly reason: string | null };

export type Job = {
  readonly id: string;
  readonly run: string;
  readonly iso: string;
  readonly serverUrl: string;
  readonly definition: number;
  readonly kind: Kind;
  readonly status: Status;
  readonly client: string | null;
  readonly report: Report | null;
  // The job this one reruns.
  readonly previous: string | null;
  readonly reason: string | null;
  readonly createdAt: Date;
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
};

export type JobEvent = {
  readonly job: string;
  readonly from: Status | null;
  readonly to: Status;
  readonly reason: string | null;
  readonly at: Date;
};

export class JobNotFound extends jarl.error.define("JobNotFound") {
  readonly job: string;
  constructor(job: string) {
    super(`jobs: no job ${job}`);
    this.job = job;
  }
}

export class StatusConflict extends jarl.error.define("StatusConflict") {
  readonly job: string;
  readonly expected: ReadonlyArray<Status>;
  readonly actual: Status;
  constructor(job: string, expected: ReadonlyArray<Status>, actual: Status) {
    super(`jobs: job ${job} is ${actual}, not ${expected.join(" or ")}`);
    this.job = job;
    this.expected = expected;
    this.actual = actual;
  }
}

export class AlreadyRerun extends jarl.error.define("AlreadyRerun") {
  readonly job: string;
  readonly rerun: string;
  constructor(job: string, rerun: string) {
    super(`jobs: job ${job} was already rerun as ${rerun}`);
    this.job = job;
    this.rerun = rerun;
  }
}

export const NoDefinitions = jarl.error.define("NoDefinitions");
export type NoDefinitions = InstanceType<typeof NoDefinitions>;

export class DefinitionNotFound extends jarl.error.define("DefinitionNotFound") {
  readonly definitions: ReadonlyArray<number>;
  constructor(definitions: ReadonlyArray<number>) {
    super(`jobs: no definition ${definitions.join(", ")}`);
    this.definitions = definitions;
  }
}

type Moved<E = never> = Promise<
  jarl.Result<Job, Db.DatabaseError | JobNotFound | StatusConflict | E>
>;

// A move's refusals, as its transaction returns them.
type Refused<E = never> = Promise<jarl.Result<Job, JobNotFound | StatusConflict | E>>;

export type Jobs = {
  readonly service: "jobs";
  // One run and a pending job per definition, in the order given.
  readonly create: (input: {
    readonly iso: string;
    readonly serverUrl: string;
    readonly definitions: ReadonlyArray<number>;
  }) => Promise<
    jarl.Result<ReadonlyArray<Job>, Db.DatabaseError | NoDefinitions | DefinitionNotFound>
  >;
  readonly get: (id: string) => Promise<jarl.Result<Job, Db.DatabaseError | JobNotFound>>;
  // Newest first.
  readonly list: (filter: {
    readonly status?: Status;
    readonly run?: string;
    readonly count: number;
  }) => Answer<ReadonlyArray<Job>>;
  // The job a client should take next, left where it is: start claims it.
  readonly next: (skip: ReadonlyArray<string>) => Answer<Job | undefined>;
  readonly history: (
    id: string,
  ) => Promise<jarl.Result<ReadonlyArray<JobEvent>, Db.DatabaseError | JobNotFound>>;
  // pending to running, a drive; needs_review to reviewing, a review.
  readonly start: (id: string, client: string) => Moved;
  // Only while running; the status stays and no event is written.
  readonly report: (id: string, status: Verdict, reason: string | null) => Moved;
  // A test waits for its review; a mint has nothing to review and succeeds.
  readonly complete: (id: string) => Moved;
  readonly judge: (id: string, verdict: Verdict, reason: string | null) => Moved;
  // A review that was lost goes back to the end of the queue.
  readonly requeueReview: (id: string, reason: string) => Moved;
  readonly error: (id: string, reason: string) => Moved;
  readonly abort: (id: string) => Moved;
  // A new pending job for an ended one's definition, in the same run.
  readonly rerun: (id: string) => Moved<AlreadyRerun>;
};

declare module "@oligarchy/app" {
  interface Services {
    jobs: App.Register<"jobs", Jobs>;
  }
}

const LIVE: ReadonlyArray<Status> = ["pending", "running", "needs_review", "reviewing"];
const TERMINAL: ReadonlyArray<Status> = ["succeeded", "failed", "errored", "aborted"];
const QUEUED: Array<Status> = ["pending", "needs_review"];

// Postgres refuses anything else as a uuid with an error, and no job has such an id.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (id: string): boolean => UUID.test(id);

const now = sql`now()`;

const columns = {
  id: DbSchema.jobs.id,
  run: DbSchema.jobs.runId,
  iso: DbSchema.runs.iso,
  serverUrl: DbSchema.runs.serverUrl,
  definition: DbSchema.jobs.definitionId,
  kind: DbSchema.jobs.kind,
  status: DbSchema.jobs.status,
  client: DbSchema.jobs.client,
  reportStatus: DbSchema.jobs.reportStatus,
  reportReason: DbSchema.jobs.reportReason,
  previous: DbSchema.jobs.previousId,
  reason: DbSchema.jobs.reason,
  createdAt: DbSchema.jobs.createdAt,
  queuedAt: DbSchema.jobs.queuedAt,
  startedAt: DbSchema.jobs.startedAt,
  finishedAt: DbSchema.jobs.finishedAt,
};

type Query = Pick<Db.Drizzle, "select">;

const select = (d: Query) =>
  d
    .select(columns)
    .from(DbSchema.jobs)
    .innerJoin(DbSchema.runs, eq(DbSchema.runs.id, DbSchema.jobs.runId));

type Row = Awaited<ReturnType<typeof select>>[number];

const toJob = ({ reportStatus, reportReason, ...job }: Row): Job => ({
  ...job,
  report: reportStatus === null ? null : { status: reportStatus, reason: reportReason },
});

const read = async (d: Query, id: string): Promise<Job> => {
  const [row] = await select(d).where(eq(DbSchema.jobs.id, id));
  if (row === undefined) {
    throw new Error(`jobs: job ${id} is gone inside its own transaction`);
  }
  return toJob(row);
};

// The lock is taken on jobs alone: a join would need FOR UPDATE OF, and Postgres refuses the
// schema-qualified name drizzle writes there.
const locked = async (tx: Db.Drizzle, id: string): Promise<Job | undefined> => {
  const [row] = await tx
    .select({ id: DbSchema.jobs.id })
    .from(DbSchema.jobs)
    .where(eq(DbSchema.jobs.id, id))
    .for("update");
  return row === undefined ? undefined : read(tx, id);
};

// A refusal found inside a transaction, alongside the transaction's own failure.
const flat = <T, E>(
  result: jarl.Result<jarl.Result<T, E>, Db.DatabaseError>,
): jarl.Result<T, E | Db.DatabaseError> => (result.ok ? result.value : result);

// What a move writes: the columns it sets, and the status it moves to with the event's reason.
// A change with no `to` keeps the status and writes no event.
type Change = {
  readonly set: PgUpdateSetSource<typeof DbSchema.jobs>;
  readonly to?: Status;
  readonly reason?: string | null;
};

export const create = (db: Db.Database): Jobs => {
  const move = async (
    id: string,
    from: ReadonlyArray<Status>,
    change: (job: Job) => Change,
  ): Moved => {
    if (!isId(id)) {
      return jarl.err(new JobNotFound(id));
    }
    return flat(
      await db.transaction(async (tx): Refused => {
        const job = await locked(tx, id);
        if (job === undefined) {
          return jarl.err(new JobNotFound(id));
        }
        if (!from.includes(job.status)) {
          return jarl.err(new StatusConflict(id, from, job.status));
        }
        const { set, to, reason = null } = change(job);
        await tx
          .update(DbSchema.jobs)
          .set(to === undefined ? set : { ...set, status: to })
          .where(eq(DbSchema.jobs.id, id));
        if (to !== undefined) {
          await tx.insert(DbSchema.jobEvents).values({ jobId: id, from: job.status, to, reason });
        }
        return jarl.ok(await read(tx, id));
      }),
    );
  };

  return {
    service: "jobs",

    create: async (input) => {
      if (input.definitions.length === 0) {
        return jarl.err(new NoDefinitions("jobs: a run needs a definition"));
      }
      return flat(
        await db.transaction(async (tx) => {
          const asked = [...new Set(input.definitions)];
          const found = await tx
            .select({ id: DbSchema.definitions.id, name: DbSchema.definitions.name })
            .from(DbSchema.definitions)
            .where(inArray(DbSchema.definitions.id, asked));
          const names = new Map(found.map((row) => [row.id, row.name]));
          const missing = asked.filter((id) => !names.has(id));
          if (missing.length > 0) {
            return jarl.err(new DefinitionNotFound(missing));
          }
          const [run] = await tx
            .insert(DbSchema.runs)
            .values({ iso: input.iso, serverUrl: input.serverUrl })
            .returning({ id: DbSchema.runs.id });
          if (run === undefined) {
            throw new Error("jobs: the run insert returned no row");
          }
          // A mint is the definition named mint: it builds the disk the tests resume from.
          const made = await tx
            .insert(DbSchema.jobs)
            .values(
              input.definitions.map((definitionId) => ({
                runId: run.id,
                definitionId,
                kind: names.get(definitionId) === "mint" ? ("mint" as const) : ("test" as const),
              })),
            )
            .returning({ id: DbSchema.jobs.id });
          await tx
            .insert(DbSchema.jobEvents)
            .values(made.map((job) => ({ jobId: job.id, to: "pending" as const })));
          const rows = await select(tx)
            .where(eq(DbSchema.jobs.runId, run.id))
            .orderBy(DbSchema.jobs.seq);
          return jarl.ok(rows.map(toJob));
        }),
      );
    },

    get: async (id) => {
      if (!isId(id)) {
        return jarl.err(new JobNotFound(id));
      }
      const found = await db.run(async (d) => {
        const [row] = await select(d).where(eq(DbSchema.jobs.id, id));
        return row;
      });
      if (!found.ok) {
        return found;
      }
      return found.value === undefined
        ? jarl.err(new JobNotFound(id))
        : jarl.ok(toJob(found.value));
    },

    list: (filter) =>
      db.run(async (d) => {
        const rows = await select(d)
          .where(
            and(
              filter.status === undefined ? undefined : eq(DbSchema.jobs.status, filter.status),
              filter.run === undefined ? undefined : eq(DbSchema.jobs.runId, filter.run),
            ),
          )
          .orderBy(desc(DbSchema.jobs.seq))
          .limit(filter.count);
        return rows.map(toJob);
      }),

    // Mints first, since every test resumes from one; then reviews, since a review finishes a
    // job a drive already paid for; then oldest first.
    next: (skip) =>
      db.run(async (d) => {
        const skipped = skip.filter(isId);
        const [row] = await select(d)
          .where(
            and(
              inArray(DbSchema.jobs.status, QUEUED),
              skipped.length === 0 ? undefined : notInArray(DbSchema.jobs.id, skipped),
            ),
          )
          .orderBy(
            asc(DbSchema.jobs.kind),
            sql`case when ${DbSchema.jobs.status} = 'needs_review' then 0 else 1 end`,
            asc(DbSchema.jobs.queuedAt),
            asc(DbSchema.jobs.seq),
          )
          .limit(1);
        return row === undefined ? undefined : toJob(row);
      }),

    history: async (id) => {
      if (!isId(id)) {
        return jarl.err(new JobNotFound(id));
      }
      const events = await db.run((d) =>
        d
          .select({
            job: DbSchema.jobEvents.jobId,
            from: DbSchema.jobEvents.from,
            to: DbSchema.jobEvents.to,
            reason: DbSchema.jobEvents.reason,
            at: DbSchema.jobEvents.at,
          })
          .from(DbSchema.jobEvents)
          .where(eq(DbSchema.jobEvents.jobId, id))
          .orderBy(DbSchema.jobEvents.id),
      );
      // Every job has the event its create wrote.
      if (events.ok && events.value.length === 0) {
        return jarl.err(new JobNotFound(id));
      }
      return events;
    },

    start: (id, client) =>
      move(id, QUEUED, (job) => ({
        to: job.status === "pending" ? "running" : "reviewing",
        set: { client, startedAt: sql`coalesce(${DbSchema.jobs.startedAt}, now())` },
      })),

    report: (id, status, reason) =>
      move(id, ["running"], () => ({ set: { reportStatus: status, reportReason: reason } })),

    complete: (id) =>
      move(id, ["running"], (job) =>
        job.kind === "mint"
          ? { to: "succeeded", set: { finishedAt: now } }
          : { to: "needs_review", set: { queuedAt: now } },
      ),

    judge: (id, verdict, reason) =>
      move(id, ["reviewing"], () => ({
        to: verdict === "passed" ? "succeeded" : "failed",
        set: { reason, finishedAt: now },
        reason,
      })),

    requeueReview: (id, reason) =>
      move(id, ["reviewing"], () => ({ to: "needs_review", set: { queuedAt: now }, reason })),

    error: (id, reason) =>
      move(id, LIVE, () => ({ to: "errored", set: { reason, finishedAt: now }, reason })),

    abort: (id) => move(id, LIVE, () => ({ to: "aborted", set: { finishedAt: now } })),

    rerun: async (id) => {
      if (!isId(id)) {
        return jarl.err(new JobNotFound(id));
      }
      return flat(
        await db.transaction(async (tx): Refused<AlreadyRerun> => {
          const job = await locked(tx, id);
          if (job === undefined) {
            return jarl.err(new JobNotFound(id));
          }
          if (!TERMINAL.includes(job.status)) {
            return jarl.err(new StatusConflict(id, TERMINAL, job.status));
          }
          const [earlier] = await tx
            .select({ id: DbSchema.jobs.id })
            .from(DbSchema.jobs)
            .where(eq(DbSchema.jobs.previousId, id));
          if (earlier !== undefined) {
            return jarl.err(new AlreadyRerun(id, earlier.id));
          }
          const [made] = await tx
            .insert(DbSchema.jobs)
            .values({
              runId: job.run,
              definitionId: job.definition,
              kind: job.kind,
              previousId: id,
            })
            .returning({ id: DbSchema.jobs.id });
          if (made === undefined) {
            throw new Error("jobs: the rerun insert returned no row");
          }
          await tx.insert(DbSchema.jobEvents).values({ jobId: made.id, to: "pending" });
          return jarl.ok(await read(tx, made.id));
        }),
      );
    },
  };
};
