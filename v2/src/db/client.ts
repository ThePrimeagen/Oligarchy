import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Cause, Context, Effect, Exit, Layer, Redacted, Scope } from "effect";
import pg from "pg";
import * as ExternalFailure from "../external-failure.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as DbSchema from "./schema.ts";

export type Db = NodePgDatabase<typeof DbSchema> & { readonly $client: pg.Pool };
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// canParse instead of letting new URL throw: that TypeError carries the url — password
// included — into the logs.
// PlanetScale urls carry sslrootcert=system — libpq 16's "verify against the system trust
// store". node-postgres reads sslrootcert as a literal file path, so the first query dies with
// ENOENT (node-postgres#3101). Node's default TLS verification already is the system trust
// store, so dropping the parameter keeps the url's exact semantics; sslmode=verify-full stays.
export const normalizeDatabaseUrl = (
  url: Redacted.Redacted,
): Effect.Effect<Redacted.Redacted, Errors.DatabaseError> =>
  Effect.gen(function* () {
    const raw = Redacted.value(url);
    if (!URL.canParse(raw)) {
      return yield* Errors.DatabaseError.make({
        operation: "connect",
        message: "db: DATABASE_URL is not a valid url",
      });
    }
    const parsed = new URL(raw);
    if (parsed.searchParams.get("sslrootcert") !== "system") {
      return url;
    }
    parsed.searchParams.delete("sslrootcert");
    return Redacted.make(parsed.toString());
  });

const databaseError = (operation: string, thrown: unknown): Errors.DatabaseError =>
  Errors.DatabaseError.make({
    operation,
    message: ExternalFailure.describeThrowable(thrown, "database request failed"),
    cause: ExternalFailure.causeOf(thrown),
  });

// One driver promise as an Effect; the rejection becomes the one DatabaseError.
export const attempt = <A>(
  operation: string,
  query: () => Promise<A>,
): Effect.Effect<A, Errors.DatabaseError> =>
  Effect.tryPromise({ try: query, catch: (thrown) => databaseError(operation, thrown) });

// The body runs inside drizzle's promise transaction; a failing body throws its Exit so the
// transaction rolls back, and the Exit's cause is re-raised as itself afterwards.
export const runInTransaction = <TX, A, E, R>(
  operation: string,
  begin: (body: (tx: TX) => Promise<A>) => Promise<A>,
  body: (tx: TX) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Errors.DatabaseError, R> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const rolledBack: { cause: Cause.Cause<E> | undefined } = { cause: undefined };
    const attempted: Effect.Effect<A, Cause.Cause<E> | Errors.DatabaseError> = Effect.tryPromise({
      try: () =>
        begin(async (tx) => {
          const exit = await Effect.runPromiseExitWith(context)(body(tx));
          if (Exit.isSuccess(exit)) {
            return exit.value;
          }
          rolledBack.cause = exit.cause;
          throw exit;
        }),
      catch: (thrown) => rolledBack.cause ?? databaseError(operation, thrown),
    });
    return yield* Effect.catch(
      attempted,
      (failure): Effect.Effect<never, E | Errors.DatabaseError> =>
        Cause.isCause(failure) ? Effect.failCause(failure) : Effect.fail(failure),
    );
  });

export type DatabaseService = {
  readonly db: Db;
  readonly run: <A>(
    operation: string,
    query: (db: Db) => Promise<A>,
  ) => Effect.Effect<A, Errors.DatabaseError>;
  readonly transaction: <A, E, R>(
    operation: string,
    body: (tx: Tx) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | Errors.DatabaseError, R>;
  readonly ping: Effect.Effect<void, Errors.DatabaseError>;
};

const makeDatabase = (
  url: Redacted.Redacted,
): Effect.Effect<DatabaseService, Errors.DatabaseError, Scope.Scope> =>
  Effect.gen(function* () {
    const connectionString = Redacted.value(yield* normalizeDatabaseUrl(url));
    const context = yield* Effect.context();
    // No connect at acquire: the first query connects, as today's connectDatabase.
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const created = new pg.Pool({ connectionString });
        created.on("error", (failure) => {
          Effect.runForkWith(context)(
            Effect.logError(`db: pool error: ${Render.errorDetail(failure)}`),
          );
        });
        return created;
      }),
      (created) =>
        Effect.tryPromise({
          try: () => created.end(),
          catch: (thrown) => databaseError("close", thrown),
        }).pipe(
          Effect.catch((failure) =>
            Effect.logError(`db: pool close failed: ${Render.headline(failure)}`),
          ),
        ),
    );
    const db: Db = drizzle({ client: pool, schema: DbSchema });
    const run = <A>(operation: string, query: (db: Db) => Promise<A>) =>
      attempt(operation, () => query(db));
    return {
      db,
      run,
      transaction: (operation, body) =>
        runInTransaction(operation, (fn) => db.transaction(fn), body),
      ping: Effect.asVoid(run("ping", (client) => client.execute(sql`select 1`))),
    } satisfies DatabaseService;
  });

export class Database extends Context.Service<Database>()("@oligarchy/db/Database", {
  make: makeDatabase,
}) {
  static readonly layer = (url: Redacted.Redacted): Layer.Layer<Database, Errors.DatabaseError> =>
    Layer.effect(this)(this.make(url));
}
