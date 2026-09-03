import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { actions, images, sessions, testBasePrompts, testDefinitions } from "./schema.ts";

export type Session = typeof sessions.$inferSelect & {
  imageActionId: number | null;
  queriedAt: Date;
};

export type TestDefinition = typeof testDefinitions.$inferSelect;
export type TestBasePrompt = typeof testBasePrompts.$inferSelect;

async function connectDatabase(connectionString: string) {
  const client = new Client({ connectionString });
  await client.connect();
  return drizzle(client);
}

export async function listSessions(connectionString: string): Promise<Session[]> {
  const db = await connectDatabase(connectionString);
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
  const rows = await db
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
  return rows;
}

export async function getSessionImage(connectionString: string, sessionId: string): Promise<Buffer | undefined> {
  const db = await connectDatabase(connectionString);
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
}

export async function getImage(connectionString: string, actionId: number): Promise<Buffer | undefined> {
  const db = await connectDatabase(connectionString);
  const [row] = await db
    .select({
      data: images.data,
      queriedAt: sql`CURRENT_TIMESTAMP`,
    })
    .from(images)
    .where(eq(images.actionId, actionId));
  return row?.data;
}

export async function listTestDefinitions(connectionString: string): Promise<TestDefinition[]> {
  const db = await connectDatabase(connectionString);
  return db.select().from(testDefinitions).orderBy(testDefinitions.name);
}

export async function listTestBasePrompts(connectionString: string): Promise<TestBasePrompt[]> {
  const db = await connectDatabase(connectionString);
  return db.select().from(testBasePrompts).orderBy(testBasePrompts.name);
}
