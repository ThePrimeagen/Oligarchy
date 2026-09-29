import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/v1";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Answer } from "./answer.ts";

export type AutomationJobRow = typeof DbSchema.automationJobs.$inferSelect;

export type AutomationAction = AutomationJobRow["action"];

export type JobStatus = AutomationJobRow["status"];

export type FinishStatus = "succeeded" | "failed" | "aborted" | "completed" | "errored";

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
  readonly action: AutomationAction;
  readonly status: JobStatus;
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

export type EnqueueInput = {
  readonly resultId: string;
  readonly action: AutomationAction;
};

export type Automation = {
  readonly service: "automation";
  readonly enqueue: (input: EnqueueInput) => Answer<AutomationJobRow>;
  readonly nextPending: (except?: ReadonlyArray<string>) => Answer<AutomationJobRow | undefined>;
  readonly markRunning: (id: string, serverId: string) => Answer<boolean>;
  readonly hasPending: (resultId: string, action: AutomationAction) => Answer<boolean>;
  readonly jobStatus: (resultId: string, action: AutomationAction) => Answer<JobStatus | undefined>;
  readonly findRunning: (resultId: string) => Answer<AutomationJobRow | undefined>;
  readonly listRunning: () => Answer<ReadonlyArray<AutomationJobRow>>;
  readonly abortPending: (resultId: string, action: AutomationAction) => Answer<boolean>;
  readonly finish: (id: string, status: FinishStatus, reason: string | null) => Answer<boolean>;
  readonly listJobs: (count: number) => Answer<AutomationQueue>;
};

declare module "@oligarchy/app" {
  interface Services {
    automation: App.Register<"automation", Automation>;
  }
}

const COMPLETED = ["succeeded", "failed", "aborted", "timed_out", "completed", "errored"] as const;

// Queue order: every pending mint oldest first, then every pending diagnose, then every
// pending drive, each oldest first; id breaks a tie. A mint is the install a resume is
// waiting on, so it never waits behind that resume. A diagnose closes a result whose
// drive is done, so it never waits behind the drives queued before it.
const queueRank = sql`case ${DbSchema.automationJobs.action} when 'mint' then 0 when 'diagnose' then 1 else 2 end`;

const jobFor = (resultId: string, action: AutomationAction) =>
  and(eq(DbSchema.automationJobs.resultId, resultId), eq(DbSchema.automationJobs.action, action));

// The ticket is the driver's agent id, so agent_servers holds the server reserved for it
// until start, and agent_runs the session start opened, routed by session_servers; the
// reservation wins while both exist, being the newer placement.
const listed = (d: Db.Drizzle) => {
  const client = alias(DbSchema.servers, "client");
  return d
    .select({
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
    })
    .from(DbSchema.automationJobs)
    .innerJoin(DbSchema.testResults, eq(DbSchema.testResults.id, DbSchema.automationJobs.resultId))
    .innerJoin(
      DbSchema.testDefinitions,
      eq(DbSchema.testDefinitions.id, DbSchema.testResults.definitionId),
    )
    .leftJoin(client, eq(client.id, DbSchema.automationJobs.serverId))
    .leftJoin(
      DbSchema.agentServers,
      eq(DbSchema.agentServers.agentId, DbSchema.testResults.linearId),
    )
    .leftJoin(DbSchema.agentRuns, eq(DbSchema.agentRuns.agentId, DbSchema.testResults.linearId))
    .leftJoin(
      DbSchema.sessionServers,
      eq(DbSchema.sessionServers.sessionId, DbSchema.agentRuns.sessionId),
    );
};

