import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Effect, Option, Schema } from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";
import { eq, sql } from "drizzle-orm";
import { prompt } from "./cursor-agent/client.ts";
import { closeDatabase, connectDatabase, type Db } from "./db/ops.ts";
import { flushLogs, log } from "./db/log.ts";
import { testDefinitions, testResults, testRuns } from "./db/schema.ts";
import { listTestDefinitions } from "./test-def.ts";

const LINEAR_API_URL = "https://api.linear.app/graphql";
const DEFAULT_SERVER_URL = "http://127.0.0.1:42069";
const SUB_AGENT = "Grok 4.6 high fast (cursor-grok-4.6-high-fast)";

const HttpsUrl = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      if (!URL.canParse(value)) {
        return false;
      }
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname !== "";
    },
    { message: "test: iso must be a valid https url" },
  ),
);

const HttpUrl = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      if (!URL.canParse(value)) {
        return false;
      }
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
    },
    { message: "test: server_url must be a valid http or https url" },
  ),
);

export type ExperimentTest = {
  id: string;
  definitionId: number;
  name: string;
  description: string;
  instruction: string;
  proof: string;
};

export type Experiment = {
  id: string;
  iso: string;
  serverUrl: string;
  version: string;
  tests: ExperimentTest[];
};

export type LinearTicket = {
  id: string;
  identifier: string;
  url: string;
};

type LinearBacklogTicket = LinearTicket & {
  title: string;
};

type LinearResponse<T> = {
  data?: T;
  errors?: { message: string }[];
};

function renderPrompt(file: string, values: Record<string, string>): string {
  const template = readFileSync(new URL(`../prompts/${file}`, import.meta.url), "utf8");
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`test: prompts/${file} uses {{${name}}}, which has no value`);
    }
    return value;
  });
}

export function linearTicketDescription(experiment: Experiment, test: ExperimentTest, ticket: string): string {
  return renderPrompt("linear-issue.html", {
    LINEAR_TICKET: ticket,
    RUN_ID: experiment.id,
    RESULT_ID: test.id,
    VERSION: experiment.version,
    ISO_URL: experiment.iso,
    SERVER_URL: experiment.serverUrl,
    TEST_NAME: test.name,
    TEST_DESCRIPTION: test.description,
    TEST_INSTRUCTION: test.instruction,
    TEST_PROOF: test.proof,
    CLIENT_MD: readFileSync(new URL("../client.md", import.meta.url), "utf8").trimEnd(),
    SUB_AGENT,
  });
}

export function drivingAgentPrompt(ticket: string, serverUrl: string): string {
  return renderPrompt("driving-agent.html", { LINEAR_TICKET: ticket, SERVER_URL: serverUrl });
}

async function linearRequest<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`linear: request failed (${response.status})${text === "" ? "" : `: ${text}`}`);
  }

  let result: LinearResponse<T>;
  try {
    result = JSON.parse(text) as LinearResponse<T>;
  } catch {
    throw new Error("linear: invalid response");
  }
  if (result.errors !== undefined && result.errors.length > 0) {
    throw new Error(`linear: ${result.errors.map((error) => error.message).join("; ")}`);
  }
  if (result.data === undefined) {
    throw new Error("linear: invalid response");
  }
  return result.data;
}

const AGENT_TEST_LABEL = "agent test";

async function linearTeamId(token: string): Promise<string> {
  const teams = await linearRequest<{ teams: { nodes: { id: string }[] } }>(
    token,
    "query ExperimentTeams { teams(first: 1) { nodes { id } } }",
  );
  const team = teams.teams.nodes[0];
  if (team === undefined) {
    throw new Error("linear: no accessible teams");
  }
  return team.id;
}

async function linearLabelId(token: string, teamId: string, name: string): Promise<string> {
  const found = await linearRequest<{ issueLabels: { nodes: { id: string }[] } }>(
    token,
    "query ExperimentLabel($name: String!, $teamId: ID!) { issueLabels(filter: { name: { eq: $name }, team: { id: { eq: $teamId } } }, first: 1) { nodes { id } } }",
    { name, teamId },
  );
  const existing = found.issueLabels.nodes[0];
  if (existing !== undefined) {
    return existing.id;
  }

  const created = await linearRequest<{
    issueLabelCreate: {
      success: boolean;
      issueLabel: { id: string } | null;
    };
  }>(
    token,
    `mutation ExperimentLabelCreate($input: IssueLabelCreateInput!) {
  issueLabelCreate(input: $input) {
    success
    issueLabel {
      id
    }
  }
}`,
    { input: { name, teamId } },
  );
  if (!created.issueLabelCreate.success || created.issueLabelCreate.issueLabel === null) {
    throw new Error("linear: label creation failed");
  }
  return created.issueLabelCreate.issueLabel.id;
}

