import { WriteStream } from "node:tty";
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

const ROSE_PINE_MAIN = {
  love: "#eb6f92",
  gold: "#f6c177",
  rose: "#ebbcba",
  pine: "#31748f",
  foam: "#9ccfd8",
  iris: "#c4a7e7",
  leaf: "#95b1ac",
  text: "#e0def4",
  subtle: "#908caa",
  muted: "#6e6a86",
  highlightHigh: "#524f67",
  highlightMed: "#403d52",
  overlay: "#26233a",
  highlightLow: "#21202e",
  surface: "#1f1d2e",
  base: "#191724",
  nc: "#16141f",
} as const;

const AGENT_COLORS: readonly string[] = Object.values(ROSE_PINE_MAIN);

const colors = new Map<string, string>();
let next = 0;

// Inserts are chained so rows land in call order; a failed insert reports itself to
// stdout and never fails the caller or the lines behind it.
let chain: Promise<void> = Promise.resolve();

export function acquireAgentColor(agentId: string): void {
  if (colors.has(agentId)) {
    return;
  }
  const taken = new Set(colors.values());
  let pick = next;
  for (let i = 0; i < AGENT_COLORS.length; i++) {
    const idx = (next + i) % AGENT_COLORS.length;
    if (!taken.has(AGENT_COLORS[idx])) {
      pick = idx;
      break;
    }
  }
  colors.set(agentId, AGENT_COLORS[pick]);
  next = (pick + 1) % AGENT_COLORS.length;
}

export function releaseAgentColor(agentId: string): void {
  colors.delete(agentId);
}

function paint(hex: string, text: string): string {
  if (process.stdout.isTTY !== true && process.env.FORCE_COLOR === undefined) {
    return text;
  }
  if (!WriteStream.prototype.hasColors.call(process.stdout, 16)) {
    return text;
  }
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function write(line: LogEntry): void {
  const tag = line.agentId ?? "global";
  const text = line.level === undefined || line.level === "info" ? line.text : `${line.level}: ${line.text}`;
  const rendered = `[${tag}] ${text}`;
  const hex = line.agentId === undefined ? undefined : colors.get(line.agentId);
  if (hex === undefined) {
    console.log(styleText("gray", rendered, { stream: process.stdout }));
    return;
  }
  console.log(paint(hex, rendered));
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
