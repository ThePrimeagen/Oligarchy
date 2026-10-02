import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { asc, eq } from "drizzle-orm";
import * as jarl from "jarl";
import { settle } from "./answer.ts";
import { turnOf } from "./logs.ts";
import type { NotFound } from "./tests.ts";

// What only the qemu server that held the guest has: the guest's serial console and QEMU's stderr.
export type Captured = { readonly serial: string; readonly qemu: string };

export type DebugLogs = {
  readonly service: "debugLogs";
  readonly saveDebugLog: (
    jobId: string,
    captured: Captured,
  ) => Promise<jarl.Result<void, Db.DatabaseError | NotFound>>;
};

declare module "@oligarchy/app" {
  interface Services {
    debugLogs: App.Register<"debugLogs", DebugLogs>;
  }
}

type LogLine = Pick<typeof DbSchema.logs.$inferSelect, "createdAt" | "level" | "location" | "text">;

type Action = Pick<
  typeof DbSchema.actions.$inferSelect,
  "id" | "createdAt" | "state" | "request" | "response"
>;

// A full journal and the proxy's story are diagnostic within their first megabyte. A longer
// source keeps its tail: the crash and the verdict are at the end.
const MAX_TEXT = 1_048_576;
const TRUNCATED = "[truncated]\n";

const truncate = (text: string): string =>
  text.length <= MAX_TEXT ? text : `${TRUNCATED}${text.slice(TRUNCATED.length - MAX_TEXT)}`;

const formatLogs = (rows: ReadonlyArray<LogLine>): string =>
  rows
    .map((row) =>
      [row.createdAt.toISOString(), row.level, row.location, row.text]
        .filter((part) => part !== null)
        .join(" "),
    )
    .join("\n");

const formatActions = (rows: ReadonlyArray<Action>): string =>
  rows
    .map((row) => {
      const response = row.response === null ? "" : ` ${JSON.stringify(row.response)}`;
      return `${row.createdAt.toISOString()} ${String(row.id)} ${row.state ?? "open"} ${JSON.stringify(row.request)}${response}`;
    })
    .join("\n");

export const create = App.createService<Db.Database, App.NoOptions, DebugLogs>(({ db }) => ({
  service: "debugLogs",

  saveDebugLog: (jobId, captured) =>
    db
      .run(async (d): Promise<jarl.Result<void, NotFound>> => {
        const lines = await turnOf(d, "saveDebugLog", jobId);
        if (jarl.is_err(lines)) {
          return lines;
        }
        const taken = await d
          .select({
            id: DbSchema.actions.id,
            createdAt: DbSchema.actions.createdAt,
            state: DbSchema.actions.state,
            request: DbSchema.actions.request,
            response: DbSchema.actions.response,
          })
          .from(DbSchema.actions)
          .where(eq(DbSchema.actions.jobId, jobId))
          .orderBy(asc(DbSchema.actions.createdAt), asc(DbSchema.actions.id));
        await d.insert(DbSchema.debugLogs).values({
          jobId,
          sources: {
            serial: truncate(captured.serial),
            proxy: truncate(formatLogs(jarl.value(lines))),
            qemu: truncate(captured.qemu),
            actions: truncate(formatActions(taken)),
          },
        });
        return jarl.ok(undefined);
      })
      .then(settle),
}));