async function linearLabelIds(token: string, teamId: string, version: string): Promise<string[]> {
  return [
    await linearLabelId(token, teamId, AGENT_TEST_LABEL),
    await linearLabelId(token, teamId, version),
  ];
}

export async function createLinearTicket(
  token: string,
  experiment: Experiment,
  test: ExperimentTest,
): Promise<LinearTicket> {
  const teamId = await linearTeamId(token);
  const ticket = await createLinearIssue(token, teamId, await linearLabelIds(token, teamId, experiment.version), test);
  await describeLinearIssue(token, ticket, experiment, test);
  return ticket;
}

async function createLinearIssue(
  token: string,
  teamId: string,
  labelIds: string[],
  test: ExperimentTest,
): Promise<LinearTicket> {
  const result = await linearRequest<{
    issueCreate: {
      success: boolean;
      issue: LinearTicket | null;
    };
  }>(
    token,
    `mutation ExperimentIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      url
    }
  }
}`,
    {
      input: {
        teamId,
        title: `Omarchy: ${test.name}`,
        labelIds,
      },
    },
  );
  if (!result.issueCreate.success || result.issueCreate.issue === null) {
    throw new Error("linear: issue creation failed");
  }
  return result.issueCreate.issue;
}

// Linear assigns the identifier on create, and the description names it as the
// driver's agent id, so the body can only land in a second call.
async function describeLinearIssue(
  token: string,
  ticket: LinearTicket,
  experiment: Experiment,
  test: ExperimentTest,
): Promise<void> {
  const result = await linearRequest<{ issueUpdate: { success: boolean } }>(
    token,
    `mutation ExperimentIssueDescribe($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
  }
}`,
    { id: ticket.id, input: { description: linearTicketDescription(experiment, test, ticket.identifier) } },
  );
  if (!result.issueUpdate.success) {
    throw new Error(`linear: describing ${ticket.identifier} failed`);
  }
}

