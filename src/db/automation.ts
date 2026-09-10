import { and, count, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type AutomationJobRow = typeof DbSchema.automationJobs.$inferSelect;
export type AutomationAction = AutomationJobRow["action"];
export type TerminalStatus = "succeeded" | "failed" | "aborted" | "timed_out";

export type EnqueueInput = {
  readonly resultId: string;
  readonly action: AutomationAction;
};

export class AutomationStore extends Context.Service<AutomationStore>()(
  "@oligarchy/db/AutomationStore",
  {
    make: Effect.gen(function* () {
      const database = yield* Client.Database;

      // Insert a pending job. A second open (result_id, action) is the unique index's DatabaseError.
      const enqueue = Effect.fn("db.enqueueAutomationJob")(function* (input: EnqueueInput) {
        const [row] = yield* database.run("enqueueAutomationJob", (db) =>
          db
            .insert(DbSchema.automationJobs)
            .values({ resultId: input.resultId, action: input.action, status: "pending" })
            .returning(),
        );
        return row;
      });

      // The oldest ready pending job, claimed in the same statement that finds it: two
      // dispatchers never run the same job. Ready is pending, and for a diagnose, a result
      // whose session has ended. Diagnoses go first.
      const claimNext = Effect.gen(function* () {
        const rows = yield* database.run("claimNext", (db) => {
          const next = db
            .select({ id: DbSchema.automationJobs.id })
            .from(DbSchema.automationJobs)
            .innerJoin(
              DbSchema.testResults,
              eq(DbSchema.testResults.id, DbSchema.automationJobs.resultId),
            )
            .leftJoin(DbSchema.sessions, eq(DbSchema.sessions.id, DbSchema.testResults.sessionId))
            .where(
              and(
                eq(DbSchema.automationJobs.status, "pending"),
                or(
                  eq(DbSchema.automationJobs.action, "drive"),
                  isNotNull(DbSchema.sessions.endedAt),
                ),
              ),
            )
            .orderBy(
              desc(sql`${DbSchema.automationJobs.action} = 'diagnose'`),
              DbSchema.automationJobs.createdAt,
            )
            .limit(1)
            .for("update", { of: DbSchema.automationJobs, skipLocked: true });
          return db
            .update(DbSchema.automationJobs)
            .set({ status: "running", startedAt: sql`now()` })
            .where(eq(DbSchema.automationJobs.id, next))
            .returning();
        });
        return Arr.head(rows);
      }).pipe(Effect.withSpan("db.claimNext"));

      const closeJob = Effect.fn("db.closeJob")(function* (
        id: string,
        status: TerminalStatus,
        reason: string | null,
      ) {
        const rows = yield* database.run("closeJob", (db) =>
          db
            .update(DbSchema.automationJobs)
            .set({ status, reason, finishedAt: sql`now()` })
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

      const countReady = Effect.gen(function* () {
        const rows = yield* database.run("countReady", (db) =>
          db
            .select({ n: count() })
            .from(DbSchema.automationJobs)
            .innerJoin(
              DbSchema.testResults,
              eq(DbSchema.testResults.id, DbSchema.automationJobs.resultId),
            )
            .leftJoin(DbSchema.sessions, eq(DbSchema.sessions.id, DbSchema.testResults.sessionId))
            .where(
              and(
                eq(DbSchema.automationJobs.status, "pending"),
                or(
                  eq(DbSchema.automationJobs.action, "drive"),
                  isNotNull(DbSchema.sessions.endedAt),
                ),
              ),
            ),
        );
        return rows[0]?.n ?? 0;
      }).pipe(Effect.withSpan("db.countReady"));

      const abortRunning = Effect.fn("db.abortRunning")(function* (reason: string) {
        const rows = yield* database.run("abortRunning", (db) =>
          db
            .update(DbSchema.automationJobs)
            .set({ status: "aborted", reason, finishedAt: sql`now()` })
            .where(eq(DbSchema.automationJobs.status, "running"))
            .returning({ id: DbSchema.automationJobs.id }),
        );
        return rows.length;
      });

      return { enqueue, claimNext, closeJob, abortRunning, countReady };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
