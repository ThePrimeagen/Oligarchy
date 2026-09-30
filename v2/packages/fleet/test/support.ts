import { readFileSync } from "node:fs";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as LoggerTesting from "@oligarchy/logger/testing";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach } from "vitest";

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

// A logger that prints into `lines` at once, nothing stored.
export const logging = () => LoggerTesting.logger();

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

// A real database of the test's own, with the stores over it.
export const database = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const env = jarl.unwrap(
    await Env.create(
      Env.cli({ name: "fleet-test", description: "" }).needs("databaseUrl").done(),
      Env.fakeIo({ env: { DATABASE_URL: fake.url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  );
  const db = Db.create({}, { url: env.vars.databaseUrl });
  cleanups.push(() => db.close());
  return {
    fake,
    db,
    servers: Stores.Servers.create({ db }),
    processStats: Stores.ProcessStats.create({ db }),
  };
};

// A promise the test settles when it chooses.
export const held = <T>() => {
  let release: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
