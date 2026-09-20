import * as Sentry from "@sentry/cloudflare";
import clientMd from "../../client.md";
import ctrlLinearMd from "../../ctrl-linear.md";
import linearIssue from "../../prompts/linear-issue.html";
import type { LinearEnv } from "./linear.ts";
import {
  createTestSuite,
  failTestSuite,
  setResultLinearId,
  type CreatedSuite,
  type SuiteResult,
} from "./query.ts";

// What Linear calls a ticket by, matching src/ctrl/linear.ts. A ticket opened here is one
// `./ctrl test suite` would open: same team, same labels, same assignee, same two states.
export const SUITE_LINEAR = {
  team: "Oligarchy",
  agentTestLabel: "agent test",
  assigneeEmail: "prime@terminal.shop",
  backlogState: "Backlog",
  automationNeededState: "Automation Needed",
} as const;

// The same preamble ctrl's prompt renderer fills {{SUB_AGENT}} with.
const SUB_AGENT = "Grok 4.6 high fast (cursor-grok-4.6-high-fast)";

// Linear answers well under this. A stalled call must not hold the worker for the whole suite.
const LINEAR_TIMEOUT_MS = 10_000;

const REQUIRED = "iso, version and serverUrl are required";

const TEAM_QUERY =
  "query ExperimentTeam($name: String!) { teams(filter: { name: { eq: $name } }, first: 1) { nodes { id } } }";

const LABEL_QUERY =
  "query ExperimentLabel($name: String!, $teamId: ID!) { issueLabels(filter: { name: { eq: $name }, team: { id: { eq: $teamId } } }, first: 1) { nodes { id } } }";

const LABEL_CREATE_MUTATION = `mutation ExperimentLabelCreate($input: IssueLabelCreateInput!) {
  issueLabelCreate(input: $input) {
    success
    issueLabel {
      id
    }
  }
}`;

const ASSIGNEE_QUERY =
  "query ExperimentAssignee($email: String!) { users(filter: { email: { eq: $email } }, first: 1) { nodes { id } } }";

const STATE_QUERY =
  "query ExperimentState($name: String!, $teamId: ID!) { workflowStates(filter: { name: { eq: $name }, team: { id: { eq: $teamId } } }, first: 1) { nodes { id } } }";

const ISSUE_CREATE_MUTATION = `mutation ExperimentIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      url
    }
  }
}`;

const ISSUE_DESCRIBE_MUTATION = `mutation ExperimentIssueDescribe($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
  }
}`;

// A body the route can refuse before it touches the database or Linear.
export class SuiteRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuiteRequestError";
  }
}

export type SuiteTicket = {
  readonly id: string;
  readonly identifier: string;
  readonly url: string;
};

export type SuiteResponse = {
  readonly id: string;
  readonly tests: ReadonlyArray<{ readonly id: string; readonly linear: SuiteTicket }>;
};

type SuiteRequest = {
  readonly iso: string;
  readonly version: string;
  readonly serverUrl: string;
};

// What a test ticket asks for, keyed as prompts/linear-issue.html spells it.
type TicketValues = {
  readonly LINEAR_TICKET: string;
  readonly RUN_ID: string;
  readonly RESULT_ID: string;
  readonly VERSION: string;
  readonly ISO_URL: string;
  readonly SERVER_URL: string;
  readonly TEST_NAME: string;
  readonly TEST_DESCRIPTION: string;
  readonly TEST_INSTRUCTION: string;
  readonly TEST_PROOF: string;
};

const GUIDES: Readonly<Record<string, string>> = {
  CLIENT_MD: clientMd,
  CTRL_MD: ctrlLinearMd,
};

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const objectFields = (value: unknown): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown): { readonly [key: string]: unknown } | undefined =>
  objectFields(value) ? value : undefined;

const withHost = (value: string, protocol: "http:" | "https:"): boolean => {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return url.protocol === protocol && url.hostname !== "";
};

const isHttpsUrl = (value: string): boolean => withHost(value, "https:");

const isHttpUrl = (value: string): boolean => withHost(value, "http:") || withHost(value, "https:");

// The same fill ctrl's prompt renderer does: guides only when the template names them, trimmed
// so the template's closing tag sits under the guide, and the first missing name fails it.
export function renderSuiteTicket(values: TicketValues): string {
  const known: Record<string, string> = { SUB_AGENT, ...values };
  for (const [name, text] of Object.entries(GUIDES)) {
    if (linearIssue.includes(`{{${name}}}`)) {
      known[name] = text.trimEnd();
    }
  }
  const missing: Array<string> = [];
  const filled = linearIssue.replace(PLACEHOLDER, (match: string, name: string) => {
    const value = known[name];
    if (value === undefined) {
      missing.push(name);
      return match;
    }
    return value;
  });
  const [name] = missing;
  if (name !== undefined) {
    throw new Error(`prompt: prompts/linear-issue.html uses {{${name}}}, which has no value`);
  }
  return filled;
}

const messageOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error);

// Ctrl's GraphQL envelope, without Effect: errors before data, a non-2xx is the status and body.
const linearData = async (
  env: LinearEnv,
  query: string,
  variables: Readonly<Record<string, unknown>>,
): Promise<unknown> => {
  const response = await fetch(env.LINEAR_API_URL, {
    method: "POST",
    headers: { authorization: env.LINEAR_API_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(LINEAR_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `linear: request failed (${String(response.status)})${text === "" ? "" : `: ${text}`}`,
    );
  }
  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch (error) {
    throw new Error("linear: invalid response", { cause: error });
  }
  const box = record(envelope);
  if (box === undefined) {
    throw new Error("linear: invalid response");
  }
  if (Array.isArray(box.errors) && box.errors.length > 0) {
    throw new Error(`linear: ${box.errors.map(messageOf).join("; ")}`);
  }
  if (!("data" in box) || record(box.data) === undefined) {
    throw new Error("linear: invalid response");
  }
  return box.data;
};

// The first node's id, or undefined when Linear answered an empty nodes array. Anything else
// is not the shape these queries return.
const firstNodeId = (data: unknown, key: string): string | undefined => {
  const group = record(record(data)?.[key]);
  if (group === undefined || !("nodes" in group) || !Array.isArray(group.nodes)) {
    throw new Error("linear: invalid response");
  }
  const [first] = group.nodes;
  if (first === undefined) {
    return undefined;
  }
  const id = record(first)?.id;
  if (typeof id !== "string") {
    throw new Error("linear: invalid response");
  }
  return id;
};

const teamId = async (env: LinearEnv): Promise<string> => {
  const id = firstNodeId(await linearData(env, TEAM_QUERY, { name: SUITE_LINEAR.team }), "teams");
  if (id === undefined) {
    throw new Error(`linear: no team named ${SUITE_LINEAR.team}`);
  }
  return id;
};

const labelId = async (env: LinearEnv, team: string, name: string): Promise<string> => {
  const existing = firstNodeId(
    await linearData(env, LABEL_QUERY, { name, teamId: team }),
    "issueLabels",
  );
  if (existing !== undefined) {
    return existing;
  }
  const created = record(
    record(await linearData(env, LABEL_CREATE_MUTATION, { input: { name, teamId: team } }))
      ?.issueLabelCreate,
  );
  const label = record(created?.issueLabel);
  if (created?.success !== true || label === undefined) {
    throw new Error("linear: label creation failed");
  }
  if (typeof label.id !== "string") {
    throw new Error("linear: invalid response");
  }
  return label.id;
};

const assigneeId = async (env: LinearEnv): Promise<string> => {
  const id = firstNodeId(
    await linearData(env, ASSIGNEE_QUERY, { email: SUITE_LINEAR.assigneeEmail }),
    "users",
  );
  if (id === undefined) {
    throw new Error(`linear: no user ${SUITE_LINEAR.assigneeEmail}`);
  }
  return id;
};

const stateId = async (env: LinearEnv, team: string, name: string): Promise<string> => {
  const id = firstNodeId(
    await linearData(env, STATE_QUERY, { name, teamId: team }),
    "workflowStates",
  );
  if (id === undefined) {
    throw new Error(`linear: no state named ${name}`);
  }
  return id;
};

const createIssue = async (
  env: LinearEnv,
  input: {
    readonly teamId: string;
    readonly title: string;
    readonly labelIds: ReadonlyArray<string>;
    readonly assigneeId: string;
    readonly stateId: string;
  },
): Promise<SuiteTicket> => {
  const created = record(
    record(await linearData(env, ISSUE_CREATE_MUTATION, { input }))?.issueCreate,
  );
  const issue = record(created?.issue);
  if (created?.success !== true || issue === undefined) {
    throw new Error("linear: issue creation failed");
  }
  if (
    typeof issue.id !== "string" ||
    typeof issue.identifier !== "string" ||
    typeof issue.url !== "string"
  ) {
    throw new Error("linear: invalid response");
  }
  return { id: issue.id, identifier: issue.identifier, url: issue.url };
};

// The move to Automation Needed rides with the body, so a ticket is never there without it.
const describeIssue = async (
  env: LinearEnv,
  ticket: SuiteTicket,
  description: string,
  state: string,
): Promise<void> => {
  const updated = record(
    record(
      await linearData(env, ISSUE_DESCRIBE_MUTATION, {
        id: ticket.id,
        input: { description, stateId: state },
      }),
    )?.issueUpdate,
  );
  if (updated?.success !== true) {
    throw new Error(`linear: describing ${ticket.identifier} failed`);
  }
};

const suiteRequest = (body: unknown): SuiteRequest => {
  const box = record(body);
  const iso = box?.iso;
  const version = box?.version;
  const serverUrl = box?.serverUrl;
  if (
    typeof iso !== "string" ||
    iso === "" ||
    typeof version !== "string" ||
    version === "" ||
    typeof serverUrl !== "string" ||
    serverUrl === ""
  ) {
    throw new SuiteRequestError(REQUIRED);
  }
  if (!isHttpsUrl(iso)) {
    throw new SuiteRequestError("iso must be a valid https url");
  }
  if (!isHttpUrl(serverUrl)) {
    throw new SuiteRequestError("serverUrl must be a valid http or https url");
  }
  return { iso, version, serverUrl };
};

const withCreated = (message: string, identifiers: ReadonlyArray<string>): string =>
  identifiers.length === 0 ? message : `${message}; created ${identifiers.join(", ")}`;

// A ticket created and not moved stays in Backlog, where nothing drives it. The line is the
// one ctrl reports, so the same failure reads the same in Sentry.
const noteTrapped = (identifier: string, message: string): void => {
  const text = `ticket trapped in Backlog; ${message}`;
  Sentry.captureException(new Error(text));
  console.error(`dashboard: ${text}`, identifier);
};

const failQuietly = async (
  connectionString: string,
  runId: string,
  reason: string,
): Promise<void> => {
  try {
    await failTestSuite(connectionString, runId, reason);
  } catch (error) {
    console.error("dashboard: failing the test suite:", errorMessage(error));
  }
};

const openTickets = async (
  env: LinearEnv,
  connectionString: string,
  request: SuiteRequest,
  created: CreatedSuite,
): Promise<ReadonlyArray<SuiteTicket>> => {
  const tickets: Array<SuiteTicket> = [];
  try {
    const team = await teamId(env);
    const labels = [
      await labelId(env, team, SUITE_LINEAR.agentTestLabel),
      await labelId(env, team, request.version),
    ];
    const assignee = await assigneeId(env);
    const backlog = await stateId(env, team, SUITE_LINEAR.backlogState);
    const automationNeeded = await stateId(env, team, SUITE_LINEAR.automationNeededState);
    for (const result of created.results) {
      const ticket = await createIssue(env, {
        teamId: team,
        title: `Omarchy: ${result.name}`,
        labelIds: labels,
        assigneeId: assignee,
        stateId: backlog,
      });
      tickets.push(ticket);
      try {
        await handOff(
          env,
          connectionString,
          request,
          created.runId,
          result,
          ticket,
          automationNeeded,
        );
      } catch (error) {
        noteTrapped(ticket.identifier, errorMessage(error));
        throw error;
      }
    }
    return tickets;
  } catch (error) {
    const reason = withCreated(
      errorMessage(error),
      tickets.map((ticket) => ticket.identifier),
    );
    await failQuietly(connectionString, created.runId, reason);
    throw new Error(reason, { cause: error });
  }
};

// linear_id is written before the ticket leaves Backlog, so the webhook that queues the drive
// cannot arrive before the row knows its identifier.
const handOff = async (
  env: LinearEnv,
  connectionString: string,
  request: SuiteRequest,
  runId: string,
  result: SuiteResult,
  ticket: SuiteTicket,
  automationNeeded: string,
): Promise<void> => {
  await setResultLinearId(connectionString, result.id, ticket.identifier);
  const description = renderSuiteTicket({
    LINEAR_TICKET: ticket.identifier,
    RUN_ID: runId,
    RESULT_ID: result.id,
    VERSION: request.version,
    ISO_URL: request.iso,
    SERVER_URL: request.serverUrl,
    TEST_NAME: result.name,
    TEST_DESCRIPTION: result.description,
    TEST_INSTRUCTION: result.instruction,
    TEST_PROOF: result.proof,
  });
  await describeIssue(env, ticket, description, automationNeeded);
};

// The JSON `./ctrl test suite` prints: the run id, and each result with the ticket that drives it.
export async function startTestSuite(
  env: LinearEnv,
  connectionString: string,
  body: unknown,
): Promise<SuiteResponse> {
  const request = suiteRequest(body);
  const created = await createTestSuite(connectionString, request);
  if (created === null) {
    throw new SuiteRequestError("test: no test definitions found");
  }
  const tickets = await openTickets(env, connectionString, request, created);
  return {
    id: created.runId,
    tests: created.results.map((result, index) => {
      const linear = tickets[index];
      if (linear === undefined) {
        throw new Error(`startTestSuite: no ticket for ${result.name}`);
      }
      return { id: result.id, linear };
    }),
  };
}
