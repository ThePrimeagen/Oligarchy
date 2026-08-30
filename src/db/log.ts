// The database logger. log() writes a line to stderr and inserts the same
// line into the logs table, attributed to a QEMU session and a cloud agent
// when the caller has them, at a severity the caller picks (info when it
// does not say):
//
//   log(db, "iso: cache pruned");
//   log(db, { text: `iso: downloading ${url}`, sessionId, agentId });
//   log(db, { level: "error", text: `POST /start failed: ${message}` });
//
// error and fatal also go to Sentry when SENTRY_DSN is set — that is the
// one reporting path, so a failed request, a db write that would not
// record, and a dying proxy show up in the same place. A 4xx is still an
// error line (a refused request is a failed request) but is the client's
// mistake: the caller passes skipSentry. The optional cause is the
// exception Sentry should group on; without one the text is the event.
//
// The db is the one client connectDatabase() built (see ops.ts); this file
// never touches connection details.

import { capture } from "../sentry.ts";
import type { Db } from "./ops.ts";
import { logs } from "./schema.ts";

// Ascending severity, matching the log_level enum's declaration order.
// info: the normal story. warning: something was off but the operation
// went on. error: an operation failed. fatal: the process is going down —
// the writer exits right after flushLogs().
export type LogLevel = "info" | "warning" | "error" | "fatal";

export type LogEntry = {
  text: string;
  /** Severity of the line; omitted means info. */
  level?: LogLevel;
  /** The QEMU session the line belongs to. */
  sessionId?: string;
  /** The cloud agent the line is attributed to. */
  agentId?: string;
};

// Inserts are chained so rows land in call order — id is the tiebreaker for
// lines whose created_at collide. A failed insert reports itself to stderr
// and never fails the caller or the lines behind it.
let chain: Promise<void> = Promise.resolve();

export function log(
  db: Db,
  entry: string | LogEntry,
  report?: { cause?: unknown; skipSentry?: true },
): void {
  const line: LogEntry = typeof entry === "string" ? { text: entry } : entry;
  // info stays bare on stderr — it is the default story; the levels worth
  // noticing carry their name.
  console.error(line.level === undefined || line.level === "info" ? line.text : `${line.level}: ${line.text}`);
  if ((line.level === "error" || line.level === "fatal") && report?.skipSentry !== true) {
    capture({
      text: line.text,
      level: line.level,
      sessionId: line.sessionId,
      agentId: line.agentId,
      cause: report?.cause,
    });
  }
  chain = chain.then(async () => {
    try {
      await db.insert(logs).values(line);
    } catch (err) {
      // Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own
      // message is the failed SQL and the params — noise here.
      const e = err as Error;
      const detail = e.cause instanceof Error ? e.cause.message : e.message;
      console.error(`db: log insert failed: ${detail}`);
      capture({ text: `db: log insert failed: ${detail}`, level: "error", cause: err });
    }
  });
}

/**
 * Settles once every line queued so far has been written (or reported its
 * failure to stderr). For paths that end in process.exit — a plain exit
 * would drop the queued rows. Never rejects: every link in the chain
 * catches its own failure.
 */
export function flushLogs(): Promise<void> {
  return chain;
}
