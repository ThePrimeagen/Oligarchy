import { and, eq, sql } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type RunInput = {
  readonly iso: string;
  readonly serverUrl: string;
  readonly definitions: ReadonlyArray<{ readonly id: number }>;
};

export type CreatedRun = {
  readonly runId: string;
  readonly results: ReadonlyArray<{ readonly id: string; readonly definitionId: number }>;
};

export class TestStore extends Context.Service<TestStore>()("@oligarchy/db/TestStore", {
  make: Effect.gen(function* () {
    const database = yield* Client.Database;

    const listTestDefinitions = database.run("listTestDefinitions", (db) =>
      db.select().from(DbSchema.testDefinitions).orderBy(DbSchema.testDefinitions.name),
    );

    const findTestDefinition = Effect.fn("db.findTestDefinition")(function* (name: string) {
      const rows = yield* database.run("findTestDefinition", (db) =>
        db.select().from(DbSchema.testDefinitions).where(eq(DbSchema.testDefinitions.name, name)),
      );
      return Arr.head(rows);
    });

    const listTestBasePrompts = database.run("listTestBasePrompts", (db) =>
      db.select().from(DbSchema.testBasePrompts).orderBy(DbSchema.testBasePrompts.name),
    );

    const createRun = Effect.fn("db.createRun")(function* (input: RunInput) {
      return yield* database.transaction("createRun", (tx) =>
        Effect.gen(function* () {
          const [run] = yield* Client.attempt("createRun", () =>
            tx
              .insert(DbSchema.testRuns)
              .values({
                name: "Omarchy experiment",
                iso: input.iso,
                serverUrl: input.serverUrl,
                status: "pending",
              })
              .returning({ id: DbSchema.testRuns.id }),
          );
          const results = yield* Client.attempt("createRun", () =>
            tx
              .insert(DbSchema.testResults)
              .values(
                input.definitions.map((definition) => ({
                  runId: run.id,
                  definitionId: definition.id,
                  status: "pending" as const,
                })),
              )
              .returning({
                id: DbSchema.testResults.id,
                definitionId: DbSchema.testResults.definitionId,
              }),
          );
          return { runId: run.id, results } satisfies CreatedRun;
        }),
      );
    });

    const failRun = Effect.fn("db.failRun")(function* (runId: string, reason: string) {
      const finishedAt = sql`now()`;
      yield* database.transaction("failRun", (tx) =>
        Effect.gen(function* () {
          yield* Client.attempt("failRun", () =>
            tx
              .update(DbSchema.testRuns)
              .set({ status: "failed", reason, endedAt: finishedAt })
              .where(eq(DbSchema.testRuns.id, runId)),
          );
          yield* Client.attempt("failRun", () =>
            tx
              .update(DbSchema.testResults)
              .set({ status: "failed", reason, finishedAt })
              .where(eq(DbSchema.testResults.runId, runId)),
          );
        }),
      );
    });

    const startResult = Effect.fn("db.startResult")(function* (
      resultId: string,
      sessionId: string,
    ) {
      const rows = yield* database.run("startResult", (db) =>
        db
          .update(DbSchema.testResults)
          .set({ sessionId, status: "running" })
          .where(
            and(eq(DbSchema.testResults.id, resultId), eq(DbSchema.testResults.status, "pending")),
          )
          .returning({ id: DbSchema.testResults.id }),
      );
      return rows.length > 0;
    });

    // A null session leaves the id `test start` wrote in place.
    const closeResult = Effect.fn("db.closeResult")(function* (
      resultId: string,
      status: "passed" | "failed",
      reason: string | null,
      sessionId: string | null,
    ) {
      const rows = yield* database.run("closeResult", (db) =>
        db
          .update(DbSchema.testResults)
          .set(
            Object.assign(
              { status, reason, finishedAt: sql`now()` },
              sessionId === null ? undefined : { sessionId },
            ),
          )
          .where(eq(DbSchema.testResults.id, resultId))
          .returning({ id: DbSchema.testResults.id }),
      );
      return rows.length > 0;
    });

    const resultForSession = Effect.fn("db.resultForSession")(function* (sessionId: string) {
      return yield* database.run("resultForSession", (db) =>
        db
          .select({ result: DbSchema.testResults, definition: DbSchema.testDefinitions })
          .from(DbSchema.testResults)
          .innerJoin(
            DbSchema.testDefinitions,
            eq(DbSchema.testResults.definitionId, DbSchema.testDefinitions.id),
          )
          .where(eq(DbSchema.testResults.sessionId, sessionId)),
      );
    });

    return {
      listTestDefinitions,
      findTestDefinition,
      listTestBasePrompts,
      createRun,
      failRun,
      startResult,
      closeResult,
      resultForSession,
    };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
