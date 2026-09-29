import { readFileSync } from "node:fs";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as jarl from "jarl";
import { afterEach } from "vitest";
import * as Tests from "../src/tests.ts";

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const opened = async (url: string) => {
  const env = jarl.unwrap(
    await Env.create(
      Env.cli({ name: "stores-test", description: "" }).needs("databaseUrl").done(),
      Env.fakeIo({ env: { DATABASE_URL: url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  );
  const db = jarl.unwrap(Db.open({ url: env.vars.databaseUrl, onPoolError: () => undefined }));
  cleanups.push(() => db.close());
  return db;
};

// A migrated database of the test's own, with the tests store over it.
export const database = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const db = await opened(fake.url);
  return { db, tests: Tests.create(db) };
};
