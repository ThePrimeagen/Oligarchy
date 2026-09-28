import type * as Db from "@oligarchy/db";
import type * as jarl from "jarl";

// Global so the store files name it without an import; any package importing this one sees it too.
declare global {
  type Answer<T> = Promise<jarl.Result<T, Db.DatabaseError>>;
}

export * as Actions from "./actions.ts";
export * as Automation from "./automation.ts";
export * as Diagnosis from "./diagnosis.ts";
export * as Logs from "./logs.ts";
export * as ProcessStats from "./process-stats.ts";
export * as Servers from "./servers.ts";
export * as Sessions from "./sessions.ts";
export * as SetupRequests from "./setup-requests.ts";
export * as Tests from "./tests.ts";
