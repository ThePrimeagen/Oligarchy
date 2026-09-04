import { and, eq, sql } from "drizzle-orm";
import { Option, Schema } from "effect";
import { Flag } from "effect/unstable/cli";
import { prompt } from "../../cursor-agent/client.ts";
import { flushLogs, log } from "../../db/log.ts";
import { closeDatabase, connectDatabase, type Db } from "../../db/ops.ts";
import { sessions, testDefinitions, testResults, testRuns } from "../../db/schema.ts";
import {
  createLinearIssue,
  describeLinearIssue,
  drivingAgentPrompt,
  type Experiment,
  linearAssigneeId,
  linearLabelIds,
  linearTeamId,
  type LinearTicket,
  listLinearBacklog,
} from "../../linear.ts";
import { type CtrlArgs, parseCtrlArgs } from "../parse-args.ts";

const HttpsUrl = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      if (!URL.canParse(value)) {
        return false;
      }
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname !== "";
    },
    { message: "iso must be a valid https url" },
  ),
);

const definitionsSpec = {
  env: {},
  flags: {
    list: Flag.boolean("list").pipe(Flag.withDescription("List stored test definitions")),
    details: Flag.boolean("details").pipe(Flag.withDefault(false), Flag.withDescription("Print every field as JSON")),
    name: Flag.string("name").pipe(
      Flag.withSchema(Schema.NonEmptyString),
      Flag.optional,
      Flag.withDescription("Print this test definition only"),
    ),
  },
};

const newSpec = {
  env: { linearToken: "LINEAR_API_TOKEN" },
  flags: {
    iso: Flag.string("iso").pipe(Flag.withSchema(HttpsUrl), Flag.withDescription("HTTPS URL of the ISO")),
    version: Flag.string("version").pipe(
      Flag.withSchema(Schema.NonEmptyString),
      Flag.withDescription("Version label attached to every Linear ticket"),
    ),
    name: Flag.string("name").pipe(
      Flag.withSchema(Schema.NonEmptyString),
      Flag.optional,
      Flag.withDescription("Create a test for this test definition only"),
    ),
  },
};

const listSpec = {
  env: { linearToken: "LINEAR_API_TOKEN" },
  flags: {},
};

const runSpec = {
  env: { cursorToken: "CURSOR_API_TOKEN" },
  flags: {
    ticket: Flag.string("ticket").pipe(
      Flag.withSchema(Schema.NonEmptyString),
      Flag.withDescription("Linear ticket the driving agent completes"),
    ),
  },
};

const startSpec = {
  env: {},
  flags: {
    sessionId: Flag.string("session-id").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.withDescription("Session id")),
    testResultId: Flag.string("test-result-id").pipe(
      Flag.withSchema(Schema.NonEmptyString),
      Flag.withDescription("Test result id from the Linear ticket"),
    ),
  },
};

export type TestDefinitionsArgs = CtrlArgs<typeof definitionsSpec>;
export type TestNewArgs = CtrlArgs<typeof newSpec>;
export type TestListArgs = CtrlArgs<typeof listSpec>;
export type TestRunArgs = CtrlArgs<typeof runSpec>;
export type TestStartArgs = CtrlArgs<typeof startSpec>;

export type TestDefinitionRow = typeof testDefinitions.$inferSelect;

const USAGE = `usage: ctrl test --list [--details] [--name <definition>]
       ctrl test new --iso <https-url> --version <version> [--name <definition>]
       ctrl test list
       ctrl test run --ticket <linear-ticket>
       ctrl test start --session-id <id> --test-result-id <id>

Every form takes --server-url <url> (or SERVER_URL). ctrl test <verb> --help prints that verb's flags.`;

export async function testRun(argv: readonly string[]): Promise<void> {
  const [verb, ...rest] = argv;
  switch (verb) {
    case "new":
      return testNewRun(rest);
    case "list":
      return testListRun(rest);
    case "run":
      return testRunRun(rest);
    case "start":
      return testStartRun(rest);
    case "--help":
    case "-h":
      console.log(USAGE);
      return;
    default:
      return testDefinitionsRun(argv);
  }
}

export async function testDefinitionsRun(argv: readonly string[]): Promise<void> {
  const args: TestDefinitionsArgs = await parseCtrlArgs("test", definitionsSpec, argv);
  const db = connectDatabase(args.databaseUrl);
  try {
    printTestDefinitions(await selectTestDefinitions(db, Option.getOrUndefined(args.name)), args.details);
  } finally {
    await closeDatabase(db);
  }
}

export async function selectTestDefinitions(db: Db, name?: string): Promise<TestDefinitionRow[]> {
  const rows =
    name === undefined
      ? await db.select().from(testDefinitions).orderBy(testDefinitions.name)
      : await db.select().from(testDefinitions).where(eq(testDefinitions.name, name));
  if (name !== undefined && rows.length === 0) {
    throw new Error(`test: no test definition named ${name}`);
  }
  return rows;
}

export function printTestDefinitions(rows: TestDefinitionRow[], details: boolean): void {
  if (details) {
    console.log(JSON.stringify(rows));
    return;
  }
  for (const row of rows) {
    console.log(row.name);
  }
}

