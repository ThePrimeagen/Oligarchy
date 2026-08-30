import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { actions, agentRuns, images, sessions, type SessionConfig } from "./schema.ts";

export type Db = NodePgDatabase;

export function connectDatabase(): Db {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("db: DATABASE_URL is not set");
  }
  // canParse instead of letting new URL throw: that TypeError carries the url —
  // password included — into the logs.
  if (!URL.canParse(url)) {
    throw new Error("db: DATABASE_URL is not a valid url");
  }
  // PlanetScale urls carry sslrootcert=system — libpq 16's "verify against the system
  // trust store". node-postgres reads sslrootcert as a literal file path, so the first
  // query dies with ENOENT (node-postgres#3101). Node's default TLS verification
  // already is the system trust store, so dropping the parameter keeps the url's exact
  // semantics; the sslmode=verify-full beside it stays.
  const parsed = new URL(url);
  if (parsed.searchParams.get("sslrootcert") === "system") {
    parsed.searchParams.delete("sslrootcert");
    return drizzle(parsed.toString());
  }
  return drizzle(url);
}

export async function insertSession(db: Db, id: string, config: SessionConfig, status: SessionStartStatus): Promise<void> {
  await db.insert(sessions).values({ id, config, status });
}

export async function sessionRunning(db: Db, id: string): Promise<void> {
  await db.update(sessions).set({ status: "running" }).where(eq(sessions.id, id));
}

export async function endSession(
  db: Db,
  id: string,
  status: SessionEndStatus,
  reason: string | null,
): Promise<void> {
  // now() is transaction-start time in Postgres: the session and its runs stamp the
  // same instant, from the same clock that wrote started_at.
  const endedAt = sql`now()`;
  await db.transaction(async (tx) => {
    await tx.update(sessions).set({ status, reason, endedAt }).where(eq(sessions.id, id));
    await tx.update(agentRuns).set({ endedAt }).where(and(eq(agentRuns.sessionId, id), isNull(agentRuns.endedAt)));
  });
}

export async function registerAgent(db: Db, agentId: string, sessionId: string): Promise<void> {
  await db.insert(agentRuns).values({ agentId, sessionId });
}

export type Action = {
  sessionId: string;
  agentId: string;
  request: QemuCommand;
};

export type Outcome =
  | { state: "completed"; response: QemuGreetingResponse | QemuSuccessResponse }
  | { state: "failed"; response: QemuErrorResponse | string };

export async function startAction(db: Db, action: Action): Promise<number> {
  const [row] = await db.insert(actions).values(action).returning({ id: actions.id });
  return row.id;
}

export async function finishAction(db: Db, id: number, outcome: Outcome, image?: Buffer): Promise<void> {
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
