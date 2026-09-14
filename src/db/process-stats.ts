import { desc, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type ProcessStats = DbSchema.ProcessStats;
type ServerType = (typeof DbSchema.servers.$inferSelect)["type"];

// One process's newest word on itself, and the database's clock at the read so the report's
// age is measured against the clock that stamped it.
export type ProcessReading = {
  readonly name: string;
  readonly type: ServerType;
  readonly jobs: number;
  readonly memoryBytes: number;
  readonly cpuPercent: number;
  readonly reportedAt: Date;
  readonly queriedAt: Date;
};

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

      // The newest reading per name and kind, qemu servers before automation clients as the
      // enum declares them, then by name. Older rows stay for the series the dashboard graphs.
      const listNewest = Effect.fn("db.listNewestProcessStats")(function* () {
        const rows: ReadonlyArray<ProcessReading> = yield* database.run(
          "listNewestProcessStats",
          (db) =>
            db
              .selectDistinctOn([DbSchema.processStats.type, DbSchema.processStats.name], {
                name: DbSchema.processStats.name,
                type: DbSchema.processStats.type,
                jobs: DbSchema.processStats.jobs,
                memoryBytes: DbSchema.processStats.memoryBytes,
                cpuPercent: DbSchema.processStats.cpuPercent,
                reportedAt: DbSchema.processStats.reportedAt,
                queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(DbSchema.processStats.reportedAt),
              })
              .from(DbSchema.processStats)
              .orderBy(
                DbSchema.processStats.type,
                DbSchema.processStats.name,
                desc(DbSchema.processStats.reportedAt),
              ),
        );
        return rows;
      });

      return { report, listNewest };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
