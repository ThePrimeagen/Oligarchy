import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import * as Env from "@oligarchy/env";
import type * as Logger from "@oligarchy/logger";
import { eq } from "drizzle-orm";
import * as jarl from "jarl";
import { report } from "./report.ts";
import { environment, wire } from "./wire.ts";

const main = async (app: App.App<unknown, Db.Database | Logger.Logger>) => {
  const counted = await app.services.db.run(async (db) => ({
    running: await db.$count(DbSchema.testRuns, eq(DbSchema.testRuns.status, "running")),
    passing: await db.$count(DbSchema.testResults, eq(DbSchema.testResults.status, "passed")),
    failing: await db.$count(DbSchema.testResults, eq(DbSchema.testResults.status, "failed")),
  }));
  return report(app.services.logger, counted);
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

const app = new App.App(created.value).main(main);
app.onExit(async () => {
  // Every line waits on its insert, so the pool stays open until the last one lands.
  await app.services.logger.flush();
  return app.services.db.close();
});
await app.run(wired.value, (errors) => {
  for (const error of errors) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
});
