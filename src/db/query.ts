import { Client } from "pg";

export type Session = {
  id: string;
  config: {
    iso: string;
    disk?: string;
  };
  status: "downloading" | "running" | "succeeded" | "failed" | "aborted";
  reason: string | null;
  startedAt: Date;
  endedAt: Date | null;
};

export async function listSessions(connectionString: string): Promise<Session[]> {
  const client = new Client({ connectionString });
  await client.connect();
  const result = await client.query<Session>(`
    SELECT
      id,
      config,
      status,
      reason,
      started_at AS "startedAt",
      ended_at AS "endedAt"
    FROM sessions
    ORDER BY started_at DESC
    LIMIT 50
  `);
  return result.rows;
}
