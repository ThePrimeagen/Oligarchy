import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { sql } from "drizzle-orm";
import type { Answer } from "./answer.ts";
import type { ServerType } from "./servers.ts";

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

export type ProcessStats = {
  readonly service: "processStats";
  readonly report: (name: string, type: ServerType, stats: DbSchema.ProcessStats) => Answer<void>;
  readonly listSeries: (count: number) => Answer<ReadonlyArray<Series>>;
};

declare module "@oligarchy/app" {
  interface Services {
    processStats: App.Register<"processStats", ProcessStats>;
  }
}

export const create = App.createService<Db.Database, App.NoOptions, ProcessStats>(({ db }) => ({
  service: "processStats",

  report: (name, type, stats) =>
    db.run(async (d) => {
      await d.insert(DbSchema.processStats).values({
        name,
        type,
        jobs: stats.jobs,
        memoryBytes: stats.memoryBytes,
        cpuPercent: stats.cpuPercent,
        reportedAt: sql`now()`,
      });
    }),

  listSeries: (count) =>
    db.run(async (d) => {
      const ranked = d
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
      const rows = await d
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
      const series: Array<Series> = [];
      for (const row of rows) {
        const sample: Sample = {
          jobs: row.jobs,
          memoryBytes: row.memoryBytes,
          cpuPercent: row.cpuPercent,
        };
        const last = series.at(-1);
        if (last !== undefined && last.name === row.name && last.type === row.type) {
          series[series.length - 1] = { ...last, samples: [...last.samples, sample] };
        } else {
          series.push({ name: row.name, type: row.type, samples: [sample] });
        }
      }
      return series;
    }),
}));