export async function testNewRun(argv: readonly string[]): Promise<void> {
  const args: TestNewArgs = await parseCtrlArgs("test new", newSpec, argv);
  const db = connectDatabase(args.databaseUrl);
  try {
    const result = await createExperiment(db, args.linearToken, {
      iso: args.iso,
      serverUrl: args.serverUrl,
      version: args.version,
      name: Option.getOrUndefined(args.name),
    });
    console.log(
      JSON.stringify({
        id: result.experiment.id,
        tests: result.experiment.tests.map((test, index) => ({
          id: test.id,
          linear: result.tickets[index],
        })),
      }),
    );
  } finally {
    await flushLogs();
    await closeDatabase(db);
  }
}

export async function createExperiment(
  db: Db,
  token: string,
  input: { iso: string; serverUrl: string; version: string; name?: string },
): Promise<{ experiment: Experiment; tickets: LinearTicket[] }> {
  const definitions =
    input.name === undefined
      ? await db.select().from(testDefinitions).orderBy(testDefinitions.name)
      : await db.select().from(testDefinitions).where(eq(testDefinitions.name, input.name));
  if (definitions.length === 0) {
    throw new Error(
      input.name === undefined ? "test: no test definitions found" : `test: no test definition named ${input.name}`,
    );
  }

  const created = await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(testRuns)
      .values({
        name: "Omarchy experiment",
        iso: input.iso,
        serverUrl: input.serverUrl,
        status: "pending",
      })
      .returning({ id: testRuns.id });
    const results = await tx
      .insert(testResults)
      .values(
        definitions.map((definition) => ({
          runId: run.id,
          definitionId: definition.id,
          status: "pending" as const,
        })),
      )
      .returning({
        id: testResults.id,
        definitionId: testResults.definitionId,
      });
    return { id: run.id, results };
  });
  const resultIds = new Map(created.results.map((result) => [result.definitionId, result.id]));
  const experiment: Experiment = {
    id: created.id,
    iso: input.iso,
    serverUrl: input.serverUrl,
    version: input.version,
    tests: definitions.map((definition) => ({
      id: resultIds.get(definition.id)!,
      definitionId: definition.id,
      name: definition.name,
      description: definition.description,
      instruction: definition.instruction,
      proof: definition.proof,
    })),
  };

  const tickets: LinearTicket[] = [];
  try {
    const teamId = await linearTeamId(token);
    const labelIds = await linearLabelIds(token, teamId, experiment.version);
    const assigneeId = await linearAssigneeId(token);
    for (const test of experiment.tests) {
      const ticket = await createLinearIssue(token, teamId, labelIds, assigneeId, test);
      tickets.push(ticket);
      await describeLinearIssue(token, ticket, experiment, test);
    }
  } catch (err) {
    const created = tickets.map((ticket) => ticket.identifier).join(", ");
    const reason = created === "" ? (err as Error).message : `${(err as Error).message}; created ${created}`;
    const finishedAt = sql`now()`;
    await db.transaction(async (tx) => {
      await tx
        .update(testRuns)
        .set({ status: "failed", reason, endedAt: finishedAt })
        .where(eq(testRuns.id, experiment.id));
      await tx
        .update(testResults)
        .set({ status: "failed", reason, finishedAt })
        .where(eq(testResults.runId, experiment.id));
    });
    throw created === "" ? err : new Error(reason);
  }

  log(
    db,
    `test ${experiment.id} created; ${experiment.tests.length} tests; ${tickets.map((ticket) => ticket.identifier).join(", ")}`,
  );
  await flushLogs();
  return { experiment, tickets };
}

export async function testListRun(argv: readonly string[]): Promise<void> {
  const args: TestListArgs = await parseCtrlArgs("test list", listSpec, argv);
  console.log(JSON.stringify(await listLinearBacklog(args.linearToken)));
}

export async function testRunRun(argv: readonly string[]): Promise<void> {
  const args: TestRunArgs = await parseCtrlArgs("test run", runSpec, argv);
  await prompt(args.cursorToken, drivingAgentPrompt(args.ticket, args.serverUrl));
}

export async function testStartRun(argv: readonly string[]): Promise<void> {
  const args: TestStartArgs = await parseCtrlArgs("test start", startSpec, argv);
  const db = connectDatabase(args.databaseUrl);
  try {
    const [session] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, args.sessionId));
    if (session === undefined) {
      throw new Error(`test start: no session ${args.sessionId}`);
    }
    const [row] = await db
      .update(testResults)
      .set({ sessionId: args.sessionId, status: "running" })
      .where(and(eq(testResults.id, args.testResultId), eq(testResults.status, "pending")))
      .returning({ id: testResults.id });
    if (row === undefined) {
      throw new Error(`test start: result ${args.testResultId} not found or not pending`);
    }
    log(db, {
      text: `test result ${args.testResultId}: running; session ${args.sessionId}`,
      sessionId: args.sessionId,
    });
  } finally {
    await flushLogs();
    await closeDatabase(db);
  }
}
