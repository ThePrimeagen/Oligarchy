import { eq } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type ErrorTypeRow = typeof DbSchema.postRunErrorTypes.$inferSelect;
export type DiagnosisRow = typeof DbSchema.postRunDiagnosis.$inferSelect;

export type DiagnosisInput = {
  readonly sessionId: string;
  readonly errorType: string;
  readonly summary: string;
  readonly model: string;
};

export class DiagnosisStore extends Context.Service<DiagnosisStore>()(
  "@oligarchy/db/DiagnosisStore",
  {
    make: Effect.gen(function* () {
      const database = yield* Client.Database;

      // false when the key is already taken: the primary key decides, and a conflict is an
      // answer the command reads, not a database error.
      const createErrorType = Effect.fn("db.createErrorType")(function* (
        key: string,
        description: string,
      ) {
        const rows = yield* database.run("createErrorType", (db) =>
          db
            .insert(DbSchema.postRunErrorTypes)
            .values({ key, description })
            .onConflictDoNothing()
            .returning({ key: DbSchema.postRunErrorTypes.key }),
        );
        return rows.length > 0;
      });

      const listErrorTypes = database.run("listErrorTypes", (db) =>
        db.select().from(DbSchema.postRunErrorTypes).orderBy(DbSchema.postRunErrorTypes.key),
      );

      const findErrorType = Effect.fn("db.findErrorType")(function* (key: string) {
        const rows = yield* database.run("findErrorType", (db) =>
          db
            .select()
            .from(DbSchema.postRunErrorTypes)
            .where(eq(DbSchema.postRunErrorTypes.key, key)),
        );
        return Arr.head(rows);
      });

      // false when the session already has its diagnosis: the first one stands. An unknown
      // type or session is a DatabaseError from the foreign keys; the command checks both
      // first so the operator reads a sentence, not a constraint name.
      const saveDiagnosis = Effect.fn("db.saveDiagnosis")(function* (input: DiagnosisInput) {
        const rows = yield* database.run("saveDiagnosis", (db) =>
          db
            .insert(DbSchema.postRunDiagnosis)
            .values(input)
            .onConflictDoNothing()
            .returning({ sessionId: DbSchema.postRunDiagnosis.sessionId }),
        );
        return rows.length > 0;
      });

      const getDiagnosis = Effect.fn("db.getDiagnosis")(function* (sessionId: string) {
        const rows = yield* database.run("getDiagnosis", (db) =>
          db
            .select()
            .from(DbSchema.postRunDiagnosis)
            .where(eq(DbSchema.postRunDiagnosis.sessionId, sessionId)),
        );
        return Arr.head(rows);
      });

      return { createErrorType, listErrorTypes, findErrorType, saveDiagnosis, getDiagnosis };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
