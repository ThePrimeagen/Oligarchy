import { eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type ProcessStats = DbSchema.ProcessStats;
type ServerType = (typeof DbSchema.servers.$inferSelect)["type"];

export class ProcessStatsStore extends Context.Service<ProcessStatsStore>()(
  "@oligarchy/db/ProcessStatsStore",
  {
    make: Effect.gen(function* () {
      const database = yield* Client.Database;

      // This process's word on itself, keyed by the url it announces. The servers row is
      // written first so the foreign key holds; the write rewrites the reading and stamps
      // reported_at with the database's clock.
      const report = Effect.fn("db.reportProcess")(function* (
        url: string,
        type: ServerType,
        stats: ProcessStats,
      ) {
        const now = sql`now()`;
        yield* database.run("reportProcess", (db) =>
          db
            .insert(DbSchema.processStats)
            .values({
              url,
              type,
              jobs: stats.jobs,
              memoryBytes: stats.memoryBytes,
              cpuPercent: stats.cpuPercent,
              reportedAt: now,
            })
            .onConflictDoUpdate({
              target: DbSchema.processStats.url,
              set: {
                type,
                jobs: stats.jobs,
                memoryBytes: stats.memoryBytes,
                cpuPercent: stats.cpuPercent,
                reportedAt: now,
              },
            }),
        );
      });

      // false when nothing was reported under the url: a shutdown after a failed first write.
      const remove = Effect.fn("db.removeProcess")(function* (url: string) {
        const rows = yield* database.run("removeProcess", (db) =>
          db
            .delete(DbSchema.processStats)
            .where(eq(DbSchema.processStats.url, url))
            .returning({ url: DbSchema.processStats.url }),
        );
        return rows.length > 0;
      });

      return { report, remove };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
