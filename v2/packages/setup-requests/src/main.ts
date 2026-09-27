import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type * as jarl from "jarl";

export type ResultStatus = (typeof DbSchema.testResults.$inferSelect)["status"];

export type DriveStatus = (typeof DbSchema.automationJobs.$inferSelect)["status"];

// One setup row as the watcher reads it, after looking it up again. resultId null means the
// ticket was never attached. A missing result or drive is null, not an error: the row can
// outlive both.
export type Situation = {
  readonly iso: string;
  readonly serverUrl: string;
  readonly resultId: string | null;
  readonly resultStatus: ResultStatus | null;
  readonly driveStatus: DriveStatus | null;
};

export type SetupRequest = { readonly iso: string; readonly serverUrl: string };

type Answer<T> = Promise<jarl.Result<T, Db.DatabaseError>>;

export type SetupRequests = {
  readonly service: "setupRequests";
  readonly insert: (iso: string, serverUrl: string) => Answer<boolean>;
  readonly setResult: (iso: string, serverUrl: string, resultId: string) => Answer<boolean>;
  readonly claim: (iso: string, serverUrl: string, resultId: string) => Answer<boolean>;
  readonly remove: (iso: string, serverUrl: string) => Answer<boolean>;
  readonly removeServer: (serverUrl: string) => Answer<number>;
  readonly serverForResult: (resultId: string) => Answer<string | undefined>;
  readonly list: () => Answer<ReadonlyArray<SetupRequest>>;
  readonly inspect: (iso: string, serverUrl: string) => Answer<Situation | undefined>;
};

declare module "@oligarchy/app" {
  interface Services {
    setupRequests: App.Register<"setupRequests", SetupRequests>;
  }
}

// A setup row whose result is pending or running and whose mint job has not ended: a mint in
// flight holds the server. Mirrors decide's "keep" in the proxy's setup watcher.
const heldByLiveMint = sql`exists (select 1 from ${DbSchema.testResults} where ${DbSchema.testResults.id} = ${DbSchema.setupRequests.resultId} and ${DbSchema.testResults.status} in ('pending', 'running') and not exists (select 1 from ${DbSchema.automationJobs} where ${DbSchema.automationJobs.resultId} = ${DbSchema.setupRequests.resultId} and ${DbSchema.automationJobs.action} = 'mint' and ${DbSchema.automationJobs.status} not in ('pending', 'running')))`;

// A setup row the proxy's watcher would release, read at the moment of the delete: no result
// yet, a result that ended without passing, or an open result whose mint job ended. Mirrors
// decide's "release". A passed result, or one retention swept, keeps its row ("done").
const releasable = sql`(${DbSchema.setupRequests.resultId} is null or exists (select 1 from ${DbSchema.testResults} where ${DbSchema.testResults.id} = ${DbSchema.setupRequests.resultId} and (${DbSchema.testResults.status} in ('failed', 'errored', 'aborted', 'timed_out', 'completed') or (${DbSchema.testResults.status} in ('pending', 'running') and exists (select 1 from ${DbSchema.automationJobs} where ${DbSchema.automationJobs.resultId} = ${DbSchema.setupRequests.resultId} and ${DbSchema.automationJobs.action} = 'mint' and ${DbSchema.automationJobs.status} not in ('pending', 'running'))))))`;

const pair = (iso: string, serverUrl: string) =>
  and(eq(DbSchema.setupRequests.iso, iso), eq(DbSchema.setupRequests.serverUrl, serverUrl));

export const create = (db: Db.Database): SetupRequests => ({
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

  setResult: (iso, serverUrl, resultId) =>
    db.run(async (d) => {
      const rows = await d
        .update(DbSchema.setupRequests)
        .set({ resultId })
        .where(pair(iso, serverUrl))
        .returning({ iso: DbSchema.setupRequests.iso });
      return rows.length > 0;
    }),

  claim: (iso, serverUrl, resultId) =>
    db.run(async (d) => {
      const rows = await d
        .insert(DbSchema.setupRequests)
        .values({ iso, serverUrl, resultId })
        .onConflictDoUpdate({
          target: [DbSchema.setupRequests.iso, DbSchema.setupRequests.serverUrl],
          set: { resultId },
          setWhere: sql`${DbSchema.setupRequests.resultId} is not null and not ${heldByLiveMint}`,
        })
        .returning({ iso: DbSchema.setupRequests.iso });
      return rows.length > 0;
    }),

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

  serverForResult: (resultId) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ serverUrl: DbSchema.setupRequests.serverUrl })
        .from(DbSchema.setupRequests)
        .where(eq(DbSchema.setupRequests.resultId, resultId))
        .limit(1);
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
          resultId: DbSchema.setupRequests.resultId,
          resultStatus: DbSchema.testResults.status,
          driveStatus: DbSchema.automationJobs.status,
        })
        .from(DbSchema.setupRequests)
        .leftJoin(
          DbSchema.testResults,
          eq(DbSchema.testResults.id, DbSchema.setupRequests.resultId),
        )
        .leftJoin(
          DbSchema.automationJobs,
          and(
            eq(DbSchema.automationJobs.resultId, DbSchema.setupRequests.resultId),
            eq(DbSchema.automationJobs.action, "mint"),
          ),
        )
        .where(pair(iso, serverUrl));
      return row;
    }),
});
