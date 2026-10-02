import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { and, asc, desc, eq, gt, gte, like, lt, or } from "drizzle-orm";
import * as jarl from "jarl";
import { type Answer, settle } from "./answer.ts";
import { type Found, NotFound } from "./tests.ts";

export type LogLevel = (typeof DbSchema.logLevel.enumValues)[number];

export type LogRow = typeof DbSchema.logs.$inferSelect;

export type LogInput = {
  readonly text: string;
  readonly level: LogLevel;
  readonly location: string | null;
  readonly runId: string | null;
};

export type Intent = { readonly text: string; readonly createdAt: Date };

export type Logs = {
  readonly service: "logs";
  readonly insertLog: (row: LogInput) => Answer<void>;
  readonly listLogs: (location: string) => Answer<ReadonlyArray<LogRow>>;
  readonly listJobLogs: (jobId: string) => Found<ReadonlyArray<LogRow>>;
  readonly listRecent: (limit: number) => Answer<ReadonlyArray<LogRow>>;
  readonly listIntents: (runId: string) => Answer<ReadonlyArray<Intent>>;
};

declare module "@oligarchy/app" {
  interface Services {
    logs: App.Register<"logs", Logs>;
  }
}

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

  listJobLogs: (jobId) => db.run((d) => turnOf(d, "listJobLogs", jobId)).then(settle),

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
        .where(
          and(
            eq(DbSchema.logs.runId, runId),
            or(like(DbSchema.logs.text, "intent start; %"), eq(DbSchema.logs.text, "intent end")),
          ),
        )
        .orderBy(DbSchema.logs.id),
    ),
}));
