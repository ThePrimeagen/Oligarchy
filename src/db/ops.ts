// The control-plane database interface. connectDatabase() turns DATABASE_URL
// (a PlanetScale Postgres url; the password rides inside it) into the one
// client every operation below takes as its first argument — no other file
// touches connection details.
//
// Write-only on purpose: recording happens here, reading belongs to replay
// tooling.

import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { actions, agentRuns, images, sessions } from "./schema.ts";

export type Db = NodePgDatabase;

/**
 * Builds the database client from DATABASE_URL. A server that cannot record
 * its sessions must not boot, so a missing url throws instead of degrading.
 */
export function connectDatabase(): Db {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("db: DATABASE_URL is not set");
  }
  return drizzle(url);
}

/** Creates the session row, before any boot work happens. */
export async function insertSession(db: Db, id: string, config: unknown, status: "downloading" | "running"): Promise<void> {
  await db.insert(sessions).values({ id, config, status });
}

/** Marks the session running once its QEMU is up. */
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

/**
 * One QMP exchange: the exact JSON sent to QEMU, whose execute field names
 * the command. Anything that exchanges nothing over QMP (a stop, a verdict)
 * is not an action — the session's status and reason are its record.
 */
export type Action = {
  sessionId: string;
  /** Absent when the request was not attributed to an agent (manual use). */
  agentId: string | undefined;
  request: QemuCommand;
};

/**
 * How the exchange ended — the only two states an action can finish in.
 * completed: the response is QEMU's exact reply. failed: the response is
 * QEMU's {error} reply, or this server's error message when the failure
 * never reached QEMU (a timeout, a dead socket).
 */
export type Outcome =
  | { state: "completed"; response: QemuGreetingResponse | QemuSuccessResponse }
  | { state: "failed"; response: QemuErrorResponse | string };

/**
 * Opens an action: one replay-log row per QMP exchange, inserted when the
 * command goes out. Returns the action's id — the auto-incrementing number
 * finishAction closes it by.
 */
export async function startAction(db: Db, action: Action): Promise<number> {
  const [row] = await db.insert(actions).values(action).returning({ id: actions.id });
  return row.id;
}

/**
 * Closes an action with its outcome and stamps finished_at. A completed
 * get-image passes its PNG, and the update and image insert land in one
 * transaction: images are 1:1 with their action, and a torn pair would
 * break that promise.
 */
export async function finishAction(db: Db, id: number, outcome: Outcome, image?: Buffer): Promise<void> {
  // The database clock stamps both ends: finished_at - created_at is real
  // handling time, not cross-clock arithmetic.
  const close = { state: outcome.state, response: outcome.response, finishedAt: sql`now()` };
  if (image === undefined) {
    await db.update(actions).set(close).where(eq(actions.id, id));
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(actions).set(close).where(eq(actions.id, id));
    await tx.insert(images).values({ actionId: id, data: image });
  });
}
