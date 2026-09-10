import { and, eq, sql } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Option } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type AutomationJobRow = typeof DbSchema.automationJobs.$inferSelect;
export type AutomationAction = AutomationJobRow["action"];
export type FinishStatus = "succeeded" | "failed" | "aborted";

export type EnqueueInput = {
  readonly resultId: string;
  readonly action: AutomationAction;
};

export class AutomationStore extends Context.Service<AutomationStore>()(
  "@oligarchy/db/AutomationStore",
  {
    make: Effect.gen(function* () {
      const database = yield* Client.Database;

      // Insert a pending job. A second (result_id, action) is the unique index's DatabaseError.
      const enqueue = Effect.fn("db.enqueueAutomationJob")(function* (input: EnqueueInput) {
        const [row] = yield* database.run("enqueueAutomationJob", (db) =>
          db
            .insert(DbSchema.automationJobs)
            .values({ resultId: input.resultId, action: input.action, status: "pending" })
            .returning(),
        );
        return row;
      });

      // Oldest pending, locked for the transaction so a second claimer waits. Queue order is
      // created_at; id breaks a tie.
      const claim = Effect.fn("db.claimAutomationJob")(function* () {
        return yield* database.transaction("claimAutomationJob", (tx) =>
          Effect.gen(function* () {
            const pending = yield* Client.attempt("claimAutomationJob", () =>
              tx
                .select()
                .from(DbSchema.automationJobs)
                .where(eq(DbSchema.automationJobs.status, "pending"))
                .orderBy(DbSchema.automationJobs.createdAt, DbSchema.automationJobs.id)
                .limit(1)
                .for("update"),
            );
            const row = Arr.head(pending);
            if (Option.isNone(row)) {
              return Option.none();
            }
            const updated = yield* Client.attempt("claimAutomationJob", () =>
              tx
                .update(DbSchema.automationJobs)
                .set({ status: "running", startedAt: sql`now()` })
                .where(eq(DbSchema.automationJobs.id, row.value.id))
                .returning(),
            );
            return Arr.head(updated);
          }),
        );
      });

      // Only a running row closes. reason is omitted when null so a previous value stays.
      const finish = Effect.fn("db.finishAutomationJob")(function* (
        id: string,
        status: FinishStatus,
        reason: string | null,
      ) {
        const rows = yield* database.run("finishAutomationJob", (db) =>
          db
            .update(DbSchema.automationJobs)
            .set(
              Object.assign(
                { status, finishedAt: sql`now()` },
                reason === null ? undefined : { reason },
              ),
            )
            .where(
              and(
                eq(DbSchema.automationJobs.id, id),
                eq(DbSchema.automationJobs.status, "running"),
              ),
            )
            .returning({ id: DbSchema.automationJobs.id }),
        );
        return rows.length > 0;
      });

      return { enqueue, claim, finish };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
