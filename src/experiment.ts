import { loadEnvFile } from "node:process";
import { Effect, Schema } from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";
import { eq, sql } from "drizzle-orm";
import { closeDatabase, connectDatabase, type Db } from "./db/ops.ts";
import { flushLogs, log } from "./db/log.ts";
import { testDefinitions, testResults, testRuns } from "./db/schema.ts";

const LINEAR_API_URL = "https://api.linear.app/graphql";

const HttpsUrl = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      if (!URL.canParse(value)) {
        return false;
      }
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname !== "";
    },
    { message: "experiment: iso must be a valid https url" },
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
    { message: "experiment: server_url must be a valid http or https url" },
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

type LinearResponse<T> = {
  data?: T;
  errors?: { message: string }[];
};

export function linearTicketDescription(experiment: Experiment, test: ExperimentTest): string {
  return `# ${test.name}

- Result ID: \`${test.id}\`
- Test suite run: \`${experiment.id}\`
- ISO: ${experiment.iso}
- Server URL: ${experiment.serverUrl}

**Description**

${test.description}

**Instruction**

${test.instruction}

**Proof**

${test.proof}`;
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
    "query ExperimentLabel($name: String!, $teamId: String!) { issueLabels(filter: { name: { eq: $name }, team: { id: { eq: $teamId } } }, first: 1) { nodes { id } } }",
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
  return createLinearIssue(token, teamId, await linearLabelIds(token, teamId, experiment.version), experiment, test);
}

async function createLinearIssue(
  token: string,
  teamId: string,
  labelIds: string[],
  experiment: Experiment,
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
        description: linearTicketDescription(experiment, test),
        labelIds,
      },
    },
  );
  if (!result.issueCreate.success || result.issueCreate.issue === null) {
    throw new Error("linear: issue creation failed");
  }
  return result.issueCreate.issue;
}

export async function createExperiment(
  db: Db,
  token: string,
  input: { iso: string; serverUrl: string; version: string },
): Promise<{ experiment: Experiment; tickets: LinearTicket[] }> {
  const definitions = await db.select().from(testDefinitions).orderBy(testDefinitions.name);
  if (definitions.length === 0) {
    throw new Error("experiment: no test definitions found");
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
      tickets.push(await createLinearIssue(token, teamId, labelIds, experiment, test));
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
    `experiment ${experiment.id} created; ${experiment.tests.length} tests; ${tickets.map((ticket) => ticket.identifier).join(", ")}`,
  );
  await flushLogs();
  return { experiment, tickets };
}

export async function newExperiment(input: { iso: string; serverUrl: string; version: string }): Promise<void> {
  loadEnvFile();

  const token = process.env.LINEAR_API_TOKEN;
  if (token === undefined || token === "") {
    throw new Error("experiment: LINEAR_API_TOKEN is not set");
  }

  const db = connectDatabase();
  try {
    const result = await createExperiment(db, token, input);
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

export const experimentNewCommand = Command.make(
  "new",
  {
    iso: Flag.string("iso").pipe(
      Flag.withSchema(HttpsUrl),
      Flag.withDescription("HTTPS URL of the ISO"),
    ),
    serverUrl: Flag.string("server_url").pipe(
      Flag.withSchema(HttpUrl),
      Flag.withDescription("HTTP or HTTPS URL of the oligarchy server"),
    ),
    version: Flag.string("version").pipe(
      Flag.withSchema(Schema.NonEmptyString),
      Flag.withDescription("Version label attached to every Linear ticket"),
    ),
  },
  Effect.fn(function* ({ iso, serverUrl, version }) {
    yield* Effect.tryPromise({
      try: () => newExperiment({ iso, serverUrl, version }),
      catch: fail,
    });
  }),
);

export const experimentCommand = Command.make("experiment").pipe(
  Command.withSubcommands([experimentNewCommand]),
);
