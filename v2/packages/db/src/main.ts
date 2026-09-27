import type * as App from "@oligarchy/app";
import type * as Env from "@oligarchy/env";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as jarl from "jarl";
import { Pool } from "pg";
import * as Schema from "./schema.ts";

export const DatabaseError = jarl.error.define("DatabaseError");
export type DatabaseError = InstanceType<typeof DatabaseError>;

export type Drizzle = NodePgDatabase<typeof Schema>;

export type Database = {
  readonly service: "db";
  // Hands the query drizzle; whatever it throws comes back as a DatabaseError.
  readonly run: <T>(query: (db: Drizzle) => Promise<T>) => Promise<jarl.Result<T, DatabaseError>>;
  // Ends the pool once the queries in flight have finished. Nothing uses the database after.
  readonly close: () => Promise<jarl.Result<void, DatabaseError>>;
};

declare module "@oligarchy/app" {
  interface Services {
    db: App.Register<"db", Database>;
  }
}

const messageOf = (value: unknown): string =>
  value instanceof Error ? value.message : String(value);

// drizzle buries the driver's reason in `cause`, so the message carries both:
// `Failed query: select count(*) ...: connect ECONNREFUSED 127.0.0.1:1`.
const failed = (thrown: unknown): DatabaseError => {
  const cause = thrown instanceof Error ? thrown.cause : undefined;
  const reason = cause === undefined ? "" : `: ${messageOf(cause)}`;
  const error = new DatabaseError(`${messageOf(thrown)}${reason}`);
  error.cause = cause ?? thrown;
  return error;
};

const attempt = <T>(query: () => Promise<T>) => jarl.fn(query, failed)();

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
  // Nothing connects until the first query.
  const pool = new Pool({ connectionString: url });
  pool.on("error", options.onPoolError);
  const db = drizzle({ client: pool, schema: Schema });
  return jarl.ok({
    service: "db",
    run: (query) => attempt(() => query(db)),
    close: () => attempt(() => pool.end()),
  });
};
