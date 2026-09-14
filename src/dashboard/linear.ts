// The dashboard's one Linear call: an aborted job's ticket moves to the board's Aborted status, so
// the ticket says what the queue says. Two requests: the issue by its identifier with its team's
// status of that name, then the move by the ids Linear answered with.

export type LinearEnv = {
  // A Cloudflare var beside the automation server's url, so the integration lane can point it at
  // a stub: no test calls Linear.
  readonly LINEAR_API_URL: string;
  // wrangler secret; a personal API key, which Linear takes raw, with no `Bearer`.
  readonly LINEAR_API_TOKEN: string;
};

export const ABORTED_STATE = "Aborted";

// Linear answers in well under this; a stalled request must not hold the operator's 200.
const LINEAR_TIMEOUT_MS = 10_000;

const STATE_QUERY =
  "query AbortedState($ticket: String!, $state: String!) { issue(id: $ticket) { id team { states(filter: { name: { eq: $state } }, first: 1) { nodes { id } } } } }";

const MOVE_MUTATION =
  "mutation AbortIssue($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }";

const messageOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error);

// GraphQL sends errors beside data, so the errors are read before data takes a shape: a ticket
// Linear does not know is a 200 with one error and a null data.
const graphql = async (
  env: LinearEnv,
  operation: string,
  query: string,
  variables: Readonly<Record<string, string>>,
): Promise<unknown> => {
  const response = await fetch(env.LINEAR_API_URL, {
    method: "POST",
    headers: { authorization: env.LINEAR_API_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(LINEAR_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`linear: ${operation} failed (${String(response.status)})`);
  }
  const envelope: unknown = await response.json();
  if (typeof envelope !== "object" || envelope === null) {
    throw new Error(`linear: ${operation}: invalid response`);
  }
  if ("errors" in envelope && Array.isArray(envelope.errors) && envelope.errors.length > 0) {
    throw new Error(`linear: ${operation}: ${envelope.errors.map(messageOf).join("; ")}`);
  }
  if (!("data" in envelope) || typeof envelope.data !== "object" || envelope.data === null) {
    throw new Error(`linear: ${operation}: invalid response`);
  }
  return envelope.data;
};

// With no errors, data has the query's shape by GraphQL's contract; these checks are what
// TypeScript needs to read `{ issue: { id, team: { states: { nodes: [{ id }] } } } }` down to
// the one thing Linear may still leave empty, the team's statuses of that name.
const abortedState = (data: unknown): { readonly id: string; readonly stateId: string } => {
  const issue =
    typeof data === "object" && data !== null && "issue" in data ? data.issue : undefined;
  const id =
    typeof issue === "object" && issue !== null && "id" in issue && typeof issue.id === "string"
      ? issue.id
      : undefined;
  const team =
    typeof issue === "object" && issue !== null && "team" in issue ? issue.team : undefined;
  const states =
    typeof team === "object" && team !== null && "states" in team ? team.states : undefined;
  const nodes =
    typeof states === "object" && states !== null && "nodes" in states ? states.nodes : undefined;
  if (id === undefined || !Array.isArray(nodes)) {
    throw new Error("linear: abortedState: invalid response");
  }
  if (nodes.length === 0) {
    throw new Error(`linear: the ticket's team has no status named ${ABORTED_STATE}`);
  }
  const [first]: ReadonlyArray<unknown> = nodes;
  const stateId =
    typeof first === "object" && first !== null && "id" in first && typeof first.id === "string"
      ? first.id
      : undefined;
  if (stateId === undefined) {
    throw new Error("linear: abortedState: invalid response");
  }
  return { id, stateId };
};

// `{ issueUpdate: { success } }`: Linear says whether the move took.
const moved = (data: unknown): boolean => {
  const update =
    typeof data === "object" && data !== null && "issueUpdate" in data
      ? data.issueUpdate
      : undefined;
  return (
    typeof update === "object" && update !== null && "success" in update && update.success === true
  );
};

// Throws with the reason when the ticket did not move: the route logs it and answers all the same.
export async function abortLinearIssue(env: LinearEnv, ticket: string): Promise<void> {
  const found = abortedState(
    await graphql(env, "abortedState", STATE_QUERY, { ticket, state: ABORTED_STATE }),
  );
  const answer = await graphql(env, "abortIssue", MOVE_MUTATION, {
    id: found.id,
    stateId: found.stateId,
  });
  if (!moved(answer)) {
    throw new Error(`linear: moving ${ticket} to ${ABORTED_STATE} failed`);
  }
}
