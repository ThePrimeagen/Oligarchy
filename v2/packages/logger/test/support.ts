import { readFileSync } from "node:fs";
import * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as SentryTesting from "@oligarchy/sentry/testing";
import * as jarl from "jarl";
import { afterEach } from "vitest";
import * as Logger from "../src/main.ts";

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

const secret = async (url: string) =>
  jarl.unwrap(
    await Env.create(
      Env.cli({ name: "logger-test", description: "" }).needs("databaseUrl").done(),
      Env.fakeIo({ env: { DATABASE_URL: url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  ).vars.databaseUrl;

// A logger over a database of the test's own, printing into `lines` and sending
// to a fake Sentry. rows reads back the logs table as [level, location, text].
export const logging = async (
  options: { readonly colors?: boolean; readonly now?: () => number } = {},
) => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const db = Db.create({}, { url: await secret(fake.url) });
  cleanups.push(() => db.close());
  const reporter = SentryTesting.sentry();
  const lines: Array<string> = [];
  const logger = Logger.create(
    { sentry: reporter.sentry, db },
    {
      write: (line) => lines.push(line),
      colors: options.colors ?? false,
      ...(options.now === undefined ? {} : { now: options.now }),
    },
  );
  const rows = async () =>
    jarl
      .unwrap(await db.run((d) => d.select().from(DbSchema.logs).orderBy(DbSchema.logs.id)))
      .map((row) => [row.level, row.location, row.text]);
  return { fake, db, lines, sent: reporter.sent, logger, rows };
};

export const track = <T>(promise: Promise<T>) => {
  const state = { settled: false };
  void promise.then(() => {
    state.settled = true;
  });
  return state;
};
