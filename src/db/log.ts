// The database logger. log() writes a line to stderr and inserts the same
// line into the logs table, attributed to a QEMU session and a cloud agent
// when the caller has them:
//
//   log("iso: cache pruned");
//   log({ text: `iso: downloading ${url}`, sessionId, agentId });
//
// The database is DATABASE_URL (PlanetScale Postgres); a process that
// imports this module without it set fails at startup.

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { logs } from "./schema.ts";

const url = process.env.DATABASE_URL;
if (url === undefined) {
  throw new Error("db: DATABASE_URL is not set");
}

// allowExitOnIdle: the pool is background machinery and must never keep the
// importing process alive once its sockets go idle.
const pool = new Pool({ connectionString: url, allowExitOnIdle: true });
const db = drizzle({ client: pool });

export type LogEntry = {
  text: string;
  /** The QEMU session the line belongs to. */
  sessionId?: string;
  /** The cloud agent the line is attributed to. */
  agentId?: string;
};

// Inserts are chained so rows land in call order — id is the tiebreaker for
// lines whose created_at collide. A failed insert reports itself to stderr
// and never fails the caller or the lines behind it.
let chain: Promise<void> = Promise.resolve();

export function log(entry: string | LogEntry): void {
  const line: LogEntry = typeof entry === "string" ? { text: entry } : entry;
  console.error(line.text);
  chain = chain.then(async () => {
    try {
      await db.insert(logs).values(line);
    } catch (err) {
      console.error(`db: log insert failed: ${(err as Error).message}`);
    }
  });
}
