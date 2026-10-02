import * as App from "@oligarchy/app";
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
  readonly jobId: string | null;
};

export type Intent = { readonly text: string; readonly createdAt: Date };

export type Scope =
  | { readonly location: string }
  | { readonly runId: string }
  | { readonly jobId: string };

const matching = (scope: Scope) => {
  if ("jobId" in scope) return eq(DbSchema.logs.jobId, scope.jobId);
  if ("runId" in scope) return eq(DbSchema.logs.runId, scope.runId);
  return eq(DbSchema.logs.location, scope.location);
};

export type Logs = {
  readonly service: "logs";
  readonly insertLog: (row: LogInput) => Answer<void>;
  readonly listLogs: (scope: Scope) => Answer<ReadonlyArray<LogRow>>;
  readonly listRecent: (limit: number) => Answer<ReadonlyArray<LogRow>>;
  readonly listIntents: (scope: Scope) => Answer<ReadonlyArray<Intent>>;
};

declare module "@oligarchy/app" {
  interface Services {
    logs: App.Register<"logs", Logs>;
  }
}

export const create = App.createService<Db.Database, App.NoOptions, Logs>(({ db }) => ({
  service: "logs",

  insertLog: (row) =>
    db.run(async (d) => {
      await d.insert(DbSchema.logs).values(row);
    }),

  listLogs: (scope) =>
    db.run((d) =>
      d
        .select()
        .from(DbSchema.logs)
        .where(matching(scope))
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

  listIntents: (scope) =>
    db.run((d) =>
      d
        .select({ text: DbSchema.logs.text, createdAt: DbSchema.logs.createdAt })
        .from(DbSchema.logs)
        .where(
          and(
            matching(scope),
            or(like(DbSchema.logs.text, "intent start; %"), eq(DbSchema.logs.text, "intent end")),
          ),
        )
        .orderBy(DbSchema.logs.id),
    ),
}));
