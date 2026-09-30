import * as App from "@oligarchy/app";
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
  // An idle connection the server drops is an error on the pool, not on any query; each listener
  // hears it, in the order they listened, and the pool replaces the connection on its next query.
  // With none it is dropped. Hands back the listener's unsubscribe.
  readonly onPoolError: (listener: (error: Error) => void) => () => void;
};

export type Options = { readonly url: Env.Secret };

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

// env has already refused a url that does not parse; one that still does not reaches the pool as
// it is, and fails at the first query. PlanetScale urls carry sslrootcert=system, libpq 16's
// "verify against the system trust store". node-postgres reads sslrootcert as a file path, so the
// first query dies with ENOENT (node-postgres#3101). Node's default TLS verification already is
// the system trust store, so dropping the parameter keeps the url's meaning; sslmode=verify-full
// stays.
const connectionString = (url: Env.Secret): string => {
  const raw = url.reveal();
  if (!URL.canParse(raw)) {
    return raw;
  }
  const parsed = new URL(raw);
  if (parsed.searchParams.get("sslrootcert") !== "system") {
    return raw;
  }
  parsed.searchParams.delete("sslrootcert");
  return parsed.toString();
};

// Nothing connects until the first query.
export const create = App.createService<never, Options, Database>((_, { url }) => {
  const pool = new Pool({ connectionString: connectionString(url) });
  const listeners = new Set<(error: Error) => void>();
  pool.on("error", (error) => {
    for (const listener of listeners) {
      listener(error);
    }
  });
  const db = drizzle({ client: pool, schema: Schema });
  return {
    service: "db",
    run: (query) => jarl.exec(() => query(db), failed),
    close: () => jarl.exec(() => pool.end(), failed),
    onPoolError: (listener) => {
      // A subscription of its own, so a listener subscribed twice is heard twice and each
      // unsubscribe takes back only its own.
      const own = (error: Error) => listener(error);
      listeners.add(own);
      return () => {
        listeners.delete(own);
      };
    },
  };
});
