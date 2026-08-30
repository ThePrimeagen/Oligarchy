import { capture } from "../sentry.ts";
import type { Db } from "./ops.ts";
import { logs } from "./schema.ts";

export type LogLevel = "info" | "warning" | "error" | "fatal";

export type LogEntry = {
  text: string;
  level?: LogLevel;
  sessionId?: string;
  agentId?: string;
};

// Inserts are chained so rows land in call order; a failed insert reports itself to
// stderr and never fails the caller or the lines behind it.
let chain: Promise<void> = Promise.resolve();

export function log(
  db: Db,
  entry: string | LogEntry,
  report?: { cause?: unknown; skipSentry?: true },
): void {
  const line: LogEntry = typeof entry === "string" ? { text: entry } : entry;
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
      // Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own message is the failed SQL.
      const e = err as Error;
      const detail = e.cause instanceof Error ? e.cause.message : e.message;
      console.error(`db: log insert failed: ${detail}`);
      capture({ text: `db: log insert failed: ${detail}`, level: "error", cause: err });
    }
  });
}

export function flushLogs(): Promise<void> {
  return chain;
}
