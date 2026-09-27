import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as jarl from "jarl";
import { onTestFinished } from "vitest";

// The rules under test are the service's SQL, so they run on Postgres itself: PGlite in this
// process, migrated with v2's migrations as db:migrate applies them, served over the wire so the
// service reaches it through Db.open and node-postgres as a program does.
const MIGRATIONS = resolve(Env.ROOT, "v2/packages/db/drizzle");
const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const template = new PGlite();
await migrate(drizzle({ client: template }), {
  migrationsFolder: MIGRATIONS,
  migrationsTable: "__drizzle_migrations_v2",
});
const migrated = await template.dumpDataDir("none");
await template.close();

const environment = Env.cli({ name: "servers-test", description: "Reads DATABASE_URL" })
  .needs("databaseUrl")
  .done();

// DATABASE_URL as a program receives it: read by Env.create, so a Secret.
const databaseUrl = async (url: string): Promise<Env.Secret> => {
  const created = await Env.create(
    environment,
    Env.fakeIo({ env: { DATABASE_URL: url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
  );
  if (!created.ok) {
    throw created.error;
  }
  return created.value.vars.databaseUrl;
};

export type Database = {
  readonly db: Db.Database;
  // Raw SQL for what the service never writes: an aged heartbeat, a session row.
  readonly exec: (text: string, params: ReadonlyArray<unknown>) => Promise<void>;
};

// Each test gets its own copy of the migrated database, so no test sees another's rows.
export const database = async (): Promise<Database> => {
  const client = new PGlite({ loadDataDir: migrated });
  // The pool drops a connection whose query was refused and opens another before the server has
  // let the first go; one connection, the default, would refuse the second.
  const server = new PGLiteSocketServer({ db: client, port: 0, maxConnections: 2 });
  await server.start();
  const opened = Db.open({
    url: await databaseUrl(`postgres://postgres@${server.getServerConn()}/postgres`),
    // The pool replaces a connection the server dropped; the next query answers for itself.
    onPoolError: () => undefined,
  });
  if (!opened.ok) {
    throw opened.error;
  }
  const db = opened.value;
  onTestFinished(async () => {
    // The pool lets go of the server before the server lets go of PGlite.
    const closed = await db.close();
    await server.stop();
    await client.close();
    value(closed);
  });
  return {
    db,
    exec: async (text, params) => {
      await client.query(text, [...params]);
    },
  };
};

// The value of an ok result; an error fails the test with the database's own words.
export const value = <T>(result: jarl.Result<T, Db.DatabaseError>): T => {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
};
