import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type * as jarl from "jarl";

export type SessionStatus = (typeof DbSchema.sessionStatus.enumValues)[number];

export type SessionStartStatus = Extract<SessionStatus, "downloading" | "running">;

export type SessionEndStatus = Exclude<SessionStatus, SessionStartStatus>;

export type SessionRow = typeof DbSchema.sessions.$inferSelect;

export type SessionSummary = {
  readonly id: string;
  readonly status: SessionStatus;
  readonly startedAt: Date;
};

type Answer<T> = Promise<jarl.Result<T, Db.DatabaseError>>;

export type Sessions = {
  readonly service: "sessions";
  readonly insertSession: (
    id: string,
    config: DbSchema.SessionConfig,
    status: SessionStartStatus,
  ) => Answer<void>;
  readonly sessionRunning: (id: string) => Answer<void>;
  readonly endSession: (
    id: string,
    status: SessionEndStatus,
    reason: string | null,
  ) => Answer<void>;
  readonly failRoutedSessions: (serverUrl: string, reason: string) => Answer<ReadonlyArray<string>>;
  readonly getSessionStatus: (id: string) => Answer<SessionStatus | undefined>;
  readonly getSession: (id: string) => Answer<SessionRow | undefined>;
  readonly sessionExists: (id: string) => Answer<string | undefined>;
  readonly registerAgent: (agentId: string, sessionId: string) => Answer<void>;
  readonly sessionForAgent: (agentId: string) => Answer<string | undefined>;
  readonly listSessions: (count: number, active: boolean) => Answer<ReadonlyArray<SessionSummary>>;
};

declare module "@oligarchy/app" {
  interface Services {
    sessions: App.Register<"sessions", Sessions>;
  }
}

const summary = {
  id: DbSchema.sessions.id,
  status: DbSchema.sessions.status,
  startedAt: DbSchema.sessions.startedAt,
};

export const create = (db: Db.Database): Sessions => ({
  service: "sessions",

  insertSession: (id, config, status) =>
    db.run(async (d) => {
      await d.insert(DbSchema.sessions).values({ id, config, status });
    }),

  sessionRunning: (id) =>
    db.run(async (d) => {
      await d
        .update(DbSchema.sessions)
        .set({ status: "running" })
        .where(eq(DbSchema.sessions.id, id));
    }),

  endSession: (id, status, reason) =>
    db.run((d) =>
      d.transaction(async (tx) => {
        const endedAt = sql`now()`;
        await tx
          .update(DbSchema.sessions)
          .set({ status, reason, endedAt })
          .where(eq(DbSchema.sessions.id, id));
        await tx
          .update(DbSchema.agentRuns)
          .set({ endedAt })
          .where(and(eq(DbSchema.agentRuns.sessionId, id), isNull(DbSchema.agentRuns.endedAt)));
      }),
    ),

  failRoutedSessions: (serverUrl, reason) =>
    db.run((d) =>
      d.transaction(async (tx) => {
        const endedAt = sql`now()`;
        const failed = await tx
          .update(DbSchema.sessions)
          .set({ status: "errored", reason, endedAt })
          .where(
            and(
              inArray(DbSchema.sessions.status, ["downloading", "running"]),
              inArray(
                DbSchema.sessions.id,
                tx
                  .select({ id: DbSchema.sessionServers.sessionId })
                  .from(DbSchema.sessionServers)
                  .where(eq(DbSchema.sessionServers.serverUrl, serverUrl)),
              ),
            ),
          )
          .returning({ id: DbSchema.sessions.id });
        const ids = failed.map((row) => row.id);
        if (ids.length > 0) {
          await tx
            .update(DbSchema.agentRuns)
            .set({ endedAt })
            .where(
              and(inArray(DbSchema.agentRuns.sessionId, ids), isNull(DbSchema.agentRuns.endedAt)),
            );
        }
        return ids;
      }),
    ),

  getSessionStatus: (id) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ status: DbSchema.sessions.status })
        .from(DbSchema.sessions)
        .where(eq(DbSchema.sessions.id, id));
      return row?.status;
    }),

  getSession: (id) =>
    db.run(async (d) => {
      const [row] = await d.select().from(DbSchema.sessions).where(eq(DbSchema.sessions.id, id));
      return row;
    }),

  sessionExists: (id) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ id: DbSchema.sessions.id })
        .from(DbSchema.sessions)
        .where(eq(DbSchema.sessions.id, id));
      return row?.id;
    }),

  registerAgent: (agentId, sessionId) =>
    db.run(async (d) => {
      await d.insert(DbSchema.agentRuns).values({ agentId, sessionId });
    }),

  sessionForAgent: (agentId) =>
    db.run(async (d) => {
      const [row] = await d
        .select({ sessionId: DbSchema.agentRuns.sessionId })
        .from(DbSchema.agentRuns)
        .where(eq(DbSchema.agentRuns.agentId, agentId));
      return row?.sessionId;
    }),

  listSessions: (count, active) =>
    db.run((d) =>
      active
        ? d
            .select(summary)
            .from(DbSchema.sessions)
            .where(inArray(DbSchema.sessions.status, ["running", "downloading"]))
            .orderBy(
              desc(sql`${DbSchema.sessions.status} = ${"running"}`),
              desc(DbSchema.sessions.startedAt),
              desc(DbSchema.sessions.id),
            )
            .limit(count)
        : d
            .select(summary)
            .from(DbSchema.sessions)
            .orderBy(desc(DbSchema.sessions.startedAt), desc(DbSchema.sessions.id))
            .limit(count),
    ),
});
