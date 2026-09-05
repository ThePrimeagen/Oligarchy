import { desc, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { actions, images, sessions, testBasePrompts, testDefinitions } from "./schema.ts";

export type Session = typeof sessions.$inferSelect & {
  imageId: string | null;
  queriedAt: Date;
};

export type TestDefinition = typeof testDefinitions.$inferSelect;
export type TestBasePrompt = typeof testBasePrompts.$inferSelect;

// One connection per call, ended whether the query returned, threw, or never connected;
// a client left open holds a Hyperdrive connection for the rest of the request.
async function withDatabase<T>(connectionString: string, run: (db: NodePgDatabase) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return await run(drizzle(client));
  } finally {
    await client.end();
  }
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
      })
      .from(recentSessions)
      .leftJoinLateral(latestImage, sql`true`)
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
  return withDatabase(connectionString, (db) => db.select().from(testDefinitions).orderBy(testDefinitions.name));
}

export function listTestBasePrompts(connectionString: string): Promise<TestBasePrompt[]> {
  return withDatabase(connectionString, (db) => db.select().from(testBasePrompts).orderBy(testBasePrompts.name));
}
