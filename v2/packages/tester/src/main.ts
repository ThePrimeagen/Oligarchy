import * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import { eq } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import * as jarl from "jarl";

// v1's test_runs and test_results (packages/db/src/schema.ts), with only the column read here.
// status is an enum in Postgres; text is enough to compare it.
const testRuns = pgTable("test_runs", { status: text("status").notNull() });
const testResults = pgTable("test_results", { status: text("status").notNull() });

const environment = Env.cli({
  name: "tester",
  description: "Print how many test suites are running, then how many tests passed and failed",
})
  .needs("databaseUrl")
  .done();

const main = async (app: App.App<unknown, Db.Database>) => {
  const counted = await Db.run(app.services.db, "countTests", async (db) => ({
    running: await db.$count(testRuns, eq(testRuns.status, "running")),
    passing: await db.$count(testResults, eq(testResults.status, "passed")),
    failing: await db.$count(testResults, eq(testResults.status, "failed")),
  }));
  if (!counted.ok) {
    process.stderr.write(`${counted.error.message}\n`);
    return counted;
  }
  const { running, passing, failing } = counted.value;
  process.stdout.write(
    `running test suites: ${running}\npassing tests: ${passing}\nfailing tests: ${failing}\n`,
  );
  return jarl.ok(undefined);
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

const db = Db.open({
  url: created.value.vars.databaseUrl,
  onPoolError: (error) => {
    process.stderr.write(`db: pool error: ${error.message}\n`);
  },
});
if (!db.ok) {
  process.stderr.write(`${db.error.message}\n`);
  process.exit(1);
}

const app = new App.App(created.value, { db: db.value });
app.onExit(async () => {
  const closed = await Db.close(app.services.db);
  if (!closed.ok) {
    process.stderr.write(`${closed.error.message}\n`);
  }
});
await app.main(main);
