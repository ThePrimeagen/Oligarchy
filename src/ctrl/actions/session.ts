import { desc, eq } from "drizzle-orm";
import { Schema } from "effect";
import { Flag } from "effect/unstable/cli";
import { closeDatabase, connectDatabase } from "../../db/ops.ts";
import { actions, logs, sessions, testDefinitions, testResults } from "../../db/schema.ts";
import { type CtrlArgs, parseCtrlArgs } from "../parse-args.ts";

const DEFAULT_COUNT = 10;

const USAGE = `usage: ctrl session list [--count <n>] [--json]
       ctrl session --session-id <id> --logs|--test-def|--test-results|--actions|--all

Every form takes --server-url <url> (or SERVER_URL). ctrl session list --help and ctrl session --session-id <id> --help print their flags.`;

const listSpec = {
  env: {},
  flags: {
    count: Flag.integer("count").pipe(
      Flag.withSchema(Schema.Number.check(Schema.isGreaterThanOrEqualTo(1, { message: "count must be at least 1" }))),
      Flag.withDefault(DEFAULT_COUNT),
      Flag.withDescription("How many of the most recent sessions to print"),
    ),
    json: Flag.boolean("json").pipe(Flag.withDefault(false), Flag.withDescription("Print the sessions as a JSON array")),
  },
};

const inspectSpec = {
  env: {},
  flags: {
    sessionId: Flag.string("session-id").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.withDescription("Session id")),
    logs: Flag.boolean("logs").pipe(Flag.withDefault(false), Flag.withDescription("Print session logs")),
    testDef: Flag.boolean("test-def").pipe(Flag.withDefault(false), Flag.withDescription("Print the session's test definition")),
    testResults: Flag.boolean("test-results").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print the session's test result"),
    ),
    actions: Flag.boolean("actions").pipe(Flag.withDefault(false), Flag.withDescription("Print session actions")),
    all: Flag.boolean("all").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print logs, test definition, test results, and actions"),
    ),
  },
};

export type SessionListArgs = CtrlArgs<typeof listSpec>;
export type SessionInspectArgs = CtrlArgs<typeof inspectSpec>;

export async function sessionRun(argv: readonly string[]): Promise<void> {
  const [verb, ...rest] = argv;
  switch (verb) {
    case "list":
      return sessionListRun(rest);
    case "--help":
    case "-h":
      console.log(USAGE);
      return;
    default:
      return sessionInspectRun(argv);
  }
}

export async function sessionListRun(argv: readonly string[]): Promise<void> {
  const args: SessionListArgs = await parseCtrlArgs("session list", listSpec, argv);
  const db = connectDatabase(args.databaseUrl);
  try {
    const rows = await db
      .select({ id: sessions.id, status: sessions.status, startedAt: sessions.startedAt })
      .from(sessions)
      .orderBy(desc(sessions.startedAt), desc(sessions.id))
      .limit(args.count);
    printSessions(rows, args.json);
  } finally {
    await closeDatabase(db);
  }
}

type SessionRow = Pick<typeof sessions.$inferSelect, "id" | "status" | "startedAt">;

const STATUS_COLOR: Record<SessionRow["status"], string> = {
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

export function printSessions(rows: SessionRow[], json = false): void {
  if (json) {
    console.log(JSON.stringify(rows));
    return;
  }
  const now = Date.now();
  for (const row of rows) {
    // The row's clock is the database's; a few seconds ahead of ours is normal and must not read as negative.
    const seconds = Math.max(0, Math.floor((now - row.startedAt.getTime()) / 1000));
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    let age: string;
    if (seconds < 60) {
      age = `${seconds}s ago`;
    } else if (minutes < 60) {
      age = `${minutes}m ago`;
    } else if (hours < 24) {
      age = minutes % 60 === 0 ? `${hours}h ago` : `${hours}h${minutes % 60}m ago`;
    } else {
      age = hours % 24 === 0 ? `${days}d ago` : `${days}d${hours % 24}h ago`;
    }
    const status = `${STATUS_COLOR[row.status]}${row.status.padEnd(STATUS_WIDTH)}${RESET}`;
    console.log(`${status}  ${age.padEnd(AGE_WIDTH)}  ${row.id}`);
  }
}

export async function sessionInspectRun(argv: readonly string[]): Promise<void> {
  const args: SessionInspectArgs = await parseCtrlArgs("session", inspectSpec, argv);
  if (!args.logs && !args.testDef && !args.testResults && !args.actions && !args.all) {
    throw new Error("session: --logs, --test-def, --test-results, --actions, or --all is required");
  }
  const db = connectDatabase(args.databaseUrl);
  try {
    const [session] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, args.sessionId));
    if (session === undefined) {
      throw new Error(`session: no session ${args.sessionId}`);
    }

    const out: {
      logs?: (typeof logs.$inferSelect)[];
      results?: typeof testResults.$inferSelect | null;
      test_definition?: typeof testDefinitions.$inferSelect | null;
      actions?: (typeof actions.$inferSelect)[];
    } = {};

    if (args.all || args.logs) {
      out.logs = await db.select().from(logs).where(eq(logs.sessionId, args.sessionId)).orderBy(logs.createdAt, logs.id);
    }
    if (args.all || args.testResults || args.testDef) {
      const rows = await db
        .select({
          result: testResults,
          definition: testDefinitions,
        })
        .from(testResults)
        .innerJoin(testDefinitions, eq(testResults.definitionId, testDefinitions.id))
        .where(eq(testResults.sessionId, args.sessionId));
      if (rows.length > 1) {
        throw new Error(`session: multiple test results for ${args.sessionId}`);
      }
      const row = rows[0];
      if (args.all || args.testResults) {
        out.results = row?.result ?? null;
      }
      if (args.all || args.testDef) {
        out.test_definition = row?.definition ?? null;
      }
    }
    if (args.all || args.actions) {
      out.actions = await db
        .select()
        .from(actions)
        .where(eq(actions.sessionId, args.sessionId))
        .orderBy(actions.createdAt, actions.id);
    }

    const values = [out.logs, out.results, out.test_definition, out.actions].filter((value) => value !== undefined);
    console.log(JSON.stringify(values.length === 1 ? values[0] : out));
  } finally {
    await closeDatabase(db);
  }
}
