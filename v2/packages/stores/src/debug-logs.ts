import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { and, asc, eq, gt, gte, lt } from "drizzle-orm";
import * as jarl from "jarl";
import { type Answer, settle } from "./answer.ts";
import { NotFound } from "./tests.ts";

export type DebugLogRow = typeof DbSchema.debugLogs.$inferSelect;

// What only the qemu server that held the guest has: the guest's serial console and QEMU's stderr.
export type Captured = { readonly serial: string; readonly qemu: string };

export type DebugLogs = {
  readonly service: "debugLogs";
  readonly saveDebugLog: (
    jobId: string,
    captured: Captured,
  ) => Promise<jarl.Result<void, Db.DatabaseError | NotFound>>;
  readonly getDebugLog: (jobId: string) => Answer<DebugLogRow | undefined>;
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

  // A test run holds one open job at a time, so its lines fall into turns: a job's turn runs from
  // when it was queued until the run's next job was queued, or until now for the newest.
  saveDebugLog: (jobId, captured) =>
    db
      .run(async (d): Promise<jarl.Result<void, NotFound>> => {
        const [job] = await d
          .select({ runId: DbSchema.jobs.runId, createdAt: DbSchema.jobs.createdAt })
          .from(DbSchema.jobs)
          .where(eq(DbSchema.jobs.id, jobId));
        if (job === undefined) {
          return jarl.err(new NotFound(`saveDebugLog: no job ${jobId}`));
        }
        const [next] = await d
          .select({ createdAt: DbSchema.jobs.createdAt })
          .from(DbSchema.jobs)
          .where(
            and(eq(DbSchema.jobs.runId, job.runId), gt(DbSchema.jobs.createdAt, job.createdAt)),
          )
          .orderBy(asc(DbSchema.jobs.createdAt))
          .limit(1);
        const lines = await d
          .select({
            createdAt: DbSchema.logs.createdAt,
            level: DbSchema.logs.level,
            location: DbSchema.logs.location,
            text: DbSchema.logs.text,
          })
          .from(DbSchema.logs)
          .where(
            and(
              eq(DbSchema.logs.runId, job.runId),
              gte(DbSchema.logs.createdAt, job.createdAt),
              next === undefined ? undefined : lt(DbSchema.logs.createdAt, next.createdAt),
            ),
          )
          .orderBy(asc(DbSchema.logs.createdAt), asc(DbSchema.logs.id));
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
            proxy: truncate(formatLogs(lines)),
            qemu: truncate(captured.qemu),
            actions: truncate(formatActions(taken)),
          },
        });
        return jarl.ok(undefined);
      })
      .then(settle),

  getDebugLog: (jobId) =>
    db.run(async (d) => {
      const [row] = await d
        .select()
        .from(DbSchema.debugLogs)
        .where(eq(DbSchema.debugLogs.jobId, jobId));
      return row;
    }),
}));
