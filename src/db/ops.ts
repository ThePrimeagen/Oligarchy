// The control-plane database interface. connectDatabase() turns DATABASE_URL
// (a PlanetScale Postgres url; the password rides inside it) into the one
// client the proxy threads through every operation below as its first
// argument — no other file touches connection details.
//
// Write-only on purpose: the proxy records, replay tooling will read.

import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { actionKind, actions, agentRuns, images, sessions } from "./schema.ts";

export type Db = NodePgDatabase;
export type ActionKind = (typeof actionKind.enumValues)[number];

/**
 * Builds the database client from DATABASE_URL. A proxy that cannot record
 * its sessions must not boot, so a missing url throws instead of degrading.
 */
export function connectDatabase(): Db {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("db: DATABASE_URL is not set");
  }
  return drizzle(url);
}

/** Creates the session row at /start, before any boot work happens. */
export async function insertSession(db: Db, id: string, config: unknown, status: "downloading" | "running"): Promise<void> {
  await db.insert(sessions).values({ id, config, status });
}

/** Flips a session out of "downloading" once its QEMU is up. */
export async function sessionRunning(db: Db, id: string): Promise<void> {
  await db.update(sessions).set({ status: "running" }).where(eq(sessions.id, id));
}

/**
 * Closes a session with its verdict and stamps ended_at — on the session and
 * on every agent run still driving it. One transaction: a session cannot end
 * while its runs stay open.
 */
export async function endSession(db: Db, id: string, status: "succeeded" | "failed" | "aborted", reason: string | null): Promise<void> {
  // now() is transaction-start time in Postgres: the session and its runs
  // stamp the same instant, from the same clock that wrote started_at.
  const endedAt = sql`now()`;
  await db.transaction(async (tx) => {
    await tx.update(sessions).set({ status, reason, endedAt }).where(eq(sessions.id, id));
    await tx.update(agentRuns).set({ endedAt }).where(and(eq(agentRuns.sessionId, id), isNull(agentRuns.endedAt)));
  });
}

/**
 * Ties a cloud agent to the session it drives. The agent id is the primary
 * key, so an agent registering a second session is a database error — by
 * design, an agent drives exactly one session.
 */
export async function registerAgent(db: Db, agentId: string, sessionId: string): Promise<void> {
  await db.insert(agentRuns).values({ agentId, sessionId });
}

export type Action = {
  sessionId: string;
  /** Absent when the request was not attributed to an agent (manual use). */
  agentId: string | undefined;
  kind: ActionKind;
  /** The payload as received; the session id lives in its own column. */
  request: unknown;
};

/** What closed the action: the response on success, the error on failure. */
export type Outcome = {
  response: unknown;
  error: string | null;
};

/**
 * Opens an action: one replay-log row per control-plane request, inserted
 * when the request starts. Returns the action's id — the auto-incrementing
 * number finishAction closes it by.
 */
export async function startAction(db: Db, action: Action): Promise<number> {
  const [row] = await db.insert(actions).values(action).returning({ id: actions.id });
  return row.id;
}

/**
 * Closes an action with its outcome and stamps finished_at. A successful
 * get-image passes its PNG, and the update and image insert land in one
 * transaction: images are 1:1 with their action, and a torn pair would
 * break that promise.
 */
export async function finishAction(db: Db, id: number, outcome: Outcome, image?: Buffer): Promise<void> {
  // The database clock stamps both ends: finished_at - created_at is real
  // handling time, not cross-clock arithmetic.
  const finishedAt = sql`now()`;
  if (image === undefined) {
    await db.update(actions).set({ response: outcome.response, error: outcome.error, finishedAt }).where(eq(actions.id, id));
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(actions).set({ response: outcome.response, error: outcome.error, finishedAt }).where(eq(actions.id, id));
    await tx.insert(images).values({ actionId: id, data: image });
  });
}
