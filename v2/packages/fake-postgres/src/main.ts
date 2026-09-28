import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as jarl from "jarl";

export const FakePostgresError = jarl.error.define("FakePostgresError");
export type FakePostgresError = InstanceType<typeof FakePostgresError>;

export type FakePostgres = {
  readonly url: string;
  readonly stop: () => Promise<void>;
};

const HOST = "127.0.0.1";
const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));

const messageOf = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.message : String(thrown);

const refused = (message: string, cause: unknown): FakePostgresError => {
  const error = new FakePostgresError(`${message}: ${messageOf(cause)}`);
  error.cause = cause;
  return error;
};

// For tests only: the one real thing a test may start. An in-memory Postgres (PGlite) with v2's
// migrations applied, speaking the wire protocol on HOST so node-postgres reaches it like any
// other database. Each start is a fresh, empty database on a free port unless one is named; the
// url says which. Stopping it drops every connection, as a database shutting down does.
export const start = async (
  options: { readonly port?: number } = {},
): Promise<jarl.Result<FakePostgres, FakePostgresError>> => {
  const port = options.port ?? 0;
  const pg = new PGlite();
  try {
    await migrate(drizzle({ client: pg }), {
      migrationsFolder: MIGRATIONS,
      migrationsTable: "__drizzle_migrations_v2",
    });
  } catch (thrown) {
    await pg.close();
    return jarl.err(refused("fake-postgres: could not migrate", thrown));
  }
  // node-postgres's pool opens up to ten connections; PGlite runs their queries one at a time.
  const server = new PGLiteSocketServer({
    db: pg,
    host: HOST,
    port,
    maxConnections: 10,
  });
  try {
    await server.start();
  } catch (thrown) {
    await pg.close();
    return jarl.err(refused(`fake-postgres: could not listen on ${HOST}:${String(port)}`, thrown));
  }
  let stopped: Promise<void> | undefined;
  return jarl.ok({
    url: `postgres://postgres@${server.getServerConn()}/postgres`,
    // A test may stop it to see what a shutdown does, and its cleanup stops it again.
    stop: () =>
      (stopped ??= (async () => {
        try {
          await server.stop();
        } finally {
          await pg.close();
        }
      })()),
  });
};
