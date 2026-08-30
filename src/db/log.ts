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

// An empty string must fail too: pg would silently fall back to its
// localhost defaults instead of connecting to the real database.
const url = process.env.DATABASE_URL;
if (url === undefined || url === "") {
  throw new Error("db: DATABASE_URL is not set");
}

// allowExitOnIdle: the pool is background machinery and must never keep the
// importing process alive once its sockets go idle.
const pool = new Pool({ connectionString: url, allowExitOnIdle: true });
// An idle client dropped by the server (a restart, a failover) surfaces as a
// pool error; without a listener Node crashes the process on it.
pool.on("error", (err) => {
  console.error(`db: pool error: ${err.message}`);
});
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
      // Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own
      // message is the failed SQL and the params — noise here.
      const e = err as Error;
      console.error(`db: log insert failed: ${e.cause instanceof Error ? e.cause.message : e.message}`);
    }
  });
}
