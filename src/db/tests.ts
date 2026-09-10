import { and, count, desc, eq, sql } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Option } from "effect";
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

export type DefinitionInput = {
  readonly name: string;
  readonly description: string;
  readonly instruction: string;
  readonly proof: string;
};

export type DefinedDefinition = {
  readonly id: number;
  // The row's place among its name's rows by id: 1 for a new name.
  readonly version: number;
};

export class TestStore extends Context.Service<TestStore>()("@oligarchy/db/TestStore", {
  make: Effect.gen(function* () {
    const database = yield* Client.Database;

    // A name's newest wording is its highest id: one row per name, the newest.
    const listTestDefinitions = database.run("listTestDefinitions", (db) =>
      db
        .selectDistinctOn([DbSchema.testDefinitions.name])
        .from(DbSchema.testDefinitions)
        .orderBy(DbSchema.testDefinitions.name, desc(DbSchema.testDefinitions.id)),
    );

    const findTestDefinition = Effect.fn("db.findTestDefinition")(function* (name: string) {
      const rows = yield* database.run("findTestDefinition", (db) =>
        db
          .select()
          .from(DbSchema.testDefinitions)
          .where(eq(DbSchema.testDefinitions.name, name))
          .orderBy(desc(DbSchema.testDefinitions.id))
          .limit(1),
      );
      return Arr.head(rows);
    });

    // Every wording, by name then oldest first; one name's when given.
    const listTestDefinitionHistory = Effect.fn("db.listTestDefinitionHistory")(function* (
      name: Option.Option<string>,
    ) {
      return yield* database.run("listTestDefinitionHistory", (db) =>
        db
          .select()
          .from(DbSchema.testDefinitions)
          .where(
            Option.getOrUndefined(Option.map(name, (n) => eq(DbSchema.testDefinitions.name, n))),
          )
          .orderBy(DbSchema.testDefinitions.name, DbSchema.testDefinitions.id),
      );
    });

    // The insert and the count land in one transaction, so the version printed is the one the
    // new row holds.
    const defineTestDefinition = Effect.fn("db.defineTestDefinition")(function* (
      input: DefinitionInput,
    ) {
      return yield* database.transaction("defineTestDefinition", (tx) =>
        Effect.gen(function* () {
          const [row] = yield* Client.attempt("defineTestDefinition", () =>
            tx
              .insert(DbSchema.testDefinitions)
              .values(input)
              .returning({ id: DbSchema.testDefinitions.id }),
          );
          const [counted] = yield* Client.attempt("defineTestDefinition", () =>
            tx
              .select({ version: count() })
              .from(DbSchema.testDefinitions)
              .where(eq(DbSchema.testDefinitions.name, input.name)),
          );
          return { id: row.id, version: counted.version } satisfies DefinedDefinition;
        }),
      );
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
      model: string,
    ) {
      const rows = yield* database.run("startResult", (db) =>
        db
          .update(DbSchema.testResults)
          .set({ sessionId, status: "running", model })
          .where(
            and(eq(DbSchema.testResults.id, resultId), eq(DbSchema.testResults.status, "pending")),
          )
          .returning({ id: DbSchema.testResults.id }),
      );
      return rows.length > 0;
    });

    // A null reason or session leaves what an earlier command wrote in place: the key is absent,
    // where a `null` value would be written as NULL.
    const closeResult = Effect.fn("db.closeResult")(function* (
      resultId: string,
      status: "passed" | "failed" | "aborted",
      reason: string | null,
      sessionId: string | null,
    ) {
      const rows = yield* database.run("closeResult", (db) =>
        db
          .update(DbSchema.testResults)
          .set(
            Object.assign(
              { status, finishedAt: sql`now()` },
              reason === null ? undefined : { reason },
              sessionId === null ? undefined : { sessionId },
            ),
          )
          .where(eq(DbSchema.testResults.id, resultId))
          .returning({ id: DbSchema.testResults.id }),
      );
      return rows.length > 0;
    });

    // The result by its id, whether or not a session has run it yet.
    const findResult = Effect.fn("db.findResult")(function* (resultId: string) {
      const rows = yield* database.run("findResult", (db) =>
        db.select().from(DbSchema.testResults).where(eq(DbSchema.testResults.id, resultId)),
      );
      return Arr.head(rows);
    });

    // Persist the Linear identifier (OLI-n) created for this result so webhooks can find it.
    // A missing result after createRun is a broken invariant, not a caller mistake.
    const setLinearId = Effect.fn("db.setLinearId")(function* (resultId: string, linearId: string) {
      const rows = yield* database.run("setLinearId", (db) =>
        db
          .update(DbSchema.testResults)
          .set({ linearId })
          .where(eq(DbSchema.testResults.id, resultId))
          .returning({ id: DbSchema.testResults.id }),
      );
      if (rows.length === 0) {
        return yield* Effect.die(new Error(`setLinearId: no result ${resultId}`));
      }
      return yield* Effect.void;
    });

    // Reverse lookup: the Linear human-readable id on the webhook → the result row.
    const findResultByLinearId = Effect.fn("db.findResultByLinearId")(function* (linearId: string) {
      const rows = yield* database.run("findResultByLinearId", (db) =>
        db.select().from(DbSchema.testResults).where(eq(DbSchema.testResults.linearId, linearId)),
      );
      return Arr.head(rows);
    });

    // The result a session ran, with the definition it tested and the run it belongs to.
    const resultForSession = Effect.fn("db.resultForSession")(function* (sessionId: string) {
      return yield* database.run("resultForSession", (db) =>
        db
          .select({
            result: DbSchema.testResults,
            definition: DbSchema.testDefinitions,
            run: DbSchema.testRuns,
          })
          .from(DbSchema.testResults)
          .innerJoin(
            DbSchema.testDefinitions,
            eq(DbSchema.testResults.definitionId, DbSchema.testDefinitions.id),
          )
          .innerJoin(DbSchema.testRuns, eq(DbSchema.testResults.runId, DbSchema.testRuns.id))
          .where(eq(DbSchema.testResults.sessionId, sessionId)),
      );
    });

    return {
      listTestDefinitions,
      findTestDefinition,
      listTestDefinitionHistory,
      defineTestDefinition,
      listTestBasePrompts,
      createRun,
      failRun,
      startResult,
      closeResult,
      findResult,
      setLinearId,
      findResultByLinearId,
      resultForSession,
    };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
