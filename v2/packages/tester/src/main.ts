import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import * as Env from "@oligarchy/env";
import type * as Log from "@oligarchy/log";
import { eq } from "drizzle-orm";
import * as jarl from "jarl";
import { report } from "./report.ts";
import { environment, wire } from "./wire.ts";

const main = async (app: App.App<unknown, Db.Database | Log.Log>) => {
  const counted = await app.services.db.run(async (db) => ({
    running: await db.$count(DbSchema.testRuns, eq(DbSchema.testRuns.status, "running")),
    passing: await db.$count(DbSchema.testResults, eq(DbSchema.testResults.status, "passed")),
    failing: await db.$count(DbSchema.testResults, eq(DbSchema.testResults.status, "failed")),
  }));
  return report(app.services.log, counted);
};

const created = await Env.create(environment);
if (jarl.error.is(created, Env.HelpRequested)) {
  process.stdout.write(created.error.text);
  process.exit(0);
}
if (jarl.error.is(created, Env.Unexpected)) {
  // A bug, not a refusal: the stack is what finds it.
  console.error(created.error.message, created.error.cause);
  process.exit(1);
}
if (jarl.is_err(created)) {
  process.stderr.write(`${created.error.message}\n`);
  process.exit(1);
}

const wired = wire({
  url: created.value.vars.databaseUrl,
  write: (line) => process.stdout.write(`${line}\n`),
  colors: process.stdout.isTTY,
});
if (!wired.ok) {
  process.stderr.write(`${wired.error.message}\n`);
  process.exit(1);
}

const app = new App.App(created.value, wired.value);
app.onExit(async () => {
  // Every line waits on its insert, so the pool stays open until the last one lands.
  await app.services.log.flush();
  const closed = await app.services.db.close();
  if (!closed.ok) {
    process.stderr.write(`${closed.error.message}\n`);
  }
});
await app.main(main);
