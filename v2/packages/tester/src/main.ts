import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import * as Env from "@oligarchy/env";
import type * as Logger from "@oligarchy/logger";
import { eq } from "drizzle-orm";
import * as jarl from "jarl";
import { report } from "./report.ts";
import { closeServices, createServices, environment } from "./services.ts";

const main = async (app: App.App<unknown, Db.Database | Logger.Logger>) => {
  const counted = await app.services.db.run(async (db) => ({
    running: await db.$count(DbSchema.testSuites, eq(DbSchema.testSuites.status, "running")),
    passing: await db.$count(DbSchema.testRuns, eq(DbSchema.testRuns.status, "passed")),
    failing: await db.$count(DbSchema.testRuns, eq(DbSchema.testRuns.status, "failed")),
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

const env = jarl.value(created);

const built = createServices(env);
if (jarl.is_err(built)) {
  process.stderr.write(`${built.error.message}\n`);
  process.exit(1);
}
const services = jarl.value(built);

const app = new App.App(env).main(main);
app.onExit(() => closeServices(services));
await app.run(services, (errors) => {
  for (const error of errors) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
});