export async function createExperiment(
  db: Db,
  token: string,
  input: { iso: string; serverUrl: string; version: string; name?: string },
): Promise<{ experiment: Experiment; tickets: LinearTicket[] }> {
  const definitions = input.name === undefined
    ? await db.select().from(testDefinitions).orderBy(testDefinitions.name)
    : await db.select().from(testDefinitions).where(eq(testDefinitions.name, input.name));
  if (definitions.length === 0) {
    throw new Error(
      input.name === undefined
        ? "test: no test definitions found"
        : `test: no test definition named ${input.name}`,
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
    for (const test of experiment.tests) {
      const ticket = await createLinearIssue(token, teamId, labelIds, test);
      tickets.push(ticket);
      await describeLinearIssue(token, ticket, experiment, test);
    }
  } catch (err) {
    const created = tickets.map((ticket) => ticket.identifier).join(", ");
    const reason = created === ""
      ? (err as Error).message
      : `${(err as Error).message}; created ${created}`;
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

export async function newExperiment(input: { iso: string; serverUrl?: string; version: string; name?: string }): Promise<void> {
  if (existsSync(".env")) {
    loadEnvFile();
  }

  const fromEnv = process.env.SERVER_URL;
  const serverUrl = Schema.decodeUnknownSync(HttpUrl)(
    fromEnv !== undefined && fromEnv !== "" ? fromEnv : (input.serverUrl ?? DEFAULT_SERVER_URL),
  );

  const token = process.env.LINEAR_API_TOKEN;
  if (token === undefined || token === "") {
    throw new Error("test: LINEAR_API_TOKEN is not set");
  }

  const db = connectDatabase();
  try {
    const result = await createExperiment(db, token, { ...input, serverUrl });
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

export async function runExperiment(input: { ticket: string; serverUrl: string }): Promise<void> {
  if (existsSync(".env")) {
    loadEnvFile();
  }
  await prompt(drivingAgentPrompt(input.ticket, input.serverUrl));
}

function fail(cause: unknown): CliError.UserError {
  const e = cause as Error;
  let text = e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message;
  if (e.stack !== undefined) {
    text += `\n${e.stack}`;
  }
  if (e.cause instanceof Error && e.cause.stack !== undefined && e.cause.stack !== e.stack) {
    text += `\n${e.cause.stack}`;
  }
  return new CliError.UserError({ cause, userMessage: text });
}

async function listLinearBacklog(token: string): Promise<LinearBacklogTicket[]> {
  const tickets: LinearBacklogTicket[] = [];
  let after: string | undefined;
  const filter = {
    team: { name: { eq: "Oligarchy" } },
    state: { type: { eq: "backlog" } },
  };
  for (;;) {
    const page = await linearRequest<{
      issues: {
        nodes: LinearBacklogTicket[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(
      token,
      `query ExperimentBacklog($filter: IssueFilter!, $after: String) {
  issues(first: 100, after: $after, filter: $filter) {
    nodes {
      id
      identifier
      title
      url
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`,
      { filter, after },
    );
    tickets.push(...page.issues.nodes);
    if (!page.issues.pageInfo.hasNextPage) {
      return tickets;
    }
    if (page.issues.pageInfo.endCursor === null) {
      throw new Error("linear: invalid response");
    }
    after = page.issues.pageInfo.endCursor;
  }
}

async function listExperiment(): Promise<void> {
  if (existsSync(".env")) {
    loadEnvFile();
  }

  const token = process.env.LINEAR_API_TOKEN;
  if (token === undefined || token === "") {
    throw new Error("test: LINEAR_API_TOKEN is not set");
  }

  const tickets = await listLinearBacklog(token);
  console.log(JSON.stringify(tickets));
}

const experimentListCommand = Command.make(
  "list",
  {},
  Effect.fn(function* () {
    yield* Effect.tryPromise({
      try: () => listExperiment(),
      catch: fail,
    });
  }),
);

export const experimentNewCommand = Command.make(
  "new",
  {
    iso: Flag.string("iso").pipe(
      Flag.withSchema(HttpsUrl),
      Flag.withDescription("HTTPS URL of the ISO"),
    ),
    serverUrl: Flag.string("server_url").pipe(
      Flag.optional,
      Flag.withDescription("HTTP or HTTPS URL of the oligarchy server"),
    ),
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
  Effect.fn(function* ({ iso, serverUrl, version, name }) {
    yield* Effect.tryPromise({
      try: () =>
        newExperiment({
          iso,
          serverUrl: Option.isNone(serverUrl) ? undefined : serverUrl.value,
          version,
          name: Option.isNone(name) ? undefined : name.value,
        }),
      catch: fail,
    });
  }),
);

const experimentRunCommand = Command.make(
  "run",
  {
    ticket: Flag.string("ticket").pipe(
      Flag.withSchema(Schema.NonEmptyString),
      Flag.withDescription("Linear ticket the driving agent completes"),
    ),
    serverUrl: Flag.string("server_url").pipe(
      Flag.withSchema(HttpUrl),
      Flag.withDescription("HTTP or HTTPS URL of the oligarchy server"),
    ),
  },
  Effect.fn(function* ({ ticket, serverUrl }) {
    yield* Effect.tryPromise({
      try: () => runExperiment({ ticket, serverUrl }),
      catch: fail,
    });
  }),
);

export const experimentCommand = Command.make(
  "test",
  {
    list: Flag.boolean("list").pipe(
      Flag.withDefault(false),
      Flag.withDescription("List stored test definitions"),
    ),
    details: Flag.boolean("details").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print every field of stored test definitions"),
    ),
    name: Flag.string("name").pipe(
      Flag.withSchema(Schema.NonEmptyString),
      Flag.optional,
      Flag.withDescription("Print this test definition only"),
    ),
  },
  Effect.fn(function* ({ list, details, name }) {
    if (!list) {
      return yield* Effect.fail(
        new CliError.UserError({
          cause: new Error("test: --list is required"),
          userMessage: "test: --list is required",
        }),
      );
    }
    yield* Effect.tryPromise({
      try: () =>
        listTestDefinitions({
          details,
          name: Option.isNone(name) ? undefined : name.value,
        }),
      catch: fail,
    });
  }),
).pipe(Command.withSubcommands([experimentNewCommand, experimentListCommand, experimentRunCommand]));
