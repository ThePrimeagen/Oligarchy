import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { eq } from "drizzle-orm";
import { closeDatabase, connectDatabase } from "./db/ops.ts";
import { actions, logs, sessions, testDefinitions, testResults } from "./db/schema.ts";

export async function getSession(
  sessionId: string,
  query: { logs: boolean; testDef: boolean; testResults: boolean; actions: boolean },
): Promise<void> {
  if (existsSync(".env")) {
    loadEnvFile();
  }

  const db = connectDatabase();
  try {
    const [session] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId));
    if (session === undefined) {
      throw new Error(`session: no session ${sessionId}`);
    }

    const out: {
      logs?: (typeof logs.$inferSelect)[];
      results?: typeof testResults.$inferSelect | null;
      test_definition?: typeof testDefinitions.$inferSelect | null;
      actions?: (typeof actions.$inferSelect)[];
    } = {};

    if (query.logs) {
      out.logs = await db.select().from(logs).where(eq(logs.sessionId, sessionId)).orderBy(logs.createdAt, logs.id);
    }
    if (query.testResults || query.testDef) {
      const rows = await db
        .select({
          result: testResults,
          definition: testDefinitions,
        })
        .from(testResults)
        .innerJoin(testDefinitions, eq(testResults.definitionId, testDefinitions.id))
        .where(eq(testResults.sessionId, sessionId));
      if (rows.length > 1) {
        throw new Error(`session: multiple test results for ${sessionId}`);
      }
      const row = rows[0];
      if (query.testResults) {
        out.results = row?.result ?? null;
      }
      if (query.testDef) {
        out.test_definition = row?.definition ?? null;
      }
    }
    if (query.actions) {
      out.actions = await db
        .select()
        .from(actions)
        .where(eq(actions.sessionId, sessionId))
        .orderBy(actions.createdAt, actions.id);
    }

    const values = [out.logs, out.results, out.test_definition, out.actions].filter((value) => value !== undefined);
    console.log(JSON.stringify(values.length === 1 ? values[0] : out));
  } finally {
    await closeDatabase(db);
  }
}
