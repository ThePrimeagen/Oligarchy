import { randomUUID } from "node:crypto";
import { Client as PgClient } from "pg";
import { describe, inject } from "vitest";
import { Layer, Redacted } from "effect";
import * as Actions from "../../src/db/actions.ts";
import * as Client from "../../src/db/client.ts";
import * as DebugLogs from "../../src/db/debug-logs.ts";
import * as Diagnosis from "../../src/db/diagnosis.ts";
import * as Logs from "../../src/db/logs.ts";
import * as ProcessStats from "../../src/db/process-stats.ts";
import * as Servers from "../../src/db/servers.ts";
import * as SetupRequests from "../../src/db/setup-requests.ts";
import * as Sessions from "../../src/db/sessions.ts";
import * as Automation from "../../src/db/automation.ts";
import * as Tests from "../../src/db/tests.ts";

const withDatabase = (url: string, name: string): string => {
  const next = new URL(url);
  next.pathname = `/${name}`;
  return next.toString();
};

// Files share one container and run in whatever order vitest picks, so a table they shared would
// let one file's rows decide another's result. Each file instead gets a copy of the migrated,
// seeded template, made when this module loads: once per file, since every file runs in a fresh
// worker (`isolate`).
const copyTemplate = async (template: string): Promise<string> => {
  const name = `file_${randomUUID().replaceAll("-", "")}`;
  const admin = new PgClient({ connectionString: withDatabase(template, "postgres") });
  await admin.connect();
  try {
    await admin.query(
      `create database "${name}" template "${new URL(template).pathname.slice(1)}"`,
    );
  } finally {
    await admin.end();
  }
  return withDatabase(template, name);
};

const template = inject("databaseTemplateUrl");
const fileDbUrl = template === "" ? "" : await copyTemplate(template);
if (fileDbUrl !== "") {
  process.env.DATABASE_URL = fileDbUrl;
}

// This file's own database, which every process it spawns inherits as DATABASE_URL; "" when
// Docker is absent.
export const getDbUrl = (): string => fileDbUrl;

// `describe` when a database is available, `describe.skip` otherwise.
export const describeWithDatabase = getDbUrl().length > 0 ? describe : describe.skip;

export const DatabaseLive = (url: string): Layer.Layer<Client.Database> =>
  Client.Database.layer(Redacted.make(url)).pipe(Layer.orDie);

// Every repository over the migrated container database.
export const migratedLayer: Layer.Layer<
  | Client.Database
  | Sessions.SessionStore
  | Actions.ActionStore
  | Logs.LogStore
  | DebugLogs.DebugLogStore
  | Diagnosis.DiagnosisStore
  | Tests.TestStore
  | Automation.AutomationStore
  | Servers.ServerStore
  | ProcessStats.ProcessStatsStore
  | SetupRequests.SetupRequestStore
> = Layer.mergeAll(
  Sessions.SessionStore.layer,
  DebugLogs.DebugLogStore.layer,
  Diagnosis.DiagnosisStore.layer,
  Tests.TestStore.layer,
  Automation.AutomationStore.layer,
  Servers.ServerStore.layer,
  SetupRequests.SetupRequestStore.layer,
  ProcessStats.ProcessStatsStore.layer,
).pipe(
  Layer.provideMerge(Actions.ActionStore.layer),
  Layer.provideMerge(Logs.LogStore.layer),
  Layer.provideMerge(DatabaseLive(getDbUrl())),
);
