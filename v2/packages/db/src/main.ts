import { fileURLToPath } from "node:url";
import type * as Env from "@oligarchy/env";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as Migrator from "drizzle-orm/node-postgres/migrator";
import * as jarl from "jarl";
import { Pool } from "pg";

// The database, as every program shares it. The schema and its migrations stay v1's in
// packages/db: they are generated from packages/db/src/schema.ts and append-only, so v1 and v2
// apply the same files and keep one journal.
const MIGRATIONS = fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url));

export const DatabaseError = jarl.error.define("DatabaseError");
export type DatabaseError = InstanceType<typeof DatabaseError>;

export type Database = {
  readonly service: "db";
  // select 1. The pool connects on its first query, so a program that needs the database pings it
  // before it starts work.
  readonly ping: () => Promise<jarl.Result<void, DatabaseError>>;
  // Applies every migration the database has not applied yet.
  readonly migrate: () => Promise<jarl.Result<void, DatabaseError>>;
  // Ends the pool once the queries in flight have finished. Nothing uses the database after.
  readonly close: () => Promise<jarl.Result<void, DatabaseError>>;
};

const messageOf = (value: unknown): string =>
  value instanceof Error ? value.message : String(value);

// drizzle buries the driver's reason in `cause`, so the message carries both:
// `ping: Failed query: select 1\nparams: : connect ECONNREFUSED 127.0.0.1:1`.
const failed = (operation: string, thrown: unknown): DatabaseError => {
  const cause = thrown instanceof Error ? thrown.cause : undefined;
  const reason = cause === undefined ? "" : `: ${messageOf(cause)}`;
  const error = new DatabaseError(`${operation}: ${messageOf(thrown)}${reason}`);
  error.cause = cause ?? thrown;
  return error;
};

const attempt = (operation: string, query: () => Promise<void>) =>
  jarl.fn(query, (thrown) => failed(operation, thrown))();

// canParse, not new URL's throw: that TypeError carries the url, password and all, into the logs.
// PlanetScale urls carry sslrootcert=system, libpq 16's "verify against the system trust store".
// node-postgres reads sslrootcert as a file path, so the first query dies with ENOENT
// (node-postgres#3101). Node's default TLS verification already is the system trust store, so
// dropping the parameter keeps the url's meaning; sslmode=verify-full stays.
const connectionString = (url: Env.Secret): string | undefined => {
  const raw = url.reveal();
  if (!URL.canParse(raw)) {
    return undefined;
  }
  const parsed = new URL(raw);
  if (parsed.searchParams.get("sslrootcert") !== "system") {
    return raw;
  }
  parsed.searchParams.delete("sslrootcert");
  return parsed.toString();
};

export const open = (options: {
  readonly url: Env.Secret;
  // An idle connection the server drops is an error on the pool, not on any query; with no
  // listener it would end the process. The pool replaces the connection on its next query.
  readonly onPoolError: (error: Error) => void;
}): jarl.Result<Database, DatabaseError> => {
  const url = connectionString(options.url);
  if (url === undefined) {
    return jarl.err(new DatabaseError("db: database url is not a valid url"));
  }
  const pool = new Pool({ connectionString: url });
  pool.on("error", options.onPoolError);
  const db = drizzle({ client: pool });
  return jarl.ok({
    service: "db",
    ping: () =>
      attempt("ping", async () => {
        await db.execute(sql`select 1`);
      }),
    migrate: () => attempt("migrate", () => Migrator.migrate(db, { migrationsFolder: MIGRATIONS })),
    close: () => attempt("close", () => pool.end()),
  });
};

export const ping = (db: Database) => db.ping();
export const migrate = (db: Database) => db.migrate();
export const close = (db: Database) => db.close();
