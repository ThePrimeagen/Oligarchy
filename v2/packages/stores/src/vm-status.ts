import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { asc, desc, eq } from "drizzle-orm";
import type { Answer } from "./answer.ts";

export type VmStatusRow = typeof DbSchema.vmStatus.$inferSelect;

export type Live = "downloading" | "running";

// How a VM ended. Only a crash or a server error says why: nothing else the host sees carries a
// cause.
export type End =
  | { readonly status: "shutdown" | "stopped" | "panicked" }
  | { readonly status: "crashed" | "server-error"; readonly reason: string };

export type VmStatus = {
  readonly service: "vmStatus";
  readonly record: (jobId: string, status: Live) => Answer<void>;
  readonly stop: (jobId: string, end: End) => Answer<void>;
  readonly current: (jobId: string) => Answer<VmStatusRow | undefined>;
  readonly history: (jobId: string) => Answer<ReadonlyArray<VmStatusRow>>;
  readonly clearPastRunningVms: (serverUrl: string) => Answer<ReadonlyArray<string>>;
};

declare module "@oligarchy/app" {
  interface Services {
    vmStatus: App.Register<"vmStatus", VmStatus>;
  }
}

const CRASHED_WHILE_RUNNING = "the qemu server crashed and came back to find this VM still running";

const LIVE: ReadonlyArray<VmStatusRow["status"]> = ["downloading", "running"];

export const create = (db: Db.Database): VmStatus => ({
  service: "vmStatus",

  record: (jobId, status) =>
    db.run(async (d) => {
      await d.insert(DbSchema.vmStatus).values({ jobId, status });
    }),

  stop: (jobId, end) =>
    db.run(async (d) => {
      await d
        .insert(DbSchema.vmStatus)
        .values({ jobId, status: end.status, reason: "reason" in end ? end.reason : null });
    }),

  current: (jobId) =>
    db.run(async (d) => {
      const [row] = await d
        .select()
        .from(DbSchema.vmStatus)
        .where(eq(DbSchema.vmStatus.jobId, jobId))
        .orderBy(desc(DbSchema.vmStatus.id))
        .limit(1);
      return row;
    }),

  history: (jobId) =>
    db.run((d) =>
      d
        .select()
        .from(DbSchema.vmStatus)
        .where(eq(DbSchema.vmStatus.jobId, jobId))
        .orderBy(asc(DbSchema.vmStatus.id)),
    ),

  // A qemu server that boots holds no VM yet, so every VM routed to it whose newest change is still
  // downloading or running was left by a process that crashed. Each is a server error; killing a
  // QEMU that outlived that process is the qemu server's.
  clearPastRunningVms: (serverUrl) =>
    db.run((d) =>
      d.transaction(async (tx) => {
        const newest = await tx
          .selectDistinctOn([DbSchema.vmStatus.jobId], {
            jobId: DbSchema.vmStatus.jobId,
            status: DbSchema.vmStatus.status,
          })
          .from(DbSchema.vmStatus)
          .innerJoin(DbSchema.jobServers, eq(DbSchema.jobServers.jobId, DbSchema.vmStatus.jobId))
          .where(eq(DbSchema.jobServers.serverUrl, serverUrl))
          .orderBy(DbSchema.vmStatus.jobId, desc(DbSchema.vmStatus.id));
        const past = newest.filter((row) => LIVE.includes(row.status)).map((row) => row.jobId);
        if (past.length > 0) {
          await tx.insert(DbSchema.vmStatus).values(
            past.map((jobId) => ({
              jobId,
              status: "server-error" as const,
              reason: CRASHED_WHILE_RUNNING,
            })),
          );
        }
        return past;
      }),
    ),
});
