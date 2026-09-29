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
  // The work on one connection between begin and commit; a throw rolls it back and comes back as
  // a DatabaseError. A returned value commits, an error result included.
  readonly transaction: <T>(
    work: (tx: Drizzle) => Promise<T>,
  ) => Promise<jarl.Result<T, DatabaseError>>;
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
  // Not drizzle's transaction: it sends begin before its try, so a begin that fails never gives
  // the connection back, and pool.end then waits on it forever.
  const transaction = async <T>(work: (tx: Drizzle) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    let broken: Error | undefined;
    // Handed out, a connection is no longer the pool's to watch: a drop between queries is an
    // error event on it, and with no listener it would end the process.
    const dropped = (error: Error) => {
      broken = error;
      options.onPoolError(error);
    };
    client.on("error", dropped);
    const send = async (text: string) => {
      try {
        await client.query(text);
      } catch (thrown) {
        broken ??= thrown instanceof Error ? thrown : new Error(String(thrown));
        throw thrown;
      }
    };
    try {
      await send("begin");
      try {
        const result = await work(drizzle({ client, schema: Schema }));
        await send("commit");
        return result;
      } catch (thrown) {
        // The work's error is the one worth reporting; a rollback that fails marks the
        // connection broken, and a broken connection is destroyed, its transaction with it.
        if (broken === undefined) {
          await send("rollback").catch(() => undefined);
        }
        throw thrown;
      }
    } finally {
      client.off("error", dropped);
      // With an error the pool destroys the connection instead of handing it out again.
      client.release(broken);
    }
  };
  return jarl.ok({
    service: "db",
    run: (query) => attempt(() => query(db)),
    transaction: (work) => attempt(() => transaction(work)),
    close: () => attempt(() => pool.end()),
  });
};
