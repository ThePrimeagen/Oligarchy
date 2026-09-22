import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Array as Arr, Context, Effect, Layer, Option } from "effect";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type AutomationJobRow = typeof DbSchema.automationJobs.$inferSelect;
export type AutomationAction = AutomationJobRow["action"];
export type FinishStatus = "succeeded" | "failed" | "aborted";

// One job with the ticket and test it is for, its three stamps, the reason it closed with, where
// it runs, and the database's clock at the read, so an age is measured against the clock that
// wrote the stamp. ticket is null for a result nobody has ticketed; started_at and finished_at
// are null until the job reaches that point; reason is null until a close writes one. clientUrl
// is the automation client that took the job, null while it waits or once that client's row is
// gone. serverUrl is the qemu server a drive's guest is on: the one its ticket is reserved on,
// then the one its session was routed to; null while a drive is placed nowhere, and always for
// a diagnose, which runs no guest. instruction is the wording the result was
// created against, not a newer definition of the same name. intent is the open
// `intent start; <message>` of that session, or null once it ends or when there
// is no session.
export type AutomationJobListRow = {
  readonly ticket: string | null;
  readonly test: string;
  readonly action: AutomationJobRow["action"];
  readonly status: AutomationJobRow["status"];
  readonly reason: string | null;
  readonly clientUrl: string | null;
  readonly serverUrl: string | null;
  readonly sessionId: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly queriedAt: Date;
  readonly instruction: string;
  readonly intent: string | null;
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

      // Queue order: every pending mint oldest first, then every pending diagnose, then every
      // pending drive, each oldest first; id breaks a tie. A mint is the install a resume is
      // waiting on, so it never waits behind that resume. A diagnose closes a result whose
      // drive is done, so it never waits behind the drives queued before it.
      const queueRank = sql`case ${DbSchema.automationJobs.action} when 'mint' then 0 when 'diagnose' then 1 else 2 end`;

      // First in queue order whose result is not already running, locked for the
      // transaction so a second claimer waits. One running job per result: drive
      // and diagnose share a ticket, and the client will not reserve it twice.
      // serverId is the client that took it: /abort looks that server up for its url.
      const claim = Effect.fn("db.claimAutomationJob")(function* (
        serverId: string,
        except: ReadonlyArray<string> = [],
      ) {
        return yield* database.transaction("claimAutomationJob", (tx) =>
          Effect.gen(function* () {
            const running = yield* Client.attempt("claimAutomationJob", () =>
              tx
                .select({ resultId: DbSchema.automationJobs.resultId })
                .from(DbSchema.automationJobs)
                .where(eq(DbSchema.automationJobs.status, "running")),
            );
            const busy = running.map((row) => row.resultId);
            const waiting = eq(DbSchema.automationJobs.status, "pending");
            const notBusy =
              busy.length === 0
                ? waiting
                : and(waiting, notInArray(DbSchema.automationJobs.resultId, busy));
            const skipped = [...except];
            const where =
              skipped.length === 0
                ? notBusy
                : and(notBusy, notInArray(DbSchema.automationJobs.id, skipped));
            const pending = yield* Client.attempt("claimAutomationJob", () =>
              tx
                .select()
                .from(DbSchema.automationJobs)
                .where(where)
                .orderBy(queueRank, DbSchema.automationJobs.createdAt, DbSchema.automationJobs.id)
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

      // The row the Automation Needed watch must not insert over: a pending job is the
      // queue entry, waiting for claim. A running or finished row is not that wait.
      const hasPending = Effect.fn("db.hasPendingAutomationJob")(function* (
        resultId: string,
        action: AutomationAction,
      ) {
        const rows = yield* database.run("hasPendingAutomationJob", (db) =>
          db
            .select({ id: DbSchema.automationJobs.id })
            .from(DbSchema.automationJobs)
            .where(
              and(
                eq(DbSchema.automationJobs.resultId, resultId),
                eq(DbSchema.automationJobs.action, action),
                eq(DbSchema.automationJobs.status, "pending"),
              ),
            )
            .limit(1),
        );
        return rows.length > 0;
      });

      // The row the unique index kept. The watch names that status when a second insert loses.
      const jobStatus = Effect.fn("db.automationJobStatus")(function* (
        resultId: string,
        action: AutomationAction,
      ) {
        const rows = yield* database.run("automationJobStatus", (db) =>
          db
            .select({ status: DbSchema.automationJobs.status })
            .from(DbSchema.automationJobs)
            .where(
              and(
                eq(DbSchema.automationJobs.resultId, resultId),
                eq(DbSchema.automationJobs.action, action),
              ),
            )
            .limit(1),
        );
        return Option.map(Arr.head(rows), (row) => row.status);
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

      // A pending job has no client to stop: closing its row is its whole abort, and the next
      // claim no longer finds it. The status in the condition is what keeps a claim in flight
      // honest: the claim locks the pending row it takes, so this update waits and then finds
      // it running, or lands first and the claim never sees it. A row that is running or over
      // is left alone, and the false says so. (result_id, action) is unique, so one row at most.
      const abortPending = Effect.fn("db.abortPendingAutomationJob")(function* (
        resultId: string,
        action: AutomationAction,
      ) {
        const rows = yield* database.run("abortPendingAutomationJob", (db) =>
          db
            .update(DbSchema.automationJobs)
            .set({ status: "aborted", reason: "aborted", finishedAt: sql`now()` })
            .where(
              and(
                eq(DbSchema.automationJobs.resultId, resultId),
                eq(DbSchema.automationJobs.action, action),
                eq(DbSchema.automationJobs.status, "pending"),
              ),
            )
            .returning({ id: DbSchema.automationJobs.id }),
        );
        return rows.length > 0;
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

      // Running and pending are the whole live queue in queue order (mint, then diagnose, then
      // drive, then created_at). Completed is every terminal status, newest finished first, cut at count.
      // The ticket is the driver's agent id, so agent_servers holds the server reserved for it
      // until start, and agent_runs the session start opened, routed by session_servers; the
      // reservation wins while both exist, being the newer placement.
      const listJobs = Effect.fn("db.listAutomationJobs")(function* (count: number) {
        const client = alias(DbSchema.servers, "client");
        const columns = {
          ticket: DbSchema.testResults.linearId,
          test: DbSchema.testDefinitions.name,
          action: DbSchema.automationJobs.action,
          status: DbSchema.automationJobs.status,
          reason: DbSchema.automationJobs.reason,
          clientUrl: client.url,
          serverUrl: sql<
            string | null
          >`case when ${DbSchema.automationJobs.action} in (${"drive"}, ${"mint"}) then coalesce(${DbSchema.agentServers.serverUrl}, ${DbSchema.sessionServers.serverUrl}) end`,
          sessionId: DbSchema.agentRuns.sessionId,
          createdAt: DbSchema.automationJobs.createdAt,
          startedAt: DbSchema.automationJobs.startedAt,
          finishedAt: DbSchema.automationJobs.finishedAt,
          queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(DbSchema.automationJobs.createdAt),
          instruction: DbSchema.testDefinitions.instruction,
          // Newest intent line for this session. A later log that is not an intent
          // does not close it; `intent end`, or no session, leaves this null.
          intent: sql<string | null>`(
            select case
              when ${DbSchema.logs.text} like ${"intent start; %"}
                then substr(${DbSchema.logs.text}, length(${"intent start; "}) + 1)
              else null
            end
            from ${DbSchema.logs}
            where ${DbSchema.logs.location} = ${DbSchema.agentRuns.sessionId}::text
              and (
                ${DbSchema.logs.text} like ${"intent start; %"}
                or ${DbSchema.logs.text} = ${"intent end"}
              )
            order by ${DbSchema.logs.id} desc
            limit 1
          )`,
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
            )
            .leftJoin(client, eq(client.id, DbSchema.automationJobs.serverId))
            .leftJoin(
              DbSchema.agentServers,
              eq(DbSchema.agentServers.agentId, DbSchema.testResults.linearId),
            )
            .leftJoin(
              DbSchema.agentRuns,
              eq(DbSchema.agentRuns.agentId, DbSchema.testResults.linearId),
            )
            .leftJoin(
              DbSchema.sessionServers,
              eq(DbSchema.sessionServers.sessionId, DbSchema.agentRuns.sessionId),
            );
        const running: ReadonlyArray<AutomationJobListRow> = yield* database.run(
          "listAutomationJobs",
          (db) =>
            jobs(db)
              .where(eq(DbSchema.automationJobs.status, "running"))
              .orderBy(queueRank, DbSchema.automationJobs.createdAt),
        );
        const pending: ReadonlyArray<AutomationJobListRow> = yield* database.run(
          "listAutomationJobs",
          (db) =>
            jobs(db)
              .where(eq(DbSchema.automationJobs.status, "pending"))
              .orderBy(queueRank, DbSchema.automationJobs.createdAt),
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

      return {
        enqueue,
        claim,
        hasPending,
        jobStatus,
        findRunning,
        abortPending,
        unclaim,
        assign,
        finish,
        listJobs,
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
