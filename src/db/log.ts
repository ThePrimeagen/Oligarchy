import { styleText } from "node:util";
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

const AGENT_COLORS = [
  "cyan",
  "green",
  "yellow",
  "magenta",
  "blue",
  "cyanBright",
  "greenBright",
  "yellowBright",
  "magentaBright",
  "blueBright",
] as const;

// Inserts are chained so rows land in call order; a failed insert reports itself to
// stderr and never fails the caller or the lines behind it.
let chain: Promise<void> = Promise.resolve();

function colorFor(agentId: string): (typeof AGENT_COLORS)[number] {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return AGENT_COLORS[hash % AGENT_COLORS.length];
}

function write(line: LogEntry): void {
  const tag = line.agentId ?? "global";
  const text = line.level === undefined || line.level === "info" ? line.text : `${line.level}: ${line.text}`;
  const color = line.agentId === undefined ? "gray" : colorFor(line.agentId);
  console.error(styleText(color, `[${tag}] ${text}`));
}

export function log(
  db: Db,
  entry: string | LogEntry,
  report?: { cause?: unknown; skipSentry?: true },
): void {
  const line: LogEntry = typeof entry === "string" ? { text: entry } : entry;
  write(line);
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
      write({ level: "error", text: `db: log insert failed: ${detail}` });
      capture({ text: `db: log insert failed: ${detail}`, level: "error", cause: err });
    }
  });
}

export function flushLogs(): Promise<void> {
  return chain;
}
