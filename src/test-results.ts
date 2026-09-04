import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { and, eq, sql } from "drizzle-orm";
import { closeDatabase, connectDatabase } from "./db/ops.ts";
import { acquireAgentColor, flushLogs, log } from "./db/log.ts";
import { agentRuns, sessions, testResults } from "./db/schema.ts";

export async function startTestResult(input: { id: string; sessionId: string }): Promise<void> {
  if (existsSync(".env")) {
    loadEnvFile();
  }

  const db = connectDatabase();
  try {
    const [session] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, input.sessionId));
    if (session === undefined) {
      throw new Error(`test start: no session ${input.sessionId}`);
    }
    const [row] = await db
      .update(testResults)
      .set({ sessionId: input.sessionId, status: "running" })
      .where(and(eq(testResults.id, input.id), eq(testResults.status, "pending")))
      .returning({ id: testResults.id });
    if (row === undefined) {
      throw new Error(`test start: result ${input.id} not found or not pending`);
    }
    log(db, {
      text: `test result ${input.id}: running; session ${input.sessionId}`,
      sessionId: input.sessionId,
    });
  } finally {
    await flushLogs();
    await closeDatabase(db);
  }
}

export async function runTestResults(input: {
  id: string;
  agentId: string;
  status: "passed" | "failed";
  reason?: string;
}): Promise<void> {
  if (existsSync(".env")) {
    loadEnvFile();
  }

  const db = connectDatabase();
  try {
    const [agent] = await db
      .select({ sessionId: agentRuns.sessionId })
      .from(agentRuns)
      .where(eq(agentRuns.agentId, input.agentId));
    const [row] = await db
      .update(testResults)
      .set({
        status: input.status,
        reason: input.reason,
        sessionId: agent?.sessionId,
        finishedAt: sql`now()`,
      })
      .where(eq(testResults.id, input.id))
      .returning({ id: testResults.id });
    if (row === undefined) {
      throw new Error(`test-results: result ${input.id} not found`);
    }
    acquireAgentColor(input.agentId);
    log(db, {
      text: `test result ${input.id}: ${input.status}${input.reason === undefined ? "" : `; ${input.reason}`}`,
      agentId: input.agentId,
      sessionId: agent?.sessionId,
    });
  } finally {
    await flushLogs();
    await closeDatabase(db);
  }
}