export const create = (db: Db.Database): Automation => ({
  service: "automation",

  enqueue: (input) =>
    db.run(async (d) => {
      const [row] = await d
        .insert(DbSchema.automationJobs)
        .values({ resultId: input.resultId, action: input.action, status: "pending" })
        .returning();
      if (row === undefined) {
        throw new Error("enqueue: the insert returned no row");
      }
      return row;
    }),

  nextPending: (except = []) =>
    db.run(async (d) => {
      const running = await d
        .select({ resultId: DbSchema.automationJobs.resultId })
        .from(DbSchema.automationJobs)
        .where(eq(DbSchema.automationJobs.status, "running"));
      const busy = running.map((row) => row.resultId);
      const waiting = eq(DbSchema.automationJobs.status, "pending");
      const notBusy =
        busy.length === 0
          ? waiting
          : and(waiting, notInArray(DbSchema.automationJobs.resultId, busy));
      const where =
        except.length === 0
          ? notBusy
          : and(notBusy, notInArray(DbSchema.automationJobs.id, [...except]));
      const [row] = await d
        .select()
        .from(DbSchema.automationJobs)
        .where(where)
        .orderBy(queueRank, DbSchema.automationJobs.createdAt, DbSchema.automationJobs.id)
        .limit(1);
      return row;
    }),

  markRunning: (id, serverId) =>
    db.run(async (d) => {
      const rows = await d
        .update(DbSchema.automationJobs)
        .set({ status: "running", startedAt: sql`now()`, serverId })
        .where(
          and(eq(DbSchema.automationJobs.id, id), eq(DbSchema.automationJobs.status, "pending")),
        )
        .returning({ id: DbSchema.automationJobs.id });
      if (rows.length > 0) {
        return true;
      }
      const [row] = await d
        .select({
          status: DbSchema.automationJobs.status,
          serverId: DbSchema.automationJobs.serverId,
        })
        .from(DbSchema.automationJobs)
        .where(eq(DbSchema.automationJobs.id, id))
        .limit(1);
      return row?.status === "running" && row.serverId === serverId;
    }),

  hasPending: (resultId, action) =>
    db.run(async (d) => {
      const rows = await d
        .select({ id: DbSchema.automationJobs.id })
        .from(DbSchema.automationJobs)
        .where(and(jobFor(resultId, action), eq(DbSchema.automationJobs.status, "pending")))
        .limit(1);
      return rows.length > 0;
    }),

  jobStatus: (resultId, action) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ status: DbSchema.automationJobs.status })
        .from(DbSchema.automationJobs)
        .where(jobFor(resultId, action))
        .limit(1);
      return row?.status;
    }),

  findRunning: (resultId) =>
    db.run(async (d) => {
      const [row] = await d
        .select()
        .from(DbSchema.automationJobs)
        .where(
          and(
            eq(DbSchema.automationJobs.resultId, resultId),
            eq(DbSchema.automationJobs.status, "running"),
          ),
        )
        .limit(1);
      return row;
    }),

  listRunning: () =>
    db.run((d) =>
      d
        .select()
        .from(DbSchema.automationJobs)
        .where(eq(DbSchema.automationJobs.status, "running"))
        .orderBy(DbSchema.automationJobs.createdAt, DbSchema.automationJobs.id),
    ),

  abortPending: (resultId, action) =>
    db.run(async (d) => {
      const rows = await d
        .update(DbSchema.automationJobs)
        .set({ status: "aborted", reason: "aborted", finishedAt: sql`now()` })
        .where(and(jobFor(resultId, action), eq(DbSchema.automationJobs.status, "pending")))
        .returning({ id: DbSchema.automationJobs.id });
      return rows.length > 0;
    }),

  finish: (id, status, reason) =>
    db.run(async (d) => {
      const rows = await d
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
            inArray(DbSchema.automationJobs.status, ["pending", "running"]),
          ),
        )
        .returning({ id: DbSchema.automationJobs.id });
      if (rows.length > 0) {
        return true;
      }
      const [row] = await d
        .select({
          status: DbSchema.automationJobs.status,
          reason: DbSchema.automationJobs.reason,
        })
        .from(DbSchema.automationJobs)
        .where(eq(DbSchema.automationJobs.id, id))
        .limit(1);
      return row?.status === status && (reason === null || row.reason === reason);
    }),

  listJobs: (count) =>
    db.run(async (d) => ({
      running: await listed(d)
        .where(eq(DbSchema.automationJobs.status, "running"))
        .orderBy(queueRank, DbSchema.automationJobs.createdAt),
      pending: await listed(d)
        .where(eq(DbSchema.automationJobs.status, "pending"))
        .orderBy(queueRank, DbSchema.automationJobs.createdAt),
      completed: await listed(d)
        .where(inArray(DbSchema.automationJobs.status, COMPLETED))
        .orderBy(desc(DbSchema.automationJobs.finishedAt))
        .limit(count),
    })),
});
