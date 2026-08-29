// The control-plane database interface. connectDatabase() turns DATABASE_URL
// (a PlanetScale Postgres url; the password rides inside it) into the one
// client the proxy threads through every operation below as its first
// argument — no other file touches connection details.
//
// Write-only on purpose: the proxy records, replay tooling will read.

import { and, eq, isNull } from "drizzle-orm";
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
  const endedAt = new Date();
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
  /** null when the request succeeded; otherwise the error message returned. */
  error: string | null;
  durationMs: number;
};

/** Appends one control-plane request to the replay log; returns the action id. */
export async function recordAction(db: Db, action: Action): Promise<number> {
  const [row] = await db.insert(actions).values(action).returning({ id: actions.id });
  return row.id;
}

/** Stores the PNG a get-image returned, 1:1 with its action row. */
export async function recordImage(db: Db, actionId: number, data: Buffer): Promise<void> {
  await db.insert(images).values({ actionId, data });
}
