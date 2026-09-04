import { readFileSync } from "node:fs";

const LINEAR_API_URL = "https://api.linear.app/graphql";
const AGENT_TEST_LABEL = "agent test";
const SUB_AGENT = "Grok 4.6 high fast (cursor-grok-4.6-high-fast)";

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

export type LinearBacklogTicket = LinearTicket & {
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
      throw new Error(`linear: prompts/${file} uses {{${name}}}, which has no value`);
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
    CTRL_MD: readFileSync(new URL("../ctrl-linear.md", import.meta.url), "utf8").trimEnd(),
    SUB_AGENT,
  });
}

export function drivingAgentPrompt(ticket: string, serverUrl: string): string {
  return renderPrompt("driving-agent.html", { LINEAR_TICKET: ticket, SERVER_URL: serverUrl });
}

async function linearRequest<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
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

export async function linearTeamId(token: string): Promise<string> {
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

export async function linearLabelIds(token: string, teamId: string, version: string): Promise<string[]> {
  return [await linearLabelId(token, teamId, AGENT_TEST_LABEL), await linearLabelId(token, teamId, version)];
}

export async function createLinearTicket(token: string, experiment: Experiment, test: ExperimentTest): Promise<LinearTicket> {
  const teamId = await linearTeamId(token);
  const ticket = await createLinearIssue(token, teamId, await linearLabelIds(token, teamId, experiment.version), test);
  await describeLinearIssue(token, ticket, experiment, test);
  return ticket;
}

export async function createLinearIssue(
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
export async function describeLinearIssue(
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

export async function listLinearBacklog(token: string): Promise<LinearBacklogTicket[]> {
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
