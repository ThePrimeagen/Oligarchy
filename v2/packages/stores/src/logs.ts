import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { and, desc, eq, like, or } from "drizzle-orm";
import type { Answer } from "./answer.ts";

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
  readonly listRecent: (limit: number) => Answer<ReadonlyArray<LogRow>>;
  readonly listIntents: (runId: string) => Answer<ReadonlyArray<Intent>>;
};

declare module "@oligarchy/app" {
  interface Services {
    logs: App.Register<"logs", Logs>;
  }
}

export const create = (db: Db.Database): Logs => ({
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
        .where(
          and(
            eq(DbSchema.logs.runId, runId),
            or(like(DbSchema.logs.text, "intent start; %"), eq(DbSchema.logs.text, "intent end")),
          ),
        )
        .orderBy(DbSchema.logs.id),
    ),
});
