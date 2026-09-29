import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { eq } from "drizzle-orm";
import type { Answer } from "./answer.ts";

export type Verdict = (typeof DbSchema.diagnosisVerdict.enumValues)[number];

export type ErrorTypeRow = typeof DbSchema.postRunErrorTypes.$inferSelect;

export type DiagnosisRow = typeof DbSchema.postRunDiagnosis.$inferSelect;

// errorType is null exactly when the verdict is passed; the table's check refuses anything else.
export type DiagnosisInput = {
  readonly jobId: string;
  readonly verdict: Verdict;
  readonly errorType: string | null;
  readonly summary: string;
  readonly model: string;
};

export type Diagnosis = {
  readonly service: "diagnosis";
  readonly createErrorType: (key: string, description: string) => Answer<boolean>;
  readonly listErrorTypes: () => Answer<ReadonlyArray<ErrorTypeRow>>;
  readonly findErrorType: (key: string) => Answer<ErrorTypeRow | undefined>;
  readonly saveDiagnosis: (input: DiagnosisInput) => Answer<boolean>;
  readonly getDiagnosis: (jobId: string) => Answer<DiagnosisRow | undefined>;
};

declare module "@oligarchy/app" {
  interface Services {
    diagnosis: App.Register<"diagnosis", Diagnosis>;
  }
}

export const create = (db: Db.Database): Diagnosis => ({
  service: "diagnosis",

  createErrorType: (key, description) =>
    db.run(async (d) => {
      const rows = await d
        .insert(DbSchema.postRunErrorTypes)
        .values({ key, description })
        .onConflictDoNothing()
        .returning({ key: DbSchema.postRunErrorTypes.key });
      return rows.length > 0;
    }),

  listErrorTypes: () =>
    db.run((d) =>
      d.select().from(DbSchema.postRunErrorTypes).orderBy(DbSchema.postRunErrorTypes.key),
    ),

  findErrorType: (key) =>
    db.run(async (d) => {
      const [row] = await d
        .select()
        .from(DbSchema.postRunErrorTypes)
        .where(eq(DbSchema.postRunErrorTypes.key, key));
      return row;
    }),

  saveDiagnosis: (input) =>
    db.run(async (d) => {
      const rows = await d
        .insert(DbSchema.postRunDiagnosis)
        .values(input)
        .onConflictDoNothing()
        .returning({ jobId: DbSchema.postRunDiagnosis.jobId });
      return rows.length > 0;
    }),

  getDiagnosis: (jobId) =>
    db.run(async (d) => {
      const [row] = await d
        .select()
        .from(DbSchema.postRunDiagnosis)
        .where(eq(DbSchema.postRunDiagnosis.jobId, jobId));
      return row;
    }),
});
