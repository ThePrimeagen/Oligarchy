import * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as jarl from "jarl";

// DATABASE_MIGRATION_URL, never DATABASE_URL: the programs may go through a pooler, and a
// migration needs a direct connection.
const environment = Env.cli({ name: "migrate", description: "Apply the database migrations" })
  .needs("databaseMigrationUrl")
  .done();

const result = await Env.create(environment);
if (jarl.error.is(result, Env.HelpRequested)) {
  process.stdout.write(result.error.text);
  process.exit(0);
}
if (jarl.error.is(result, Env.Unexpected)) {
  // A bug, not a refusal: the stack is what finds it.
  console.error(result.error.message, result.error.cause);
  process.exit(1);
}
if (jarl.is_err(result)) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}

const db = Db.open({
  url: result.value.vars.databaseMigrationUrl,
  onPoolError: (error) => {
    process.stderr.write(`db: pool error: ${error.message}\n`);
  },
});
if (!db.ok) {
  process.stderr.write(`${db.error.message}\n`);
  process.exit(1);
}

const app = new App.App(result.value, { db: db.value });

// The migrations are in or they are not; a pool that fails to close is only worth a line.
app.onExit(async () => {
  const closed = await Db.close(app.services.db);
  if (!closed.ok) {
    process.stderr.write(`${closed.error.message}\n`);
  }
});

await app.main(async (running: App.App<unknown, Db.Database>) => {
  const migrated = await Db.migrate(running.services.db);
  if (migrated.ok) {
    process.stdout.write("database migrations applied\n");
  } else {
    process.stderr.write(`${migrated.error.message}\n`);
  }
  return migrated;
});
