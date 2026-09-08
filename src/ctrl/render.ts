import type * as DbSchema from "../db/schema.ts";
import type * as Domain from "../shared/domain.ts";

export type SessionRow = {
  readonly id: string;
  readonly status: Domain.SessionStatus;
  readonly startedAt: Date;
};

export type TestDefinitionRow = typeof DbSchema.testDefinitions.$inferSelect;
export type ErrorTypeRow = typeof DbSchema.postRunErrorTypes.$inferSelect;

export const STATUS_COLOR: Readonly<Record<Domain.SessionStatus, string>> = {
  downloading: "\x1b[90m",
  running: "\x1b[33m",
  succeeded: "\x1b[32m",
  failed: "\x1b[31m",
  aborted: "\x1b[91m",
  timed_out: "\x1b[35m",
};

const RESET = "\x1b[0m";
const STATUS_WIDTH = "downloading".length;
const AGE_WIDTH = "23h59m ago".length + 1;

export const json = (value: unknown): string => JSON.stringify(value);

// The row's clock is the database's; a few seconds ahead of ours is normal and must not read as
// negative.
export const age = (now: number, startedAt: Date): string => {
  const seconds = Math.max(0, Math.floor((now - startedAt.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (seconds < 60) {
    return `${String(seconds)}s ago`;
  }
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }
  if (hours < 24) {
    return minutes % 60 === 0
      ? `${String(hours)}h ago`
      : `${String(hours)}h${String(minutes % 60)}m ago`;
  }
  return hours % 24 === 0 ? `${String(days)}d ago` : `${String(days)}d${String(hours % 24)}h ago`;
};

export const sessionLine = (row: SessionRow, now: number): string => {
  const status = `${STATUS_COLOR[row.status]}${row.status.padEnd(STATUS_WIDTH)}${RESET}`;
  return `${status}  ${age(now, row.startedAt).padEnd(AGE_WIDTH)}  ${row.id}`;
};

export const renderSessions = (
  rows: ReadonlyArray<SessionRow>,
  asJson: boolean,
  now: number,
): ReadonlyArray<string> => (asJson ? [json(rows)] : rows.map((row) => sessionLine(row, now)));

export const renderTestDefinitions = (
  rows: ReadonlyArray<TestDefinitionRow>,
  details: boolean,
): ReadonlyArray<string> => (details ? [json(rows)] : rows.map((row) => row.name));

// Rows as the store lists a history, by name then oldest first: a row's version is its place
// among its name's rows, so a gap in the ids is not a gap in the versions.
export const renderTestDefinitionHistory = (
  rows: ReadonlyArray<TestDefinitionRow>,
  details: boolean,
): ReadonlyArray<string> => {
  const versioned = rows.map((row, index) => ({
    ...row,
    version: index - rows.findIndex((other) => other.name === row.name) + 1,
  }));
  return details
    ? [json(versioned)]
    : versioned.map((row) => `${row.name} v${String(row.version)}`);
};

export const renderErrorTypes = (
  rows: ReadonlyArray<ErrorTypeRow>,
  asJson: boolean,
): ReadonlyArray<string> => {
  if (asJson) {
    return [json(rows)];
  }
  const width = Math.max(0, ...rows.map((row) => row.key.length));
  return rows.map((row) => `${row.key.padEnd(width)}  ${row.description}`);
};

export const agentLink = (url: string): string =>
  `Agent here, go check it out for more information: ${url}`;
