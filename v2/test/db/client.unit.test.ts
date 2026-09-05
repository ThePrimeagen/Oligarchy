import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Redacted } from "effect";
import * as Client from "../../src/db/client.ts";
import * as Errors from "../../src/shared/errors.ts";

const PASSWORD = "pa55w0rd-sentinel";

class Marker extends Context.Service<Marker, { readonly value: string }>()("test/Marker") {}

describe("normalizeDatabaseUrl", () => {
  it.effect("drops sslrootcert=system and keeps sslmode=verify-full", () =>
    Effect.gen(function* () {
      const url = yield* Client.normalizeDatabaseUrl(
        Redacted.make(
          `postgres://user:${PASSWORD}@aws.connect.psdb.cloud/oligarchy?sslmode=verify-full&sslrootcert=system`,
        ),
      );
      expect(Redacted.value(url)).toBe(
        `postgres://user:${PASSWORD}@aws.connect.psdb.cloud/oligarchy?sslmode=verify-full`,
      );
    }),
  );

  it.effect("returns a url without sslrootcert untouched", () =>
    Effect.gen(function* () {
      const raw = "postgres://user:pw@127.0.0.1:5432/oligarchy?sslmode=verify-full";
      const url = yield* Client.normalizeDatabaseUrl(Redacted.make(raw));
      expect(Redacted.value(url)).toBe(raw);
      const other = yield* Client.normalizeDatabaseUrl(
        Redacted.make("postgres://u@h/db?sslrootcert=/etc/ca.pem"),
      );
      expect(Redacted.value(other)).toBe("postgres://u@h/db?sslrootcert=/etc/ca.pem");
    }),
  );

  it.effect("fails a url that cannot be parsed without leaking the password", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Client.normalizeDatabaseUrl(Redacted.make(`not a url ${PASSWORD}`)),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const pretty = Cause.pretty(exit.cause);
        expect(pretty).toContain("db: DATABASE_URL is not a valid url");
        expect(pretty).not.toContain(PASSWORD);
        expect(Cause.squash(exit.cause)).toMatchObject({
          _tag: "DatabaseError",
          operation: "connect",
          message: "db: DATABASE_URL is not a valid url",
        });
      }
    }),
  );

  it.effect("treats an empty url as invalid", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Client.normalizeDatabaseUrl(Redacted.make("")));
      expect(error.message).toBe("db: DATABASE_URL is not a valid url");
    }),
  );
});

const driverFailure = () =>
  Object.assign(new Error("Failed query: select 1"), {
    cause: new Error("connect ECONNREFUSED 127.0.0.1:1"),
  });

describe("attempt", () => {
  it.effect("returns the resolved value", () =>
    Effect.gen(function* () {
      expect(yield* Client.attempt("ping", () => Promise.resolve(42))).toBe(42);
    }),
  );

  it.effect("maps a rejection to DatabaseError with the driver message and its cause", () =>
    Effect.gen(function* () {
      const thrown = driverFailure();
      const error = yield* Effect.flip(Client.attempt("ping", () => Promise.reject(thrown)));
      expect(error).toMatchObject({
        _tag: "DatabaseError",
        operation: "ping",
        message: "Failed query: select 1",
      });
      expect(error.cause).toBe(thrown.cause);
    }),
  );

  it.effect("keeps the thrown value as the cause when it has none of its own", () =>
    Effect.gen(function* () {
      const thrown = new Error("pool ended");
      const error = yield* Effect.flip(Client.attempt("select", () => Promise.reject(thrown)));
      expect(error.message).toBe("pool ended");
      expect(error.cause).toBe(thrown);
    }),
  );

  it.effect("describes a non-error rejection", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Client.attempt("select", () => Promise.reject("boom")));
      expect(error.message).toBe("database request failed");
      expect(error.cause).toBe("boom");
    }),
  );
});

describe("Database.make", () => {
  const url = Redacted.make("postgres://user:pw@127.0.0.1:1/oligarchy");

  it.effect("run maps a rejected query to DatabaseError", () =>
    Effect.gen(function* () {
      const database = yield* Client.Database.make(url);
      const thrown = driverFailure();
      const error = yield* Effect.flip(database.run("select", () => Promise.reject(thrown)));
      expect(error).toMatchObject({
        _tag: "DatabaseError",
        operation: "select",
        message: "Failed query: select 1",
      });
      expect(error.cause).toBe(thrown.cause);
    }),
  );

  it.effect("run returns the resolved value", () =>
    Effect.gen(function* () {
      const database = yield* Client.Database.make(url);
      expect(yield* database.run("select", () => Promise.resolve("ok"))).toBe("ok");
    }),
  );

  it.effect("fails at acquire for an invalid url", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Client.Database.make(Redacted.make("nope")));
      expect(error.message).toBe("db: DATABASE_URL is not a valid url");
    }),
  );
});

describe("runInTransaction", () => {
  const recordingBegin = () => {
    const thrown: Array<unknown> = [];
    const begin = <A>(body: (tx: string) => Promise<A>): Promise<A> =>
      body("tx").catch((failure: unknown) => {
        thrown.push(failure);
        throw failure;
      });
    return { begin, thrown };
  };

  it.effect("returns the body's value when it succeeds", () =>
    Effect.gen(function* () {
      const { begin, thrown } = recordingBegin();
      const value = yield* Client.runInTransaction("createRun", begin, (tx: string) =>
        Effect.succeed(`${tx}: created`),
      );
      expect(value).toBe("tx: created");
      expect(thrown).toEqual([]);
    }),
  );

  it.effect("re-fails a body failure with its own tagged error after the rollback path", () =>
    Effect.gen(function* () {
      const { begin, thrown } = recordingBegin();
      const error = yield* Effect.flip(
        Client.runInTransaction("createRun", begin, () =>
          Effect.fail(Errors.CommandError.make({ message: "test: no test definitions found" })),
        ),
      );
      expect(error).toMatchObject({
        _tag: "CommandError",
        message: "test: no test definitions found",
      });
      expect(thrown).toHaveLength(1);
      expect(Exit.isExit(thrown[0])).toBe(true);
    }),
  );

  it.effect("re-raises a body defect as a defect", () =>
    Effect.gen(function* () {
      const { begin } = recordingBegin();
      const exit = yield* Effect.exit(
        Client.runInTransaction("createRun", begin, () => Effect.die("boom")),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
      }
    }),
  );

  it.effect("maps a driver rejection outside the body to DatabaseError", () =>
    Effect.gen(function* () {
      const begin = <A>(_body: (tx: string) => Promise<A>): Promise<A> =>
        Promise.reject(driverFailure());
      const error = yield* Effect.flip(
        Client.runInTransaction("endSession", begin, () => Effect.succeed(1)),
      );
      expect(error).toMatchObject({
        _tag: "DatabaseError",
        operation: "endSession",
        message: "Failed query: select 1",
      });
    }),
  );

  it.effect("the body sees the services of the caller", () =>
    Effect.gen(function* () {
      const { begin } = recordingBegin();
      const value = yield* Client.runInTransaction("x", begin, () =>
        Effect.map(Marker, (marker) => marker.value),
      ).pipe(Effect.provideService(Marker, { value: "provided" }));
      expect(value).toBe("provided");
    }),
  );
});
