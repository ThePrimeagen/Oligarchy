import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Option } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type AutomationJobRow = typeof DbSchema.automationJobs.$inferSelect;
export type AutomationAction = AutomationJobRow["action"];
export type FinishStatus = "succeeded" | "failed" | "aborted";

// One job with the ticket and test it is for, its three stamps, the reason it closed with, and
// the database's clock at the read, so an age is measured against the clock that wrote the
// stamp. ticket is null for a result nobody has ticketed; started_at and finished_at are null
// until the job reaches that point; reason is null until a close writes one.
export type AutomationJobListRow = {
  readonly ticket: string | null;
  readonly test: string;
  readonly action: AutomationJobRow["action"];
  readonly status: AutomationJobRow["status"];
  readonly reason: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly queriedAt: Date;
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

      // Queue order: every pending diagnose oldest first, then every pending drive oldest
      // first; id breaks a tie. A diagnose closes a result whose drive is done, so it never
      // waits behind the drives queued before it. The dashboard lists the queue the same way.
      const diagnosesFirst = desc(sql`${DbSchema.automationJobs.action} = ${"diagnose"}`);

      // First in queue order whose result is not already running, locked for the
      // transaction so a second claimer waits. One running job per result: drive
      // and diagnose share a ticket, and the client will not reserve it twice.
      // serverId is the client that took it: /abort looks that server up for its url.
      const claim = Effect.fn("db.claimAutomationJob")(function* (serverId: string) {
        return yield* database.transaction("claimAutomationJob", (tx) =>
          Effect.gen(function* () {
            const running = yield* Client.attempt("claimAutomationJob", () =>
              tx
                .select({ resultId: DbSchema.automationJobs.resultId })
                .from(DbSchema.automationJobs)
                .where(eq(DbSchema.automationJobs.status, "running")),
            );
            const busy = running.map((row) => row.resultId);
            const pending = yield* Client.attempt("claimAutomationJob", () =>
              tx
                .select()
                .from(DbSchema.automationJobs)
                .where(
                  busy.length === 0
                    ? eq(DbSchema.automationJobs.status, "pending")
                    : and(
                        eq(DbSchema.automationJobs.status, "pending"),
                        notInArray(DbSchema.automationJobs.resultId, busy),
                      ),
                )
                .orderBy(
                  diagnosesFirst,
                  DbSchema.automationJobs.createdAt,
                  DbSchema.automationJobs.id,
                )
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
                .set({ status: "running", startedAt: sql`now()`, serverId })
                .where(eq(DbSchema.automationJobs.id, row.value.id))
                .returning(),
            );
            return Arr.head(updated);
          }),
        );
      });

      const findRunning = Effect.fn("db.findRunningAutomationJob")(function* (resultId: string) {
        const rows = yield* database.run("findRunningAutomationJob", (db) =>
          db
            .select()
            .from(DbSchema.automationJobs)
            .where(
              and(
                eq(DbSchema.automationJobs.resultId, resultId),
                eq(DbSchema.automationJobs.status, "running"),
              ),
            )
            .limit(1),
        );
        return Arr.head(rows);
      });

      // Only a running row closes. reason is omitted when null so a previous value stays.
      // A running row the fleet could not take: back to pending, as it was, so its place in
      // the queue (created_at) is unchanged and the next tick can try again.
      const unclaim = Effect.fn("db.unclaimAutomationJob")(function* (id: string) {
        const rows = yield* database.run("unclaimAutomationJob", (db) =>
          db
            .update(DbSchema.automationJobs)
            .set({ status: "pending", startedAt: null, serverId: null })
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

      const assign = Effect.fn("db.assignAutomationJob")(function* (id: string, serverId: string) {
        yield* database.run("assignAutomationJob", (db) =>
          db
            .update(DbSchema.automationJobs)
            .set({ serverId })
            .where(
              and(
                eq(DbSchema.automationJobs.id, id),
                eq(DbSchema.automationJobs.status, "running"),
              ),
            ),
        );
      });

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

      // Running and pending are the whole live queue in queue order (diagnoses first, then
      // created_at). Completed is every terminal status, newest finished first, cut at count.
      const listJobs = Effect.fn("db.listAutomationJobs")(function* (count: number) {
        const columns = {
          ticket: DbSchema.testResults.linearId,
          test: DbSchema.testDefinitions.name,
          action: DbSchema.automationJobs.action,
          status: DbSchema.automationJobs.status,
          reason: DbSchema.automationJobs.reason,
          createdAt: DbSchema.automationJobs.createdAt,
          startedAt: DbSchema.automationJobs.startedAt,
          finishedAt: DbSchema.automationJobs.finishedAt,
          queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(DbSchema.automationJobs.createdAt),
        };
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

      return { enqueue, claim, findRunning, unclaim, assign, finish, listJobs };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
