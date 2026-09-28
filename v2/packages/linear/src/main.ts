import type * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import type * as Env from "@oligarchy/env";
import * as jarl from "jarl";
import * as z from "zod";
import * as Queries from "./queries.ts";

export const LinearError = jarl.error.define("LinearError");
export type LinearError = InstanceType<typeof LinearError>;

// Asking again could answer: no answer, no connection, a 429 or a 5xx.
export const LinearUnavailable = jarl.error.define("LinearUnavailable");
export type LinearUnavailable = InstanceType<typeof LinearUnavailable>;

type Answer<T> = Promise<jarl.Result<T, LinearError | LinearUnavailable>>;

export const AGENT_TEST_LABEL = "agent test";
export const ASSIGNEE_EMAIL = "prime@terminal.shop";
export const BACKLOG_STATE = "Backlog";
export const AUTOMATION_NEEDED_STATE = "Automation Needed";
export const IN_PROGRESS_STATE = "In Progress";
export const IN_REVIEW_STATE = "In Review";
export const NEEDS_REVIEW_STATE = "Needs Review";
export const ERRORED_STATE = "Errored";
export const FAILED_STATE = "Failed";
export const SUCCEEDED_STATE = "Succeeded";
export const ABORTED_STATE = "Aborted";
// A ticket in Automation Needed that already has its pending job.
export const READY_LABEL = "ready";

const TicketShape = z.object({ id: z.string(), identifier: z.string(), url: z.string() });
export type Ticket = Readonly<z.infer<typeof TicketShape>>;

const ListedTicketShape = TicketShape.extend({ title: z.string(), updatedAt: z.string() });
export type ListedTicket = Readonly<z.infer<typeof ListedTicketShape>>;

export type CreateIssueInput = {
  readonly teamId: string;
  readonly title: string;
  readonly labelIds: ReadonlyArray<string>;
  readonly assigneeId: string;
  readonly stateId: string;
};

export type WorkflowStateIds = { readonly backlog: string; readonly automationNeeded: string };

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type Linear = {
  readonly service: "linear";
  readonly teamId: () => Answer<string>;
  readonly labelIds: (teamId: string, version: string) => Answer<ReadonlyArray<string>>;
  readonly assigneeId: () => Answer<string>;
  readonly stateIds: (teamId: string) => Answer<WorkflowStateIds>;
  readonly createIssue: (input: CreateIssueInput) => Answer<Ticket>;
  readonly describeIssue: (ticket: Ticket, description: string, stateId: string) => Answer<void>;
  readonly moveIssue: (ticket: Ticket, stateId: string) => Answer<void>;
  readonly issueStateId: (ticket: Ticket) => Answer<string>;
  readonly markReady: (identifier: string) => Answer<void>;
  readonly clearReady: (identifier: string) => Answer<void>;
  readonly moveToErrored: (identifier: string, message: string) => Answer<void>;
  readonly moveToInProgress: (identifier: string) => Answer<void>;
  readonly moveToInReview: (identifier: string) => Answer<void>;
  readonly moveToNeedsReview: (identifier: string) => Answer<void>;
  readonly moveToFailed: (identifier: string) => Answer<void>;
  readonly moveToSucceeded: (identifier: string) => Answer<void>;
  readonly moveToAborted: (identifier: string) => Answer<void>;
  readonly listBacklog: () => Answer<ReadonlyArray<ListedTicket>>;
  readonly listAutomationNeeded: () => Answer<ReadonlyArray<ListedTicket>>;
  readonly listNeedsReview: () => Answer<ReadonlyArray<ListedTicket>>;
};

declare module "@oligarchy/app" {
  interface Services {
    linear: App.Register<"linear", Linear>;
  }
}

// A request Linear never answers must not hold the automation server's dispatch or its watches.
const TIMEOUT_MS = 10_000;

// What Linear answers a label removal from a ticket that does not carry it.
const NOT_LABELED = "linear: Label not on issue";

