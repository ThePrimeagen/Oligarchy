import type * as App from "@oligarchy/app";
import type * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as jarl from "jarl";
import * as z from "zod";
import * as Queries from "./queries.ts";

// Linear's own refusal: a GraphQL error, or a team, label, state or user the board lacks. Final.
export const LinearError = jarl.error.define("LinearError");
export type LinearError = InstanceType<typeof LinearError>;

// Everything else is the request's own failure, as Http made it.
export type LinearFailure = LinearError | Http.HttpFailure;

// Asking again could answer. As Http.retryable, any error may be asked about.
export const retryable = (error: unknown): boolean =>
  !jarl.error.is(error, LinearError) && Http.retryable(error);

type Answer<T> = Promise<jarl.Result<T, LinearFailure>>;

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
// On a ticket while it waits in Automation Needed: it goes on with the move there, and comes off
// with every move out of it.
export const READY_LABEL = "ready";

const TicketShape = z.object({ identifier: z.string(), url: z.string() });
// A ticket is named by its identifier (OLI-42): Linear takes it wherever it takes the issue's id.
export type Ticket = Readonly<z.infer<typeof TicketShape>>;

const ListedTicketShape = TicketShape.extend({ title: z.string(), updatedAt: z.string() });
export type ListedTicket = Readonly<z.infer<typeof ListedTicketShape>>;

