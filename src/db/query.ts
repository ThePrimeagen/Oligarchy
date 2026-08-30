import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { actions, images, sessions } from "./schema.ts";

export type Session = typeof sessions.$inferSelect & {
  imageActionId: number | null;
  queriedAt: Date;
};

async function connectDatabase(connectionString: string) {
  const client = new Client({ connectionString });
  await client.connect();
  return drizzle(client);
}

export async function listSessions(connectionString: string): Promise<Session[]> {
  const db = await connectDatabase(connectionString);
  const latestImage = db
    .select({ actionId: images.actionId })
    .from(images)
    .innerJoin(actions, eq(actions.id, images.actionId))
    .where(eq(actions.sessionId, sessions.id))
    .orderBy(desc(actions.id))
    .limit(1)
    .as("latest_image");

  // The database timestamp shown by the UI also keeps status reads out of Hyperdrive's query cache.
  const rows = await db
    .select({
      id: sessions.id,
      config: sessions.config,
      status: sessions.status,
      reason: sessions.reason,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      imageActionId: latestImage.actionId,
      queriedAt: sql<Date>`CURRENT_TIMESTAMP`.mapWith(sessions.startedAt),
    })
    .from(sessions)
    .leftJoinLateral(latestImage, sql`true`)
    .orderBy(desc(sessions.startedAt))
    .limit(50);
  return rows;
}

export async function getSessionImage(connectionString: string, actionId: number): Promise<Buffer | undefined> {
  const db = await connectDatabase(connectionString);
  const [row] = await db.select({ data: images.data }).from(images).where(eq(images.actionId, actionId)).limit(1);
  return row?.data;
}
