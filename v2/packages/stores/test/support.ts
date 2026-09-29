import { readFileSync } from "node:fs";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as jarl from "jarl";
import { afterEach } from "vitest";
import * as Stores from "../src/main.ts";

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

// A real database of the test's own, with the stores over it.
export const database = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const env = jarl.unwrap(
    await Env.create(
      Env.cli({ name: "stores-test", description: "" }).needs("databaseUrl").done(),
      Env.fakeIo({ env: { DATABASE_URL: fake.url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  );
  const db = jarl.unwrap(Db.open({ url: env.vars.databaseUrl, onPoolError: () => undefined }));
  cleanups.push(() => db.close());
  return {
    fake,
    db,
    jobs: Stores.Jobs.create(db),
    definitions: Stores.Definitions.create(db),
  };
};

// The error a result failed with, when it is the one named; anything else fails the test.
export const failure = <C>(
  result: jarl.Result<unknown, unknown>,
  error: abstract new (...args: never[]) => C,
): C => {
  if (!result.ok && result.error instanceof error) {
    return result.error;
  }
  const came = result.ok ? `ok ${JSON.stringify(result.value)}` : String(result.error);
  throw new Error(`expected a ${error.name} failure, got ${came}`);
};
