import { randomUUID } from "node:crypto";
import { Client as PgClient } from "pg";
import { describe, inject } from "vitest";
import { Layer, Redacted } from "effect";
import * as Actions from "@oligarchy/db/actions";
import * as Automation from "@oligarchy/db/automation";
import * as Client from "@oligarchy/db/client";
import * as DebugLogs from "@oligarchy/db/debug-logs";
import * as Diagnosis from "@oligarchy/db/diagnosis";
import * as Logs from "@oligarchy/db/logs";
import * as ProcessStats from "@oligarchy/db/process-stats";
import * as Servers from "@oligarchy/db/servers";
import * as Sessions from "@oligarchy/db/sessions";
import * as SetupRequests from "@oligarchy/db/setup-requests";
import * as Tests from "@oligarchy/db/tests";

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
