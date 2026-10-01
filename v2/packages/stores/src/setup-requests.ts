import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { Answer } from "./answer.ts";

export type JobStatus = (typeof DbSchema.jobs.$inferSelect)["status"];

// One setup row as the watcher reads it, after looking it up again. jobId null means no setup job
// holds the lock yet. jobStatus is null then, and for a job retention swept: the row can outlive
// its job.
export type Situation = {
  readonly iso: string;
  readonly serverUrl: string;
  readonly jobId: string | null;
  readonly jobStatus: JobStatus | null;
};

export type SetupRequest = { readonly iso: string; readonly serverUrl: string };

export type SetupRequests = {
  readonly service: "setupRequests";
  readonly insert: (iso: string, serverUrl: string) => Answer<boolean>;
  readonly setJob: (iso: string, serverUrl: string, jobId: string) => Answer<boolean>;
  readonly claim: (iso: string, serverUrl: string, jobId: string) => Answer<boolean>;
  readonly remove: (iso: string, serverUrl: string) => Answer<boolean>;
  readonly removeServer: (serverUrl: string) => Answer<number>;
  readonly serverForJob: (jobId: string) => Answer<string | undefined>;
  readonly list: () => Answer<ReadonlyArray<SetupRequest>>;
  readonly inspect: (iso: string, serverUrl: string) => Answer<Situation | undefined>;
};

declare module "@oligarchy/app" {
  interface Services {
    setupRequests: App.Register<"setupRequests", SetupRequests>;
  }
}

// A setup pending, running, or completed and waiting on its verdict holds the server.
const heldByLiveSetup = sql`exists (select 1 from ${DbSchema.jobs} where ${DbSchema.jobs.id} = ${DbSchema.setupRequests.jobId} and ${DbSchema.jobs.status} in ('pending', 'running', 'completed'))`;

// Read at the moment of the delete: no job yet, or a setup that ended without success. A setup
// that succeeded, or one retention swept, keeps its row.
const releasable = sql`(${DbSchema.setupRequests.jobId} is null or exists (select 1 from ${DbSchema.jobs} where ${DbSchema.jobs.id} = ${DbSchema.setupRequests.jobId} and ${DbSchema.jobs.status} in ('failed', 'errored', 'aborted', 'timed_out')))`;

const pair = (iso: string, serverUrl: string) =>
  and(eq(DbSchema.setupRequests.iso, iso), eq(DbSchema.setupRequests.serverUrl, serverUrl));

type Tx = Parameters<Parameters<Db.Drizzle["transaction"]>[0]>[0];

// Takes the lock for a job, or refuses it. A row that is not there is inserted. A row a live
// setup holds, and a row still waiting on its job, stay as they are: the insert's conflict
// updates nothing and returns nothing.
export const claimLock = async (
  tx: Tx,
  iso: string,
  serverUrl: string,
  jobId: string,
): Promise<boolean> => {
  const rows = await tx
    .insert(DbSchema.setupRequests)
    .values({ iso, serverUrl, jobId })
    .onConflictDoUpdate({
      target: [DbSchema.setupRequests.iso, DbSchema.setupRequests.serverUrl],
      set: { jobId },
      setWhere: sql`${DbSchema.setupRequests.jobId} is not null and not ${heldByLiveSetup}`,
    })
    .returning({ iso: DbSchema.setupRequests.iso });
  return rows.length > 0;
};

export const create = App.createService<Db.Database, App.NoOptions, SetupRequests>(({ db }) => ({
  service: "setupRequests",

  insert: (iso, serverUrl) =>
    db.run(async (d) => {
      const rows = await d
        .insert(DbSchema.setupRequests)
        .values({ iso, serverUrl })
        .onConflictDoNothing()
        .returning({ iso: DbSchema.setupRequests.iso });
      return rows.length > 0;
    }),

  setJob: (iso, serverUrl, jobId) =>
    db.run(async (d) => {
      const rows = await d
        .update(DbSchema.setupRequests)
        .set({ jobId })
        .where(pair(iso, serverUrl))
        .returning({ iso: DbSchema.setupRequests.iso });
      return rows.length > 0;
    }),

  claim: (iso, serverUrl, jobId) =>
    db.run((d) => d.transaction((tx) => claimLock(tx, iso, serverUrl, jobId))),

  remove: (iso, serverUrl) =>
    db.run(async (d) => {
      const rows = await d
        .delete(DbSchema.setupRequests)
        .where(and(pair(iso, serverUrl), releasable))
        .returning({ iso: DbSchema.setupRequests.iso });
      return rows.length > 0;
    }),

  removeServer: (serverUrl) =>
    db.run(async (d) => {
      const rows = await d
        .delete(DbSchema.setupRequests)
        .where(eq(DbSchema.setupRequests.serverUrl, serverUrl))
        .returning({ iso: DbSchema.setupRequests.iso });
      return rows.length;
    }),

  serverForJob: (jobId) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ serverUrl: DbSchema.setupRequests.serverUrl })
        .from(DbSchema.setupRequests)
        .where(eq(DbSchema.setupRequests.jobId, jobId));
      return row?.serverUrl;
    }),

  list: () =>
    db.run((d) =>
      d
        .select({ iso: DbSchema.setupRequests.iso, serverUrl: DbSchema.setupRequests.serverUrl })
        .from(DbSchema.setupRequests),
    ),

  inspect: (iso, serverUrl) =>
    db.run(async (d) => {
      const [row] = await d
        .select({
          iso: DbSchema.setupRequests.iso,
          serverUrl: DbSchema.setupRequests.serverUrl,
          jobId: DbSchema.setupRequests.jobId,
          jobStatus: DbSchema.jobs.status,
        })
        .from(DbSchema.setupRequests)
        .leftJoin(DbSchema.jobs, eq(DbSchema.jobs.id, DbSchema.setupRequests.jobId))
        .where(pair(iso, serverUrl));
      return row;
    }),
}));
