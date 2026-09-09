import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Option } from "effect";
import type * as Domain from "../shared/domain.ts";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type AutomationJobRow = typeof DbSchema.automationJobs.$inferSelect;

export type EnqueueInput = {
  readonly resultId: string;
  readonly action: Domain.AutomationAction;
};

export type FinishStatus = Exclude<Domain.AutomationJobStatus, "pending" | "running">;

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

      // Claim the oldest pending job (optionally of one action): lock it, mark running, return it.
      const claimNext = Effect.fn("db.claimNextAutomationJob")(function* (
        action: Option.Option<Domain.AutomationAction>,
      ) {
        return yield* database.transaction("claimNextAutomationJob", (tx) =>
          Effect.gen(function* () {
            const pending = yield* Client.attempt("claimNextAutomationJob", () =>
              Option.match(action, {
                onNone: () =>
                  tx
                    .select()
                    .from(DbSchema.automationJobs)
                    .where(eq(DbSchema.automationJobs.status, "pending"))
                    .orderBy(asc(DbSchema.automationJobs.createdAt))
                    .limit(1)
                    .for("update"),
                onSome: (wanted) =>
                  tx
                    .select()
                    .from(DbSchema.automationJobs)
                    .where(
                      and(
                        eq(DbSchema.automationJobs.status, "pending"),
                        eq(DbSchema.automationJobs.action, wanted),
                      ),
                    )
                    .orderBy(asc(DbSchema.automationJobs.createdAt))
                    .limit(1)
                    .for("update"),
              }),
            );
            const head = Arr.head(pending);
            if (Option.isNone(head)) {
              return Option.none<AutomationJobRow>();
            }
            const [row] = yield* Client.attempt("claimNextAutomationJob", () =>
              tx
                .update(DbSchema.automationJobs)
                .set({ status: "running", startedAt: sql`now()` })
                .where(eq(DbSchema.automationJobs.id, head.value.id))
                .returning(),
            );
            return Option.some(row);
          }),
        );
      });

      // Close a pending or running job with a terminal status. false when missing or already done.
      const finish = Effect.fn("db.finishAutomationJob")(function* (
        jobId: string,
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
                eq(DbSchema.automationJobs.id, jobId),
                inArray(DbSchema.automationJobs.status, ["pending", "running"]),
              ),
            )
            .returning({ id: DbSchema.automationJobs.id }),
        );
        return rows.length > 0;
      });

      const find = Effect.fn("db.findAutomationJob")(function* (jobId: string) {
        const rows = yield* database.run("findAutomationJob", (db) =>
          db.select().from(DbSchema.automationJobs).where(eq(DbSchema.automationJobs.id, jobId)),
        );
        return Arr.head(rows);
      });

      const listForResult = Effect.fn("db.listAutomationJobsForResult")(function* (
        resultId: string,
      ) {
        return yield* database.run("listAutomationJobsForResult", (db) =>
          db
            .select()
            .from(DbSchema.automationJobs)
            .where(eq(DbSchema.automationJobs.resultId, resultId))
            .orderBy(asc(DbSchema.automationJobs.createdAt)),
        );
      });

      return { enqueue, claimNext, finish, find, listForResult };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
