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

      // false when the key is taken: a conflict is an answer the command reads, not an error.
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

      const listErrorTypes = Effect.fn("db.listErrorTypes")(function* () {
        return yield* database.run("listErrorTypes", (db) =>
          db.select().from(DbSchema.postRunErrorTypes).orderBy(DbSchema.postRunErrorTypes.key),
        );
      });

      const findErrorType = Effect.fn("db.findErrorType")(function* (key: string) {
        const rows = yield* database.run("findErrorType", (db) =>
          db
            .select()
            .from(DbSchema.postRunErrorTypes)
            .where(eq(DbSchema.postRunErrorTypes.key, key)),
        );
        return Arr.head(rows);
      });

      // false when the session already has its diagnosis: the first one stands.
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
