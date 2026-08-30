import { desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { sessions } from "./schema.ts";

export type Session = typeof sessions.$inferSelect & {
  queriedAt: Date;
};

export async function listSessions(connectionString: string): Promise<Session[]> {
  const client = new Client({ connectionString });
  await client.connect();
  const db = drizzle(client);
  // The database timestamp shown by the UI also keeps status reads out of Hyperdrive's query cache.
  const rows = await db
    .select({
      id: sessions.id,
      config: sessions.config,
      status: sessions.status,
      reason: sessions.reason,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      queriedAt: sql<Date>`CURRENT_TIMESTAMP`,
    })
    .from(sessions)
    .orderBy(desc(sessions.startedAt))
    .limit(50);
  return rows;
}
