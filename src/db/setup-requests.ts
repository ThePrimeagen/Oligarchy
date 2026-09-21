import { and, eq } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

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

const columns = {
  iso: DbSchema.setupRequests.iso,
  serverUrl: DbSchema.setupRequests.serverUrl,
  resultId: DbSchema.setupRequests.resultId,
  resultStatus: DbSchema.testResults.status,
  driveStatus: DbSchema.automationJobs.status,
};

export class SetupRequestStore extends Context.Service<SetupRequestStore>()(
  "@oligarchy/db/SetupRequestStore",
  {
    make: Effect.gen(function* () {
      const database = yield* Client.Database;

      const situationOf = (db: Client.Db, iso: string, serverUrl: string) =>
        db
          .select(columns)
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
          .where(
            and(
              eq(DbSchema.setupRequests.iso, iso),
              eq(DbSchema.setupRequests.serverUrl, serverUrl),
            ),
          );

      // True when this insert took the lock. A row already there is false, not an error.
      const insert = Effect.fn("db.insertSetupRequest")(function* (iso: string, serverUrl: string) {
        const rows = yield* database.run("insertSetupRequest", (db) =>
          db
            .insert(DbSchema.setupRequests)
            .values({ iso, serverUrl })
            .onConflictDoNothing()
            .returning({ iso: DbSchema.setupRequests.iso }),
        );
        return rows.length > 0;
      });

      const setResult = Effect.fn("db.setSetupResult")(function* (
        iso: string,
        serverUrl: string,
        resultId: string,
      ) {
        const rows = yield* database.run("setSetupResult", (db) =>
          db
            .update(DbSchema.setupRequests)
            .set({ resultId })
            .where(
              and(
                eq(DbSchema.setupRequests.iso, iso),
                eq(DbSchema.setupRequests.serverUrl, serverUrl),
              ),
            )
            .returning({ iso: DbSchema.setupRequests.iso }),
        );
        return rows.length > 0;
      });

      const remove = Effect.fn("db.removeSetupRequest")(function* (iso: string, serverUrl: string) {
        yield* database.run("removeSetupRequest", (db) =>
          db
            .delete(DbSchema.setupRequests)
            .where(
              and(
                eq(DbSchema.setupRequests.iso, iso),
                eq(DbSchema.setupRequests.serverUrl, serverUrl),
              ),
            ),
        );
      });

      // Every row of this server, when it comes online. Other servers stay.
      const removeServer = Effect.fn("db.removeServerSetups")(function* (serverUrl: string) {
        const rows = yield* database.run("removeServerSetups", (db) =>
          db
            .delete(DbSchema.setupRequests)
            .where(eq(DbSchema.setupRequests.serverUrl, serverUrl))
            .returning({ iso: DbSchema.setupRequests.iso }),
        );
        return rows.length;
      });

      const list = Effect.fn("db.listSetupRequests")(function* () {
        return yield* database.run("listSetupRequests", (db) =>
          db
            .select({
              iso: DbSchema.setupRequests.iso,
              serverUrl: DbSchema.setupRequests.serverUrl,
            })
            .from(DbSchema.setupRequests),
        );
      });

      // Read again, so a delete that landed since the list is an absence, not a stale status.
      const inspect = Effect.fn("db.inspectSetupRequest")(function* (
        iso: string,
        serverUrl: string,
      ) {
        const rows = yield* database.run("inspectSetupRequest", (db) =>
          situationOf(db, iso, serverUrl),
        );
        return Arr.head(rows);
      });

      return { insert, setResult, remove, removeServer, list, inspect };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
