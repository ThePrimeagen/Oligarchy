import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { and, asc, desc, eq, gt, gte, like, lt, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import * as jarl from "jarl";
import { type Answer, settle } from "./answer.ts";
import { type Found, NotFound } from "./tests.ts";

// A frame asked for that the job does not have: the message says how many it has.
export const NoFrame = jarl.error.define("NoFrame");
export type NoFrame = InstanceType<typeof NoFrame>;

export type LogLevel = (typeof DbSchema.logLevel.enumValues)[number];

export type LogRow = typeof DbSchema.logs.$inferSelect;

export type DebugLogRow = typeof DbSchema.debugLogs.$inferSelect;

export type LogInput = {
  readonly text: string;
  readonly level: LogLevel;
  readonly location: string | null;
  readonly runId: string | null;
};

export type Intent = { readonly text: string; readonly createdAt: Date };

// A screenshot and its PNG; createdAt is when its screendump was asked for.
export type Screenshot = {
  readonly id: string;
  readonly actionId: number;
  readonly createdAt: Date;
  readonly data: Uint8Array;
};

// One screenshot of a job and everything from it until the next one: the moves the model made
// looking at it, the QMP exchanges they became, the log lines of the job's turn, and the VM's
// changes, each oldest first. Frame 0 is the newest screenshot and runs to the end of the job's
// turn; each frame after is one screenshot further back. The last frame, frames - 1, is
// everything before the first screenshot, and has none. openIntent is the intent open when the
// frame's screenshot was taken.
export type Frame = {
  readonly frame: number;
  readonly frames: number;
  readonly screenshot: Screenshot | null;
  readonly openIntent: string | null;
  readonly moves: ReadonlyArray<typeof DbSchema.moves.$inferSelect>;
  readonly actions: ReadonlyArray<typeof DbSchema.actions.$inferSelect>;
  readonly logs: ReadonlyArray<LogRow>;
  readonly vmStatus: ReadonlyArray<typeof DbSchema.vmStatus.$inferSelect>;
};

export type Logs = {
  readonly service: "logs";
  readonly insertLog: (row: LogInput) => Answer<void>;
  readonly listLogs: (location: string) => Answer<ReadonlyArray<LogRow>>;
  readonly listRecent: (limit: number) => Answer<ReadonlyArray<LogRow>>;
  readonly listIntents: (runId: string) => Answer<ReadonlyArray<Intent>>;
  readonly getFrame: (
    jobId: string,
    frame: number,
  ) => Promise<jarl.Result<Frame, Db.DatabaseError | NotFound | NoFrame>>;
  readonly getDebugLog: (jobId: string) => Found<DebugLogRow>;
};

declare module "@oligarchy/app" {
  interface Services {
    logs: App.Register<"logs", Logs>;
  }
}

const INTENT_START = "intent start; ";

const isIntent = or(
  like(DbSchema.logs.text, `${INTENT_START}%`),
  eq(DbSchema.logs.text, "intent end"),
);

// A test run holds one open job at a time, so its lines fall into turns: a job's turn runs from
// when it was queued until the run's next job was queued, or until now for the newest. fn names
// the caller in the refusal.
export const turnOf = async (
  d: Db.Drizzle,
  fn: string,
  jobId: string,
): Promise<jarl.Result<ReadonlyArray<LogRow>, NotFound>> => {
  const [job] = await d
    .select({ runId: DbSchema.jobs.runId, createdAt: DbSchema.jobs.createdAt })
    .from(DbSchema.jobs)
    .where(eq(DbSchema.jobs.id, jobId));
  if (job === undefined) {
    return jarl.err(new NotFound(`${fn}: no job ${jobId}`));
  }
  const [next] = await d
    .select({ createdAt: DbSchema.jobs.createdAt })
    .from(DbSchema.jobs)
    .where(and(eq(DbSchema.jobs.runId, job.runId), gt(DbSchema.jobs.createdAt, job.createdAt)))
    .orderBy(asc(DbSchema.jobs.createdAt))
    .limit(1);
  return jarl.ok(
    await d
      .select()
      .from(DbSchema.logs)
      .where(
        and(
          eq(DbSchema.logs.runId, job.runId),
          gte(DbSchema.logs.createdAt, job.createdAt),
          next === undefined ? undefined : lt(DbSchema.logs.createdAt, next.createdAt),
        ),
      )
      .orderBy(asc(DbSchema.logs.createdAt), asc(DbSchema.logs.id)),
  );
};

// Instants read in SQL rather than through a JavaScript Date, which keeps only milliseconds of
// Postgres's microseconds: a row a few microseconds either side of a screenshot stays on its side.
const askedAt = (actionId: number): SQL =>
  sql`(select ${DbSchema.actions.createdAt} from ${DbSchema.actions} where ${DbSchema.actions.id} = ${actionId})`;

const queuedAt = (jobId: string): SQL =>
  sql`(select ${DbSchema.jobs.createdAt} from ${DbSchema.jobs} where ${DbSchema.jobs.id} = ${jobId})`;

// When the run's next job was queued, ending this job's turn; never, for the newest.
const turnEnd = (runId: string, jobId: string): SQL =>
  sql`coalesce((select min(${DbSchema.jobs.createdAt}) from ${DbSchema.jobs} where ${DbSchema.jobs.runId} = ${runId} and ${DbSchema.jobs.createdAt} > ${queuedAt(jobId)}), 'infinity'::timestamptz)`;

const between = (column: PgColumn, from: SQL | undefined, until: SQL | undefined) =>
  and(
    from === undefined ? undefined : gte(column, from),
    until === undefined ? undefined : lt(column, until),
  );

export const create = App.createService<Db.Database, App.NoOptions, Logs>(({ db }) => ({
  service: "logs",

  insertLog: (row) =>
    db.run(async (d) => {
      await d.insert(DbSchema.logs).values(row);
    }),

  listLogs: (location) =>
    db.run((d) =>
      d
        .select()
        .from(DbSchema.logs)
        .where(eq(DbSchema.logs.location, location))
        .orderBy(DbSchema.logs.createdAt, DbSchema.logs.id),
    ),

  listRecent: (limit) =>
    db.run(async (d) => {
      const rows = await d
        .select()
        .from(DbSchema.logs)
        .orderBy(desc(DbSchema.logs.id))
        .limit(limit);
      return rows.reverse();
    }),

  listIntents: (runId) =>
    db.run((d) =>
      d
        .select({ text: DbSchema.logs.text, createdAt: DbSchema.logs.createdAt })
        .from(DbSchema.logs)
        .where(and(eq(DbSchema.logs.runId, runId), isIntent))
        .orderBy(DbSchema.logs.id),
    ),

  // One snapshot, so a frame never holds half of a write. The screenshots are counted newest
  // first: frame n's is the one OFFSET n, and the one OFFSET n - 1 ends it.
  getFrame: (jobId, frame) =>
    db
      .run((d) =>
        d.transaction(
          async (tx): Promise<jarl.Result<Frame, NotFound | NoFrame>> => {
            const [job] = await tx
              .select({ runId: DbSchema.jobs.runId })
              .from(DbSchema.jobs)
              .where(eq(DbSchema.jobs.id, jobId));
            if (job === undefined) {
              return jarl.err(new NotFound(`getFrame: no job ${jobId}`));
            }
            const screenshots = tx
              .select({
                id: DbSchema.images.id,
                actionId: DbSchema.images.actionId,
                createdAt: DbSchema.actions.createdAt,
                data: DbSchema.images.data,
              })
              .from(DbSchema.images)
              .innerJoin(DbSchema.actions, eq(DbSchema.actions.id, DbSchema.images.actionId))
              .where(eq(DbSchema.actions.jobId, jobId))
              .$dynamic();
            const [counted] = await tx
              .select({ count: sql<number>`count(*)`.mapWith(Number) })
              .from(DbSchema.images)
              .innerJoin(DbSchema.actions, eq(DbSchema.actions.id, DbSchema.images.actionId))
              .where(eq(DbSchema.actions.jobId, jobId));
            const frames = (counted?.count ?? 0) + 1;
            if (!Number.isInteger(frame) || frame < 0 || frame >= frames) {
              return jarl.err(
                new NoFrame(
                  `getFrame: job ${jobId} has ${String(frames)} frames; no frame ${String(frame)}`,
                ),
              );
            }
            const pair = await screenshots
              .orderBy(desc(DbSchema.actions.id))
              .offset(Math.max(frame - 1, 0))
              .limit(frame === 0 ? 1 : 2);
            const newer = frame === 0 ? undefined : pair[0];
            const shot = frame === 0 ? pair[0] : pair[1];
            const from = shot === undefined ? undefined : askedAt(shot.actionId);
            const until = newer === undefined ? undefined : askedAt(newer.actionId);

            const actions = await tx
              .select()
              .from(DbSchema.actions)
              .where(
                and(
                  eq(DbSchema.actions.jobId, jobId),
                  shot === undefined ? undefined : gte(DbSchema.actions.id, shot.actionId),
                  newer === undefined ? undefined : lt(DbSchema.actions.id, newer.actionId),
                ),
              )
              .orderBy(asc(DbSchema.actions.id));
            const moves = await tx
              .select()
              .from(DbSchema.moves)
              .where(
                and(
                  eq(DbSchema.moves.jobId, jobId),
                  between(DbSchema.moves.createdAt, from, until),
                ),
              )
              .orderBy(asc(DbSchema.moves.createdAt), asc(DbSchema.moves.id));
            const vmStatus = await tx
              .select()
              .from(DbSchema.vmStatus)
              .where(
                and(
                  eq(DbSchema.vmStatus.jobId, jobId),
                  between(DbSchema.vmStatus.createdAt, from, until),
                ),
              )
              .orderBy(asc(DbSchema.vmStatus.createdAt), asc(DbSchema.vmStatus.id));
            const turn = eq(DbSchema.logs.runId, job.runId);
            const logs = await tx
              .select()
              .from(DbSchema.logs)
              .where(
                and(
                  turn,
                  between(
                    DbSchema.logs.createdAt,
                    from ?? queuedAt(jobId),
                    until ?? turnEnd(job.runId, jobId),
                  ),
                ),
              )
              .orderBy(asc(DbSchema.logs.createdAt), asc(DbSchema.logs.id));
            const [intent] =
              from === undefined
                ? []
                : await tx
                    .select({ text: DbSchema.logs.text })
                    .from(DbSchema.logs)
                    .where(
                      and(turn, isIntent, between(DbSchema.logs.createdAt, queuedAt(jobId), from)),
                    )
                    .orderBy(desc(DbSchema.logs.createdAt), desc(DbSchema.logs.id))
                    .limit(1);
            return jarl.ok({
              frame,
              frames,
              screenshot: shot ?? null,
              openIntent:
                intent?.text.startsWith(INTENT_START) === true
                  ? intent.text.slice(INTENT_START.length)
                  : null,
              moves,
              actions,
              logs,
              vmStatus,
            });
          },
          { isolationLevel: "repeatable read", accessMode: "read only" },
        ),
      )
      .then(settle),

  getDebugLog: (jobId) =>
    db
      .run(async (d): Promise<jarl.Result<DebugLogRow, NotFound>> => {
        const [row] = await d
          .select()
          .from(DbSchema.debugLogs)
          .where(eq(DbSchema.debugLogs.jobId, jobId));
        return row === undefined
          ? jarl.err(new NotFound(`getDebugLog: no debug log for job ${jobId}`))
          : jarl.ok(row);
      })
      .then(settle),
}));
