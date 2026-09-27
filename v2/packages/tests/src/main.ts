import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import type * as jarl from "jarl";

export type DefinitionRow = typeof DbSchema.testDefinitions.$inferSelect;

export type BasePromptRow = typeof DbSchema.testBasePrompts.$inferSelect;

export type RunRow = typeof DbSchema.testRuns.$inferSelect;

export type ResultRow = typeof DbSchema.testResults.$inferSelect;

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

export type SessionResult = {
  readonly result: ResultRow;
  readonly definition: DefinitionRow;
  readonly run: RunRow;
};

export type DriveFacts = {
  readonly name: string;
  readonly description: string;
  readonly instruction: string;
  readonly proof: string;
  readonly iso: string;
  readonly serverUrl: string;
};

type Answer<T> = Promise<jarl.Result<T, Db.DatabaseError>>;

export type Tests = {
  readonly service: "tests";
  readonly listTestDefinitions: () => Answer<ReadonlyArray<DefinitionRow>>;
  readonly findTestDefinition: (name: string) => Answer<DefinitionRow | undefined>;
  readonly listTestDefinitionHistory: (name?: string) => Answer<ReadonlyArray<DefinitionRow>>;
  readonly defineTestDefinition: (input: DefinitionInput) => Answer<DefinedDefinition>;
  readonly listTestBasePrompts: () => Answer<ReadonlyArray<BasePromptRow>>;
  readonly createRun: (input: RunInput) => Answer<CreatedRun>;
  readonly failRun: (
    runId: string,
    reason: string,
    resultIds: ReadonlyArray<string>,
  ) => Answer<void>;
  readonly startResult: (resultId: string, sessionId: string, model: string) => Answer<boolean>;
  readonly closeResult: (
    resultId: string,
    status: "passed" | "failed",
    reason: string | null,
    sessionId: string | null,
  ) => Answer<boolean>;
  readonly errorResult: (resultId: string, reason: string) => Answer<boolean>;
  readonly findResult: (resultId: string) => Answer<ResultRow | undefined>;
  readonly setLinearId: (resultId: string, linearId: string) => Answer<void>;
  readonly findResultByLinearId: (linearId: string) => Answer<ResultRow | undefined>;
  readonly resultForSession: (sessionId: string) => Answer<ReadonlyArray<SessionResult>>;
  readonly definitionName: (id: number) => Answer<string | undefined>;
  readonly resumeIso: (resultId: string) => Answer<string | undefined>;
  readonly driveFacts: (resultId: string) => Answer<DriveFacts | undefined>;
};

declare module "@oligarchy/app" {
  interface Services {
    tests: App.Register<"tests", Tests>;
  }
}

