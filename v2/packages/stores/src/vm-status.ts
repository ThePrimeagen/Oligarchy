import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import type * as DbSchema from "@oligarchy/db/schema";
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

const missing = (): never => {
  throw new Error("not implemented");
};

export const create = (db: Db.Database): VmStatus => {
  void db;
  return {
    service: "vmStatus",
    record: missing,
    stop: missing,
    current: missing,
    history: missing,
    stopLost: missing,
  };
};
