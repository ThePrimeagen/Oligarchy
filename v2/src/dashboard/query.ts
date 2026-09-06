import { desc, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import {
  actions,
  images,
  sessions,
  testBasePrompts,
  testDefinitions,
  testResults,
  testRuns,
} from "../db/schema.ts";

export type Session = typeof sessions.$inferSelect & {
  imageId: string | null;
  queriedAt: Date;
  definitionName: string | null;
  model: string | null;
};

export type TestDefinition = typeof testDefinitions.$inferSelect;
export type TestBasePrompt = typeof testBasePrompts.$inferSelect;

export type DefinitionStat = {
  readonly name: string;
  readonly succeeded: number;
  readonly failed: number;
  readonly other: number;
  readonly models: ReadonlyArray<string>;
};

// One connection per call, ended whether the query returned, threw, or never connected;
// a client left open holds a Hyperdrive connection for the rest of the request.
async function withDatabase<T>(
  connectionString: string,
  run: (db: NodePgDatabase) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return await run(drizzle(client));
  } finally {
    await client.end();
  }
}

export function definitionStats(rows: ReadonlyArray<Session>): DefinitionStat[] {
  const byName = new Map<
    string,
    { succeeded: number; failed: number; other: number; models: Set<string> }
  >();
  for (const session of rows) {
    if (session.definitionName === null) {
      continue;
    }
    const current = byName.get(session.definitionName) ?? {
      succeeded: 0,
      failed: 0,
      other: 0,
      models: new Set<string>(),
    };
    if (session.status === "succeeded") {
      current.succeeded += 1;
    } else if (session.status === "failed") {
      current.failed += 1;
    } else {
      current.other += 1;
    }
    if (session.model !== null) {
      current.models.add(session.model);
    }
    byName.set(session.definitionName, current);
  }
  return [...byName.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, current]) => ({
      name,
      succeeded: current.succeeded,
      failed: current.failed,
      other: current.other,
      models: [...current.models].sort(),
    }));
}

export function listSessions(connectionString: string): Promise<Session[]> {
  return withDatabase(connectionString, (db) => {
    const recentSessions = db
      .select({
        id: sessions.id,
        config: sessions.config,
        status: sessions.status,
        reason: sessions.reason,
        startedAt: sessions.startedAt,
        endedAt: sessions.endedAt,
      })
      .from(sessions)
      .orderBy(desc(sessions.startedAt))
      .limit(50)
      .as("recent_sessions");
    const latestImage = db
      .select({ id: images.id })
      .from(images)
      .innerJoin(actions, eq(actions.id, images.actionId))
      .where(eq(actions.sessionId, recentSessions.id))
      .orderBy(desc(actions.id))
      .limit(1)
      .as("latest_image");
    const linkedTest = db
      .select({
        definitionName: testDefinitions.name,
        model: testRuns.model,
      })
      .from(testResults)
      .innerJoin(testDefinitions, eq(testDefinitions.id, testResults.definitionId))
      .innerJoin(testRuns, eq(testRuns.id, testResults.runId))
      .where(eq(testResults.sessionId, recentSessions.id))
      .limit(1)
      .as("linked_test");

    // The database timestamp shown by the UI also keeps status reads out of Hyperdrive's query cache.
    return db
      .select({
        id: recentSessions.id,
        config: recentSessions.config,
        status: recentSessions.status,
        reason: recentSessions.reason,
        startedAt: recentSessions.startedAt,
        endedAt: recentSessions.endedAt,
        imageId: latestImage.id,
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(recentSessions.startedAt),
        definitionName: linkedTest.definitionName,
        model: linkedTest.model,
      })
      .from(recentSessions)
      .leftJoinLateral(latestImage, sql`true`)
      .leftJoinLateral(linkedTest, sql`true`)
      .orderBy(desc(recentSessions.startedAt));
  });
}

export function getImage(connectionString: string, id: string): Promise<Buffer | undefined> {
  return withDatabase(connectionString, async (db) => {
    const [row] = await db
      .select({
        data: images.data,
        queriedAt: sql`CURRENT_TIMESTAMP`,
      })
      .from(images)
      .where(eq(images.id, id));
    return row?.data;
  });
}

export function listTestDefinitions(connectionString: string): Promise<TestDefinition[]> {
  return withDatabase(connectionString, (db) =>
    db.select().from(testDefinitions).orderBy(testDefinitions.name),
  );
}

export function listTestBasePrompts(connectionString: string): Promise<TestBasePrompt[]> {
  return withDatabase(connectionString, (db) =>
    db.select().from(testBasePrompts).orderBy(testBasePrompts.name),
  );
}
