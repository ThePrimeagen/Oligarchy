import { Client } from "pg";

export type Session = {
  id: string;
  config: {
    iso: string;
    disk?: string;
  };
  status: SessionStartStatus | SessionEndStatus;
  reason: string | null;
  startedAt: Date;
  endedAt: Date | null;
  queriedAt: Date;
};

export async function listSessions(connectionString: string): Promise<Session[]> {
  const client = new Client({ connectionString });
  await client.connect();
  // The database timestamp shown by the UI also keeps status reads out of Hyperdrive's query cache.
  const result = await client.query<Session>(`
    SELECT
      id,
      config,
      status,
      reason,
      started_at AS "startedAt",
      ended_at AS "endedAt",
      CURRENT_TIMESTAMP AS "queriedAt"
    FROM sessions
    ORDER BY started_at DESC
    LIMIT 50
  `);
  return result.rows;
}
