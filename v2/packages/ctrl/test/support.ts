import { readFileSync } from "node:fs";
import * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach } from "vitest";
import * as Ctrl from "../src/main.ts";

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const stores = (db: App.Made<Db.Database>) => ({
  tests: Stores.Tests.create({ db }),
  actions: Stores.Actions.create({ db }),
  logs: Stores.Logs.create({ db }),
  debugLogs: Stores.DebugLogs.create({ db }),
  vmStatus: Stores.VmStatus.create({ db }),
  diagnosis: Stores.Diagnosis.create({ db }),
});

// A migrated database of the test's own, the stores that write the evidence, and ctrl over them.
export const database = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const env = jarl.unwrap(
    await Env.create(
      Env.cli({ name: "ctrl-test", description: "" }).needs("databaseUrl").done(),
      Env.fakeIo({ env: { DATABASE_URL: fake.url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  );
  const db = Db.create({}, { url: env.vars.databaseUrl });
  cleanups.push(() => db.close());
  const services = stores(db);
  return { db, ...services, ctrl: Ctrl.create(services) };
};

// ctrl over a database whose every query fails with `error`.
export const failing = (error: Db.DatabaseError) => {
  const db = App.createService<never, App.NoOptions, Db.Database>(() => ({
    service: "db",
    run: async () => jarl.err(error),
    close: async () => jarl.ok(undefined),
    onPoolError: () => () => undefined,
  }))({});
  return Ctrl.create(stores(db));
};

// A drive filed on a test run of its own.
export const newDrive = async (tests: Stores.Tests.Tests) => {
  const definition = jarl.unwrap(
    await tests.defineTestDefinition({
      name: "lock-screen",
      description: "Lock the screen",
      instruction: "1. Press Super+L",
      proof: "The lock screen shows the clock",
      resume: true,
    }),
  );
  return jarl.unwrap(
    await tests.createTestRun({
      definitionId: definition.id,
      iso: "https://iso.omarchy.org/omarchy-4.0.4.iso",
      serverUrl: "http://qemu-proxy",
    }),
  );
};

export const MISSING = "00000000-0000-4000-8000-000000000000";
