import { sql } from "drizzle-orm";
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

      // One reading per heartbeat, stamped with the database's clock. A second write is a
      // second row: the series is the point of the table.
      const report = Effect.fn("db.reportProcess")(function* (
        name: string,
        type: ServerType,
        stats: ProcessStats,
      ) {
        yield* database.run("reportProcess", (db) =>
          db.insert(DbSchema.processStats).values({
            name,
            type,
            jobs: stats.jobs,
            memoryBytes: stats.memoryBytes,
            cpuPercent: stats.cpuPercent,
            reportedAt: sql`now()`,
          }),
        );
      });

      return { report };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