const Nodes = z.object({ nodes: z.array(z.object({ id: z.string() })) });
const Success = z.object({ success: z.boolean() });
const IssueUpdate = z.object({ issueUpdate: Success });

// `errors` is read before `data` takes a shape, as GraphQL sends both together.
const Envelope = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

const Issues = z.object({
  issues: z.object({
    nodes: z.array(ListedTicketShape),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  }),
});

const refused = (message: string) => jarl.err(new LinearError(message));

const invalid = (cause?: unknown) => {
  const error = new LinearError("linear: invalid response");
  error.cause = cause;
  return jarl.err(error);
};

const first = (found: z.infer<typeof Nodes>, missing: string) => {
  const node = found.nodes[0];
  return node === undefined ? refused(missing) : jarl.ok(node.id);
};

export const create = (options: {
  readonly token: Pick<Env.Secret, "reveal">;
  readonly team: string;
  readonly apiUrl: string;
  readonly fetch?: Fetch;
}): Linear => {
  const { token, team, apiUrl, fetch: send = fetch } = options;

  const ask = async <S extends z.ZodType>(
    query: string,
    variables: Readonly<Record<string, unknown>>,
    shape: S,
    signal: AbortSignal,
  ): Answer<z.infer<S>> => {
    let response: Response;
    try {
      response = await send(apiUrl, {
        method: "POST",
        // Linear personal API keys take no `Bearer`.
        headers: { Authorization: token.reveal(), "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal,
      });
    } catch (caught) {
      const error = new LinearUnavailable("linear: request failed");
      error.cause = caught;
      return jarl.err(error);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const message = `linear: request failed (${String(response.status)})${text === "" ? "" : `: ${text}`}`;
      const busy = response.status === 429 || response.status >= 500;
      return jarl.err(busy ? new LinearUnavailable(message) : new LinearError(message));
    }
    const body = await jarl.parseJSON(response.text());
    if (!body.ok) {
      return invalid(body.error);
    }
    const envelope = Envelope.safeParse(body.value);
    if (!envelope.success) {
      return invalid(envelope.error);
    }
    const { data, errors } = envelope.data;
    if (errors !== undefined && errors.length > 0) {
      return refused(`linear: ${errors.map((error) => error.message).join("; ")}`);
    }
    const decoded = shape.safeParse(data);
    return decoded.success ? jarl.ok(decoded.data) : invalid(decoded.error);
  };

  const request = async <S extends z.ZodType>(
    query: string,
    variables: Readonly<Record<string, unknown>>,
    shape: S,
  ): Answer<z.infer<S>> => {
    const answer = await Async.timeout((signal) => ask(query, variables, shape, signal), {
      ms: TIMEOUT_MS,
    });
    return jarl.error.is(answer, Async.TimedOut)
      ? jarl.err(new LinearUnavailable("linear: request failed: no answer within 10 seconds"))
      : answer;
  };

  const update = async (
    id: string,
    input: Readonly<Record<string, unknown>>,
    failed: string,
  ): Answer<void> => {
    const updated = await request(Queries.ISSUE_UPDATE, { id, input }, IssueUpdate);
    if (!updated.ok) {
      return updated;
    }
    return updated.value.issueUpdate.success ? jarl.ok(undefined) : refused(failed);
  };

  const findTeam = async (): Answer<string> => {
    const found = await request(Queries.TEAM, { name: team }, z.object({ teams: Nodes }));
    return found.ok ? first(found.value.teams, `linear: no team named ${team}`) : found;
  };

  const labelId = async (teamId: string, name: string): Answer<string> => {
    const found = await request(Queries.LABEL, { name, teamId }, z.object({ issueLabels: Nodes }));
    if (!found.ok) {
      return found;
    }
    const existing = found.value.issueLabels.nodes[0];
    if (existing !== undefined) {
      return jarl.ok(existing.id);
    }
    const created = await request(
      Queries.LABEL_CREATE,
      { input: { name, teamId } },
      z.object({
        issueLabelCreate: Success.extend({ issueLabel: z.object({ id: z.string() }).nullable() }),
      }),
    );
    if (!created.ok) {
      return created;
    }
    const { success, issueLabel } = created.value.issueLabelCreate;
    return success && issueLabel !== null
      ? jarl.ok(issueLabel.id)
      : refused("linear: label creation failed");
  };

  const stateNamed = async (teamId: string, name: string): Answer<string> => {
    const found = await request(
      Queries.STATE,
      { name, teamId },
      z.object({ workflowStates: Nodes }),
    );
    return found.ok ? first(found.value.workflowStates, `linear: no state named ${name}`) : found;
  };

  const moveTo = (identifier: string, stateName: string, stateId: string): Answer<void> =>
    update(identifier, { stateId }, `linear: moving ${identifier} to ${stateName} failed`);

  // Looked up on their own, not in stateIds: `test run` and `mint` must not need the columns the
  // automation server moves a ticket through.
  const moveByName =
    (stateName: string) =>
    async (identifier: string): Answer<void> => {
      const found = await findTeam();
      if (!found.ok) {
        return found;
      }
      const stateId = await stateNamed(found.value, stateName);
      return stateId.ok ? moveTo(identifier, stateName, stateId.value) : stateId;
    };

  // The id does not change for the life of the process. Callers asking at once share one lookup,
  // and a failed lookup is not kept, so the next ticket asks again.
  let ready: Answer<string> | undefined;
  const readyLabelId = (): Answer<string> => {
    ready ??= findTeam()
      .then((found) => (found.ok ? labelId(found.value, READY_LABEL) : found))
      .then((answer) => {
        if (!answer.ok) {
          ready = undefined;
        }
        return answer;
      });
    return ready;
  };

  const listOnTeam = async (
    filter: Readonly<Record<string, unknown>>,
  ): Answer<ReadonlyArray<ListedTicket>> => {
    // A name Linear does not have lists nothing rather than failing, so the team is asked first.
    const found = await findTeam();
    if (!found.ok) {
      return found;
    }
    const tickets: Array<ListedTicket> = [];
    let after: string | undefined;
    for (;;) {
      const page = await request(
        Queries.ISSUES,
        after === undefined ? { filter } : { filter, after },
        Issues,
      );
      if (!page.ok) {
        return page;
      }
      tickets.push(...page.value.issues.nodes);
      const { hasNextPage, endCursor } = page.value.issues.pageInfo;
      if (!hasNextPage) {
        return jarl.ok(tickets);
      }
      if (endCursor === null) {
        return invalid();
      }
      after = endCursor;
    }
  };

  const onState = (name: string) => ({
    team: { name: { eq: team } },
    state: { name: { eq: name } },
  });

  return {
    service: "linear",

    teamId: findTeam,

    labelIds: async (teamId, version) => {
      const agentTest = await labelId(teamId, AGENT_TEST_LABEL);
      if (!agentTest.ok) {
        return agentTest;
      }
      const versioned = await labelId(teamId, version);
      return versioned.ok ? jarl.ok([agentTest.value, versioned.value]) : versioned;
    },

    assigneeId: async () => {
      const found = await request(
        Queries.ASSIGNEE,
        { email: ASSIGNEE_EMAIL },
        z.object({ users: Nodes }),
      );
      return found.ok ? first(found.value.users, `linear: no user ${ASSIGNEE_EMAIL}`) : found;
    },

    stateIds: async (teamId) => {
      const backlog = await stateNamed(teamId, BACKLOG_STATE);
      if (!backlog.ok) {
        return backlog;
      }
      const automationNeeded = await stateNamed(teamId, AUTOMATION_NEEDED_STATE);
      return automationNeeded.ok
        ? jarl.ok({ backlog: backlog.value, automationNeeded: automationNeeded.value })
        : automationNeeded;
    },

    createIssue: async (input) => {
      const created = await request(
        Queries.ISSUE_CREATE,
        { input },
        z.object({ issueCreate: Success.extend({ issue: TicketShape.nullable() }) }),
      );
      if (!created.ok) {
        return created;
      }
      const { success, issue } = created.value.issueCreate;
      return success && issue !== null ? jarl.ok(issue) : refused("linear: issue creation failed");
    },

    // The body and the move land in one update, so the ticket is never in the new state without it.
    describeIssue: (ticket, description, stateId) =>
      update(ticket.id, { description, stateId }, `linear: describing ${ticket.identifier} failed`),

    // State only: a description of "" would wipe a body the caller does not have.
    moveIssue: (ticket, stateId) =>
      update(ticket.id, { stateId }, `linear: moving ${ticket.identifier} failed`),

    issueStateId: async (ticket) => {
      const found = await request(
        Queries.ISSUE_STATE,
        { id: ticket.id },
        z.object({ issue: z.object({ state: z.object({ id: z.string() }) }) }),
      );
      return found.ok ? jarl.ok(found.value.issue.state.id) : found;
    },

    markReady: async (identifier) => {
      const id = await readyLabelId();
      if (!id.ok) {
        return id;
      }
      return update(
        identifier,
        { addedLabelIds: [id.value] },
        `linear: labeling ${identifier} ready failed`,
      );
    },

    // A ticket whose label never landed is already clear.
    clearReady: async (identifier) => {
      const id = await readyLabelId();
      if (!id.ok) {
        return id;
      }
      const cleared = await update(
        identifier,
        { removedLabelIds: [id.value] },
        `linear: clearing ${identifier} ready failed`,
      );
      return !cleared.ok && cleared.error.message === NOT_LABELED ? jarl.ok(undefined) : cleared;
    },

    // The move lands before the comment, so a retry after a refused comment moves nothing new.
    moveToErrored: async (identifier, message) => {
      const moved = await moveByName(ERRORED_STATE)(identifier);
      if (!moved.ok) {
        return moved;
      }
      const commented = await request(
        Queries.COMMENT_CREATE,
        { input: { issueId: identifier, body: message } },
        z.object({ commentCreate: Success }),
      );
      if (!commented.ok) {
        return commented;
      }
      return commented.value.commentCreate.success
        ? jarl.ok(undefined)
        : refused(`linear: commenting on ${identifier} failed`);
    },

    moveToInProgress: moveByName(IN_PROGRESS_STATE),
    moveToInReview: moveByName(IN_REVIEW_STATE),
    moveToNeedsReview: moveByName(NEEDS_REVIEW_STATE),
    moveToFailed: moveByName(FAILED_STATE),
    moveToSucceeded: moveByName(SUCCEEDED_STATE),

    // The state is the ticket's own team's: the dashboard aborts by identifier alone, knowing the
    // ticket and not the board.
    moveToAborted: async (identifier) => {
      const found = await request(
        Queries.TICKET_STATE,
        { ticket: identifier, state: ABORTED_STATE },
        z.object({ issue: z.object({ team: z.object({ states: Nodes }) }) }),
      );
      if (!found.ok) {
        return found;
      }
      const stateId = first(
        found.value.issue.team.states,
        `linear: no state named ${ABORTED_STATE}`,
      );
      return stateId.ok ? moveTo(identifier, ABORTED_STATE, stateId.value) : stateId;
    },

    listBacklog: () =>
      listOnTeam({ team: { name: { eq: team } }, state: { type: { eq: "backlog" } } }),

    listAutomationNeeded: () =>
      listOnTeam({
        ...onState(AUTOMATION_NEEDED_STATE),
        labels: { or: [{ null: true }, { every: { name: { neq: READY_LABEL } } }] },
      }),

    listNeedsReview: () => listOnTeam(onState(NEEDS_REVIEW_STATE)),
  };
};
