import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Option } from "effect";
import type * as Domain from "../shared/domain.ts";
import * as Client from "./client.ts";
import * as DbSchema from "./schema.ts";

export type SessionSummary = {
  readonly id: string;
  readonly status: Domain.SessionStatus;
  readonly startedAt: Date;
};

export class SessionStore extends Context.Service<SessionStore>()("@oligarchy/db/SessionStore", {
  make: Effect.gen(function* () {
    const database = yield* Client.Database;

    const insertSession = Effect.fn("db.insertSession")(function* (
      id: string,
      config: Domain.SessionConfig,
      status: Domain.SessionStartStatus,
    ) {
      yield* database.run("insertSession", (db) =>
        db.insert(DbSchema.sessions).values({ id, config: { ...config }, status }),
      );
    });

    const sessionRunning = Effect.fn("db.sessionRunning")(function* (id: string) {
      yield* database.run("sessionRunning", (db) =>
        db.update(DbSchema.sessions).set({ status: "running" }).where(eq(DbSchema.sessions.id, id)),
      );
    });

    // now() is transaction-start time in Postgres: the session and its runs stamp the same
    // instant, from the same clock that wrote started_at.
    const endSession = Effect.fn("db.endSession")(function* (
      id: string,
      status: Domain.SessionEndStatus,
      reason: string | null,
    ) {
      const endedAt = sql`now()`;
      yield* database.transaction("endSession", (tx) =>
        Effect.gen(function* () {
          yield* Client.attempt("endSession", () =>
            tx
              .update(DbSchema.sessions)
              .set({ status, reason, endedAt })
              .where(eq(DbSchema.sessions.id, id)),
          );
          yield* Client.attempt("endSession", () =>
            tx
              .update(DbSchema.agentRuns)
              .set({ endedAt })
              .where(and(eq(DbSchema.agentRuns.sessionId, id), isNull(DbSchema.agentRuns.endedAt))),
          );
        }),
      );
    });

    const getSessionStatus = Effect.fn("db.getSessionStatus")(function* (id: string) {
      const rows = yield* database.run("getSessionStatus", (db) =>
        db
          .select({ status: DbSchema.sessions.status })
          .from(DbSchema.sessions)
          .where(eq(DbSchema.sessions.id, id)),
      );
      return Option.map(Arr.head(rows), (row) => row.status);
    });

    // The canonical id from the row: Postgres matched however the caller cased it.
    const sessionExists = Effect.fn("db.sessionExists")(function* (id: string) {
      const rows = yield* database.run("sessionExists", (db) =>
        db
          .select({ id: DbSchema.sessions.id })
          .from(DbSchema.sessions)
          .where(eq(DbSchema.sessions.id, id)),
      );
      return Option.map(Arr.head(rows), (row) => row.id);
    });

    const registerAgent = Effect.fn("db.registerAgent")(function* (
      agentId: string,
      sessionId: string,
    ) {
      yield* database.run("registerAgent", (db) =>
        db.insert(DbSchema.agentRuns).values({ agentId, sessionId }),
      );
    });

    const sessionForAgent = Effect.fn("db.sessionForAgent")(function* (agentId: string) {
      const rows = yield* database.run("sessionForAgent", (db) =>
        db
          .select({ sessionId: DbSchema.agentRuns.sessionId })
          .from(DbSchema.agentRuns)
          .where(eq(DbSchema.agentRuns.agentId, agentId)),
      );
      return Option.map(Arr.head(rows), (row) => row.sessionId);
    });

    const listSessions = Effect.fn("db.listSessions")(function* (count: number, active: boolean) {
      const rows: ReadonlyArray<SessionSummary> = yield* database.run("listSessions", (db) => {
        const columns = {
          id: DbSchema.sessions.id,
          status: DbSchema.sessions.status,
          startedAt: DbSchema.sessions.startedAt,
        };
        return active
          ? db
              .select(columns)
              .from(DbSchema.sessions)
              .where(inArray(DbSchema.sessions.status, ["running", "downloading"]))
              .orderBy(
                desc(sql`${DbSchema.sessions.status} = ${"running"}`),
                desc(DbSchema.sessions.startedAt),
                desc(DbSchema.sessions.id),
              )
              .limit(count)
          : db
              .select(columns)
              .from(DbSchema.sessions)
              .orderBy(desc(DbSchema.sessions.startedAt), desc(DbSchema.sessions.id))
              .limit(count);
      });
      return rows;
    });

    return {
      insertSession,
      sessionRunning,
      endSession,
      getSessionStatus,
      sessionExists,
      registerAgent,
      sessionForAgent,
      listSessions,
    };
  }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