// Every step the app takes on the board, and nothing else. Each is whole: the team, labels,
// states and assignee it needs are looked up inside it, once for the life of the process.
export type Linear = {
  readonly service: "linear";
  // Filed on the team, assigned, labeled `agent test` and `label` (the version, or `mint`), in
  // Backlog, where nothing drives it. Never sent twice: a create whose answer was lost may stand.
  readonly createTicket: (input: {
    readonly title: string;
    readonly label: string;
  }) => Answer<Ticket>;
  // The body names the ticket, so it is written once the ticket exists. The column is left alone.
  readonly setDescription: (ticket: string, body: string) => Answer<void>;
  // Ready, and into Automation Needed, in one update.
  readonly readyForAutomation: (ticket: string) => Answer<void>;
  // A drive or mint was placed: out of Automation Needed, so ready comes off, into In Progress.
  readonly startDrive: (ticket: string) => Answer<void>;
  // The drive or mint ran to its end: Needs Review, for its diagnosis.
  readonly readyForReview: (ticket: string) => Answer<void>;
  // A diagnose was placed: In Review.
  readonly startDiagnosis: (ticket: string) => Answer<void>;
  // The diagnosis verdict: passed is Succeeded, failed is Failed.
  readonly markSucceeded: (ticket: string) => Answer<void>;
  readonly markFailed: (ticket: string) => Answer<void>;
  // The system failed the ticket: ready comes off, into Errored, then `reason` as a comment.
  readonly markErrored: (ticket: string, reason: string) => Answer<void>;
  // The ticket's action was aborted: ready comes off, into Aborted.
  readonly markAborted: (ticket: string) => Answer<void>;
  // The team's tickets whose status type is backlog.
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

// A request Linear rate limited is sent once more after this wait; a second 429 is the failure.
// Nothing else is sent again.
export const RATE_LIMIT_WAIT_MS = 5_000;

// What Linear answers a label removal from a ticket that does not carry it. The update carrying
// the removal is refused whole, its move with it.
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

const INVALID = "linear: invalid response";

const invalid = (cause?: unknown) => jarl.err(new Http.HttpInvalid(INVALID, { cause }));

// Reads a GraphQL answer: its errors are Linear's refusal, and its data must be shape.
const decoder =
  <S extends z.ZodType>(shape: S) =>
  (body: unknown): jarl.Result<z.infer<S>, LinearError | Http.HttpInvalid> => {
    const envelope = Envelope.safeParse(body);
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

const first = (found: z.infer<typeof Nodes>, missing: string) => {
  const node = found.nodes[0];
  return node === undefined ? refused(missing) : jarl.ok(node.id);
};

const rateLimited = (error: unknown): boolean =>
  jarl.error.is(error, Http.HttpUnhandled) && error.status === 429;

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// An id by name, kept once Linear gave it: it does not change for the life of the process.
// Callers asking at once share one lookup, and a failed lookup is not kept, so the next asks again.
const kept = <T>(ask: (name: string) => Answer<T>) => {
  const answers = new Map<string, Answer<T>>();
  return (name: string): Answer<T> => {
    const known = answers.get(name);
    if (known !== undefined) {
      return known;
    }
    const asked = ask(name).then((answer) => {
      if (!answer.ok) {
        answers.delete(name);
      }
      return answer;
    });
    answers.set(name, asked);
    return asked;
  };
};

export const create = (options: {
  readonly token: Pick<Env.Secret, "reveal">;
  readonly team: string;
  readonly apiUrl: string;
  readonly http: Http.Http;
}): Linear => {
  const { token, team, apiUrl, http } = options;

  const send = <S extends z.ZodType>(
    query: string,
    variables: Readonly<Record<string, unknown>>,
    shape: S,
  ): Answer<z.infer<S>> =>
    http.fetch(
      apiUrl,
      {
        method: "POST",
        // Linear personal API keys take no `Bearer`.
        headers: { Authorization: token.reveal(), "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        timeoutMs: TIMEOUT_MS,
      },
      { decode: decoder(shape) },
    );

  const request = async <S extends z.ZodType>(
    query: string,
    variables: Readonly<Record<string, unknown>>,
    shape: S,
  ): Answer<z.infer<S>> => {
    const answer = await send(query, variables, shape);
    if (answer.ok || !rateLimited(answer.error)) {
      return answer;
    }
    await wait(RATE_LIMIT_WAIT_MS);
    return send(query, variables, shape);
  };

  const update = async (
    ticket: string,
    input: Readonly<Record<string, unknown>>,
    failed: string,
  ): Answer<void> => {
    const updated = await request(Queries.ISSUE_UPDATE, { id: ticket, input }, IssueUpdate);
    if (!updated.ok) {
      return updated;
    }
    return updated.value.issueUpdate.success ? jarl.ok(undefined) : refused(failed);
  };

  const teams = kept(async (name) => {
    const found = await request(Queries.TEAM, { name }, z.object({ teams: Nodes }));
    return found.ok ? first(found.value.teams, `linear: no team named ${name}`) : found;
  });
  const teamId = () => teams(team);

  // A lookup on the team, which is asked first.
  const onTeam = <T>(ask: (board: string, name: string) => Answer<T>) =>
    kept(async (name) => {
      const found = await teamId();
      return found.ok ? ask(found.value, name) : found;
    });

  // A label the board lacks is created.
  const labelId = onTeam(async (board, name) => {
    const found = await request(
      Queries.LABEL,
      { name, teamId: board },
      z.object({ issueLabels: Nodes }),
    );
    if (!found.ok) {
      return found;
    }
    const existing = found.value.issueLabels.nodes[0];
    if (existing !== undefined) {
      return jarl.ok(existing.id);
    }
    const created = await request(
      Queries.LABEL_CREATE,
      { input: { name, teamId: board } },
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
  });

  // Each column is looked up when first moved into, so filing does not need the columns only the
  // automation server moves a ticket through.
  const stateId = onTeam(async (board, name) => {
    const found = await request(
      Queries.STATE,
      { name, teamId: board },
      z.object({ workflowStates: Nodes }),
    );
    return found.ok ? first(found.value.workflowStates, `linear: no state named ${name}`) : found;
  });

  const assigneeId = kept(async (email) => {
    const found = await request(Queries.ASSIGNEE, { email }, z.object({ users: Nodes }));
    return found.ok ? first(found.value.users, `linear: no user ${email}`) : found;
  });

  // Into `column`, with ready put on, taken off, or left as it is.
  const moveTo =
    (column: string, ready: "on" | "off" | "kept") =>
    async (ticket: string): Answer<void> => {
      const state = await stateId(column);
      if (!state.ok) {
        return state;
      }
      const failed = `linear: moving ${ticket} to ${column} failed`;
      const moved = { stateId: state.value };
      if (ready === "kept") {
        return update(ticket, moved, failed);
      }
      const label = await labelId(READY_LABEL);
      if (!label.ok) {
        return label;
      }
      if (ready === "on") {
        return update(ticket, { ...moved, addedLabelIds: [label.value] }, failed);
      }
      const dropped = await update(ticket, { ...moved, removedLabelIds: [label.value] }, failed);
      return !dropped.ok && dropped.error.message === NOT_LABELED
        ? update(ticket, moved, failed)
        : dropped;
    };

  const listOnTeam = async (
    filter: Readonly<Record<string, unknown>>,
  ): Answer<ReadonlyArray<ListedTicket>> => {
    // A name Linear does not have lists nothing rather than failing, so the team is asked first.
    const found = await teamId();
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

  const toErrored = moveTo(ERRORED_STATE, "off");

  return {
    service: "linear",

    createTicket: async ({ title, label }) => {
      const found = await teamId();
      if (!found.ok) {
        return found;
      }
      const agentTest = await labelId(AGENT_TEST_LABEL);
      if (!agentTest.ok) {
        return agentTest;
      }
      const own = await labelId(label);
      if (!own.ok) {
        return own;
      }
      const assignee = await assigneeId(ASSIGNEE_EMAIL);
      if (!assignee.ok) {
        return assignee;
      }
      const backlog = await stateId(BACKLOG_STATE);
      if (!backlog.ok) {
        return backlog;
      }
      const created = await request(
        Queries.ISSUE_CREATE,
        {
          input: {
            teamId: found.value,
            title,
            labelIds: [agentTest.value, own.value],
            assigneeId: assignee.value,
            stateId: backlog.value,
          },
        },
        z.object({ issueCreate: Success.extend({ issue: TicketShape.nullable() }) }),
      );
      if (!created.ok) {
        return created;
      }
      const { success, issue } = created.value.issueCreate;
      return success && issue !== null ? jarl.ok(issue) : refused("linear: issue creation failed");
    },

    // The body alone: a column in the same update would move a ticket whose body might not land.
    setDescription: (ticket, body) =>
      update(ticket, { description: body }, `linear: describing ${ticket} failed`),

    readyForAutomation: moveTo(AUTOMATION_NEEDED_STATE, "on"),
    startDrive: moveTo(IN_PROGRESS_STATE, "off"),
    readyForReview: moveTo(NEEDS_REVIEW_STATE, "kept"),
    startDiagnosis: moveTo(IN_REVIEW_STATE, "kept"),
    markSucceeded: moveTo(SUCCEEDED_STATE, "kept"),
    markFailed: moveTo(FAILED_STATE, "kept"),

    // The move lands before the comment, so the column says Errored even when the comment fails.
    markErrored: async (ticket, reason) => {
      const moved = await toErrored(ticket);
      if (!moved.ok) {
        return moved;
      }
      const commented = await request(
        Queries.COMMENT_CREATE,
        { input: { issueId: ticket, body: reason } },
        z.object({ commentCreate: Success }),
      );
      if (!commented.ok) {
        return commented;
      }
      return commented.value.commentCreate.success
        ? jarl.ok(undefined)
        : refused(`linear: commenting on ${ticket} failed`);
    },

    markAborted: moveTo(ABORTED_STATE, "off"),

    listBacklog: () =>
      listOnTeam({ team: { name: { eq: team } }, state: { type: { eq: "backlog" } } }),
    listAutomationNeeded: () => listOnTeam(onState(AUTOMATION_NEEDED_STATE)),
    listNeedsReview: () => listOnTeam(onState(NEEDS_REVIEW_STATE)),
  };
};
