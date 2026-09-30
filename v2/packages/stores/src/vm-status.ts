import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { asc, desc, eq } from "drizzle-orm";
import type { Answer } from "./answer.ts";

export type VmStatusRow = typeof DbSchema.vmStatus.$inferSelect;

export type Live = "downloading" | "running";

// How a VM ended. Only a crash says why: nothing else the host sees carries a cause.
export type End =
  | { readonly status: "shutdown" | "stopped" | "panicked" }
  | { readonly status: "crashed"; readonly reason: string };

export type VmStatus = {
  readonly service: "vmStatus";
  readonly record: (jobId: string, status: Live) => Answer<void>;
  readonly stop: (jobId: string, end: End) => Answer<void>;
  readonly current: (jobId: string) => Answer<VmStatusRow | undefined>;
  readonly history: (jobId: string) => Answer<ReadonlyArray<VmStatusRow>>;
  readonly stopLost: (serverUrl: string) => Answer<ReadonlyArray<string>>;
};

declare module "@oligarchy/app" {
  interface Services {
    vmStatus: App.Register<"vmStatus", VmStatus>;
  }
}

const RESTARTED = "qemu server restarted";

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

  // A qemu server that comes back holds no VM, so every VM routed to it whose newest change is
  // still live died with the last process.
  stopLost: (serverUrl) =>
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
        const lost = newest.filter((row) => LIVE.includes(row.status)).map((row) => row.jobId);
        if (lost.length > 0) {
          await tx
            .insert(DbSchema.vmStatus)
            .values(
              lost.map((jobId) => ({ jobId, status: "crashed" as const, reason: RESTARTED })),
            );
        }
        return lost;
      }),
    ),
});
