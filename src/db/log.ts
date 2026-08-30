// The database logger. log() writes a line to stderr and inserts the same
// line into the logs table, attributed to a QEMU session and a cloud agent
// when the caller has them:
//
//   log(db, "iso: cache pruned");
//   log(db, { text: `iso: downloading ${url}`, sessionId, agentId });
//
// The db is the one client connectDatabase() built (see ops.ts); this file
// never touches connection details.

import type { Db } from "./ops.ts";
import { logs } from "./schema.ts";

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

export function log(db: Db, entry: string | LogEntry): void {
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
