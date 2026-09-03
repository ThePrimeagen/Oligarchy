import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { eq, sql } from "drizzle-orm";
import { closeDatabase, connectDatabase } from "./db/ops.ts";
import { acquireLogColor, flushLogs, log } from "./db/log.ts";
import { agentRuns, testResults } from "./db/schema.ts";

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
    acquireLogColor(agent?.sessionId ?? input.agentId);
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
