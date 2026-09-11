import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Option } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type AutomationJobRow = typeof DbSchema.automationJobs.$inferSelect;
export type AutomationAction = AutomationJobRow["action"];
export type FinishStatus = "succeeded" | "failed" | "aborted";

export type AutomationJobListRow = {
  readonly ticket: string | null;
  readonly test: string;
  readonly action: AutomationJobRow["action"];
  readonly status: AutomationJobRow["status"];
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
};

export type AutomationQueue = {
  readonly running: ReadonlyArray<AutomationJobListRow>;
  readonly pending: ReadonlyArray<AutomationJobListRow>;
  readonly completed: ReadonlyArray<AutomationJobListRow>;
};

const COMPLETED = ["succeeded", "failed", "aborted", "timed_out"] as const;

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

      // Running and pending are the whole live queue, diagnoses first then created_at.
      // Completed is every terminal status, newest finished first, cut at count.
      const listJobs = Effect.fn("db.listAutomationJobs")(function* (count: number) {
        const columns = {
          ticket: DbSchema.testResults.linearId,
          test: DbSchema.testDefinitions.name,
          action: DbSchema.automationJobs.action,
          status: DbSchema.automationJobs.status,
          createdAt: DbSchema.automationJobs.createdAt,
          startedAt: DbSchema.automationJobs.startedAt,
          finishedAt: DbSchema.automationJobs.finishedAt,
        };
        const diagnosesFirst = desc(sql`${DbSchema.automationJobs.action} = ${"diagnose"}`);
        const jobs = (db: Client.Db) =>
          db
            .select(columns)
            .from(DbSchema.automationJobs)
            .innerJoin(
              DbSchema.testResults,
              eq(DbSchema.testResults.id, DbSchema.automationJobs.resultId),
            )
            .innerJoin(
              DbSchema.testDefinitions,
              eq(DbSchema.testDefinitions.id, DbSchema.testResults.definitionId),
            );
        const running: ReadonlyArray<AutomationJobListRow> = yield* database.run(
          "listAutomationJobs",
          (db) =>
            jobs(db)
              .where(eq(DbSchema.automationJobs.status, "running"))
              .orderBy(diagnosesFirst, DbSchema.automationJobs.createdAt),
        );
        const pending: ReadonlyArray<AutomationJobListRow> = yield* database.run(
          "listAutomationJobs",
          (db) =>
            jobs(db)
              .where(eq(DbSchema.automationJobs.status, "pending"))
              .orderBy(diagnosesFirst, DbSchema.automationJobs.createdAt),
        );
        const completed: ReadonlyArray<AutomationJobListRow> = yield* database.run(
          "listAutomationJobs",
          (db) =>
            jobs(db)
              .where(inArray(DbSchema.automationJobs.status, COMPLETED))
              .orderBy(desc(DbSchema.automationJobs.finishedAt))
              .limit(count),
        );
        return { running, pending, completed };
      });

      return { enqueue, claim, finish, listJobs };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