export const create = (db: Db.Database): Tests => ({
  service: "tests",

  listTestDefinitions: () =>
    db.run((d) =>
      d
        .selectDistinctOn([DbSchema.testDefinitions.name])
        .from(DbSchema.testDefinitions)
        .orderBy(DbSchema.testDefinitions.name, desc(DbSchema.testDefinitions.id)),
    ),

  findTestDefinition: (name) =>
    db.run(async (d) => {
      const [row] = await d
        .select()
        .from(DbSchema.testDefinitions)
        .where(eq(DbSchema.testDefinitions.name, name))
        .orderBy(desc(DbSchema.testDefinitions.id))
        .limit(1);
      return row;
    }),

  listTestDefinitionHistory: (name) =>
    db.run((d) =>
      d
        .select()
        .from(DbSchema.testDefinitions)
        .where(name === undefined ? undefined : eq(DbSchema.testDefinitions.name, name))
        .orderBy(DbSchema.testDefinitions.name, DbSchema.testDefinitions.id),
    ),

  defineTestDefinition: (input) =>
    db.run((d) =>
      d.transaction(async (tx) => {
        const [row] = await tx
          .insert(DbSchema.testDefinitions)
          .values(input)
          .returning({ id: DbSchema.testDefinitions.id });
        if (row === undefined) {
          throw new Error("defineTestDefinition: the insert returned no row");
        }
        const version = await tx.$count(
          DbSchema.testDefinitions,
          eq(DbSchema.testDefinitions.name, input.name),
        );
        return { id: row.id, version };
      }),
    ),

  listTestBasePrompts: () =>
    db.run((d) => d.select().from(DbSchema.testBasePrompts).orderBy(DbSchema.testBasePrompts.name)),

  createRun: (input) =>
    db.run((d) =>
      d.transaction(async (tx) => {
        const [run] = await tx
          .insert(DbSchema.testRuns)
          .values({
            name: "Omarchy experiment",
            iso: input.iso,
            serverUrl: input.serverUrl,
            status: "pending",
          })
          .returning({ id: DbSchema.testRuns.id });
        if (run === undefined) {
          throw new Error("createRun: the insert returned no row");
        }
        const results = await tx
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
          });
        return { runId: run.id, results };
      }),
    ),

  failRun: (runId, reason, resultIds) =>
    db.run((d) =>
      d.transaction(async (tx) => {
        const finishedAt = sql`now()`;
        await tx
          .update(DbSchema.testRuns)
          .set({ status: "failed", reason, endedAt: finishedAt })
          .where(eq(DbSchema.testRuns.id, runId));
        await tx
          .update(DbSchema.testResults)
          .set({ status: "failed", reason, finishedAt })
          .where(
            and(eq(DbSchema.testResults.runId, runId), inArray(DbSchema.testResults.id, resultIds)),
          );
      }),
    ),

  startResult: (resultId, sessionId, model) =>
    db.run(async (d) => {
      const rows = await d
        .update(DbSchema.testResults)
        .set({ sessionId, status: "running", model })
        .where(
          and(eq(DbSchema.testResults.id, resultId), eq(DbSchema.testResults.status, "pending")),
        )
        .returning({ id: DbSchema.testResults.id });
      return rows.length > 0;
    }),

  closeResult: (resultId, status, reason, sessionId) =>
    db.run(async (d) => {
      const rows = await d
        .update(DbSchema.testResults)
        .set(
          Object.assign(
            { status, finishedAt: sql`now()` },
            reason === null ? undefined : { reason },
            sessionId === null ? undefined : { sessionId },
          ),
        )
        .where(
          and(
            eq(DbSchema.testResults.id, resultId),
            notInArray(DbSchema.testResults.status, ["aborted", "errored"]),
          ),
        )
        .returning({ id: DbSchema.testResults.id });
      return rows.length > 0;
    }),

  errorResult: (resultId, reason) =>
    db.run(async (d) => {
      const rows = await d
        .update(DbSchema.testResults)
        .set({ status: "errored", reason, finishedAt: sql`now()` })
        .where(
          and(eq(DbSchema.testResults.id, resultId), ne(DbSchema.testResults.status, "aborted")),
        )
        .returning({ id: DbSchema.testResults.id });
      return rows.length > 0;
    }),

  findResult: (resultId) =>
    db.run(async (d) => {
      const [row] = await d
        .select()
        .from(DbSchema.testResults)
        .where(eq(DbSchema.testResults.id, resultId));
      return row;
    }),

  setLinearId: (resultId, linearId) =>
    db.run(async (d) => {
      const rows = await d
        .update(DbSchema.testResults)
        .set({ linearId })
        .where(eq(DbSchema.testResults.id, resultId))
        .returning({ id: DbSchema.testResults.id });
      if (rows.length === 0) {
        throw new Error(`setLinearId: no result ${resultId}`);
      }
    }),

  findResultByLinearId: (linearId) =>
    db.run(async (d) => {
      const [row] = await d
        .select()
        .from(DbSchema.testResults)
        .where(eq(DbSchema.testResults.linearId, linearId));
      return row;
    }),

  resultForSession: (sessionId) =>
    db.run((d) =>
      d
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
    ),

  definitionName: (id) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ name: DbSchema.testDefinitions.name })
        .from(DbSchema.testDefinitions)
        .where(eq(DbSchema.testDefinitions.id, id));
      return row?.name;
    }),

  resumeIso: (resultId) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ iso: DbSchema.testRuns.iso, name: DbSchema.testDefinitions.name })
        .from(DbSchema.testResults)
        .innerJoin(DbSchema.testRuns, eq(DbSchema.testRuns.id, DbSchema.testResults.runId))
        .innerJoin(
          DbSchema.testDefinitions,
          eq(DbSchema.testDefinitions.id, DbSchema.testResults.definitionId),
        )
        .where(eq(DbSchema.testResults.id, resultId));
      return row === undefined || row.name === "mint" ? undefined : row.iso;
    }),

  driveFacts: (resultId) =>
    db.run(async (d) => {
      const [row] = await d
        .select({
          name: DbSchema.testDefinitions.name,
          description: DbSchema.testDefinitions.description,
          instruction: DbSchema.testDefinitions.instruction,
          proof: DbSchema.testDefinitions.proof,
          iso: DbSchema.testRuns.iso,
          serverUrl: DbSchema.testRuns.serverUrl,
        })
        .from(DbSchema.testResults)
        .innerJoin(
          DbSchema.testDefinitions,
          eq(DbSchema.testDefinitions.id, DbSchema.testResults.definitionId),
        )
        .innerJoin(DbSchema.testRuns, eq(DbSchema.testRuns.id, DbSchema.testResults.runId))
        .where(eq(DbSchema.testResults.id, resultId));
      return row;
    }),
});
