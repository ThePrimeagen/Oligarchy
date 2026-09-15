import { sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type ProcessStats = DbSchema.ProcessStats;
type ServerType = (typeof DbSchema.servers.$inferSelect)["type"];

// One heartbeat's word on a process: what the graphs plot.
export type Sample = {
  readonly jobs: number;
  readonly memoryBytes: number;
  readonly cpuPercent: number;
};

// One process's newest readings, oldest first and never empty: the last is what it says now.
export type Series = {
  readonly name: string;
  readonly type: ServerType;
  readonly samples: ReadonlyArray<Sample>;
};

// A process reports every thirty seconds, so `count` readings span this many seconds.
const HEARTBEAT_SECONDS = 30;

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

      // Each name's newest `count` readings, qemu servers before automation clients as the enum
      // declares them, then by name, oldest first within a name. The time filter keeps the rank
      // off the whole table: `count` heartbeats back is as far as any reading shown can be; the
      // rank then caps a host that reported more often than it should.
      const listSeries = Effect.fn("db.listProcessSeries")(function* (count: number) {
        const rows = yield* database.run("listProcessSeries", (db) => {
          const ranked = db
            .select({
              name: DbSchema.processStats.name,
              type: DbSchema.processStats.type,
              jobs: DbSchema.processStats.jobs,
              memoryBytes: DbSchema.processStats.memoryBytes,
              cpuPercent: DbSchema.processStats.cpuPercent,
              reportedAt: DbSchema.processStats.reportedAt,
              rank: sql<number>`row_number() over (partition by ${DbSchema.processStats.type}, ${DbSchema.processStats.name} order by ${DbSchema.processStats.reportedAt} desc)`
                .mapWith(Number)
                .as("rn"),
            })
            .from(DbSchema.processStats)
            .where(
              sql`${DbSchema.processStats.reportedAt} > now() - make_interval(secs => ${count * HEARTBEAT_SECONDS})`,
            )
            .as("process_series");
          return db
            .select({
              name: ranked.name,
              type: ranked.type,
              jobs: ranked.jobs,
              memoryBytes: ranked.memoryBytes,
              cpuPercent: ranked.cpuPercent,
            })
            .from(ranked)
            .where(sql`${ranked.rank} <= ${count}`)
            .orderBy(ranked.type, ranked.name, ranked.reportedAt);
        });
        // Consecutive rows of one name and kind are one series.
        const grouped: Array<Series> = [];
        for (const row of rows) {
          const sample: Sample = {
            jobs: row.jobs,
            memoryBytes: row.memoryBytes,
            cpuPercent: row.cpuPercent,
          };
          const last = grouped.at(-1);
          if (last !== undefined && last.name === row.name && last.type === row.type) {
            grouped[grouped.length - 1] = { ...last, samples: [...last.samples, sample] };
          } else {
            grouped.push({ name: row.name, type: row.type, samples: [sample] });
          }
        }
        const series: ReadonlyArray<Series> = grouped;
        return series;
      });

      return { report, listSeries };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
