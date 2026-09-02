import { desc, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { actions, images, sessions, testBasePrompts, testDefinitions } from "./schema.ts";

export type Session = typeof sessions.$inferSelect & {
  imageActionId: number | null;
  queriedAt: Date;
};

export type TestDefinition = typeof testDefinitions.$inferSelect;
export type TestBasePrompt = typeof testBasePrompts.$inferSelect;

// One connection per request, always closed: a worker invocation that leaves the
// client open leaks a Hyperdrive pooled connection until the pool is exhausted.
async function withDb<T>(connectionString: string, run: (db: NodePgDatabase) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await run(drizzle(client));
  } finally {
    await client.end();
  }
}

export async function listSessions(connectionString: string): Promise<Session[]> {
  return withDb(connectionString, async (db) => {
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
      .select({ actionId: images.actionId })
      .from(images)
      .innerJoin(actions, eq(actions.id, images.actionId))
      .where(eq(actions.sessionId, recentSessions.id))
      .orderBy(desc(actions.id))
      .limit(1)
      .as("latest_image");

    // The database timestamp shown by the UI also keeps status reads out of Hyperdrive's query cache.
    return db
      .select({
        id: recentSessions.id,
        config: recentSessions.config,
        status: recentSessions.status,
        reason: recentSessions.reason,
        startedAt: recentSessions.startedAt,
        endedAt: recentSessions.endedAt,
        imageActionId: latestImage.actionId,
        queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(recentSessions.startedAt),
      })
      .from(recentSessions)
      .leftJoinLateral(latestImage, sql`true`)
      .orderBy(desc(recentSessions.startedAt));
  });
}

export async function getSessionImage(connectionString: string, sessionId: string): Promise<Buffer | undefined> {
  return withDb(connectionString, async (db) => {
    const [row] = await db
      .select({
        data: images.data,
        queriedAt: sql`CURRENT_TIMESTAMP`,
      })
      .from(images)
      .innerJoin(actions, eq(actions.id, images.actionId))
      .where(eq(actions.sessionId, sessionId))
      .orderBy(desc(actions.id))
      .limit(1);
    return row?.data;
  });
}

export async function listTestDefinitions(connectionString: string): Promise<TestDefinition[]> {
  return withDb(connectionString, async (db) => db.select().from(testDefinitions).orderBy(testDefinitions.name));
}

export async function listTestBasePrompts(connectionString: string): Promise<TestBasePrompt[]> {
  return withDb(connectionString, async (db) => db.select().from(testBasePrompts).orderBy(testBasePrompts.name));
}
