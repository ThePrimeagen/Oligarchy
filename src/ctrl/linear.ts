import {
  Array as Arr,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
  SynchronizedRef,
} from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as Config from "../config.ts";
import * as Errors from "../shared/errors.ts";

export const LINEAR_API_URL = Config.DEFAULT_LINEAR_API_URL;
// A request Linear never answers must not hold the automation server's dispatch or its watches.
const REQUEST_TIMEOUT = "10 seconds";
export const AGENT_TEST_LABEL = "agent test";
export const ASSIGNEE_EMAIL = "prime@terminal.shop";
// The two board states a ticket is handed through: born in Backlog, where the automation server
// queues nothing, and moved to Automation Needed once its body and its result's Linear id are
// written, so the webhook that queues the drive can never arrive before that write.
export const BACKLOG_STATE = "Backlog";
export const AUTOMATION_NEEDED_STATE = "Automation Needed";
export const NEEDS_REVIEW_STATE = "Needs Review";
// Where the automation server puts a ticket once a client has reserved it, before /run: a
// drive or mint goes to In Progress, a diagnose to In Review.
export const IN_PROGRESS_STATE = "In Progress";
export const IN_REVIEW_STATE = "In Review";
// Where the automation server puts a ticket the system failed, with a comment saying how.
export const ERRORED_STATE = "Errored";
// A diagnose's verdict is a column, not a job status. Failed is the diagnosis that did not
// land; Succeeded is the one that did. Looked up by name, like Errored, so filing a ticket
// does not require the column to exist.
export const FAILED_STATE = "Failed";
export const SUCCEEDED_STATE = "Succeeded";
// A ticket in Automation Needed that already has its pending job. The watch's list leaves
// these out, so a restart does not keep a map of tickets that are waiting to run.
export const READY_LABEL = "ready";

export const LinearTicket = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  url: Schema.String,
});
export type LinearTicket = typeof LinearTicket.Type;

export const LinearBacklogTicket = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  // Compared as text: an edit is a different string, and that is the whole signal.
  updatedAt: Schema.String,
});
export type LinearBacklogTicket = typeof LinearBacklogTicket.Type;

export type CreateIssueInput = {
  readonly teamId: string;
  readonly title: string;
  readonly labelIds: ReadonlyArray<string>;
  readonly assigneeId: string;
  readonly stateId: string;
};

export type WorkflowStateIds = {
  readonly backlog: string;
  readonly automationNeeded: string;
};

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

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

const ISSUE_UPDATE_MUTATION = `mutation ExperimentIssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
  }
}`;

const COMMENT_CREATE_MUTATION = `mutation ExperimentCommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
  }
}`;

const ISSUES_QUERY = `query ExperimentIssues($filter: IssueFilter!, $after: String) {
  issues(first: 100, after: $after, filter: $filter) {
    nodes {
      id
      identifier
      title
      url
      updatedAt
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

type IssueFilter = {
  readonly team: { readonly name: { readonly eq: string } };
  readonly state:
    | { readonly type: { readonly eq: string } }
    | { readonly name: { readonly eq: string } };
  // Absent labels, or none of them named ready. A ready ticket is already queued.
  readonly labels?: {
    readonly or: ReadonlyArray<
      { readonly null: true } | { readonly every: { readonly name: { readonly neq: string } } }
    >;
  };
};

const Nodes = Schema.Struct({ nodes: Schema.Array(Schema.Struct({ id: Schema.String })) });
const Teams = Schema.Struct({ teams: Nodes });
const Labels = Schema.Struct({ issueLabels: Nodes });
const Users = Schema.Struct({ users: Nodes });
const States = Schema.Struct({ workflowStates: Nodes });
const LabelCreate = Schema.Struct({
  issueLabelCreate: Schema.Struct({
    success: Schema.Boolean,
    issueLabel: Schema.NullOr(Schema.Struct({ id: Schema.String })),
  }),
});
const IssueCreate = Schema.Struct({
  issueCreate: Schema.Struct({ success: Schema.Boolean, issue: Schema.NullOr(LinearTicket) }),
});
const IssueUpdate = Schema.Struct({ issueUpdate: Schema.Struct({ success: Schema.Boolean }) });
const CommentCreate = Schema.Struct({
  commentCreate: Schema.Struct({ success: Schema.Boolean }),
});
const Backlog = Schema.Struct({
  issues: Schema.Struct({
    nodes: Schema.Array(LinearBacklogTicket),
    pageInfo: Schema.Struct({
      hasNextPage: Schema.Boolean,
      endCursor: Schema.NullOr(Schema.String),
    }),
  }),
});

// `errors` is read before `data` takes a shape, as GraphQL sends both together.
const Envelope = Schema.Struct({
  data: Schema.optionalKey(Schema.Unknown),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
});

const decodeEnvelope = HttpClientResponse.schemaBodyJson(Envelope);

const invalidResponse = (operation: string, cause?: unknown): Errors.LinearError =>
  cause === undefined
    ? Errors.LinearError.make({ operation, message: "linear: invalid response" })
    : Errors.LinearError.make({ operation, message: "linear: invalid response", cause });

export type LinearService = {
  readonly teamId: Effect.Effect<string, Errors.LinearError>;
  readonly labelIds: (
    teamId: string,
    version: string,
  ) => Effect.Effect<ReadonlyArray<string>, Errors.LinearError>;
  readonly assigneeId: Effect.Effect<string, Errors.LinearError>;
  readonly stateIds: (teamId: string) => Effect.Effect<WorkflowStateIds, Errors.LinearError>;
  readonly createIssue: (
    input: CreateIssueInput,
  ) => Effect.Effect<LinearTicket, Errors.LinearError>;
  readonly describeIssue: (
    ticket: LinearTicket,
    description: string,
    stateId: string,
  ) => Effect.Effect<void, Errors.LinearError>;
  readonly moveIssue: (
    ticket: LinearTicket,
    stateId: string,
  ) => Effect.Effect<void, Errors.LinearError>;
  // identifier is the OLI shorthand stored on the result. issueUpdate accepts it.
  readonly markReady: (identifier: string) => Effect.Effect<void, Errors.LinearError>;
  readonly clearReady: (identifier: string) => Effect.Effect<void, Errors.LinearError>;
  // The move lands before the comment, so a retry after a refused comment moves nothing new.
  readonly moveToErrored: (
    identifier: string,
    message: string,
  ) => Effect.Effect<void, Errors.LinearError>;
  readonly moveToInProgress: (identifier: string) => Effect.Effect<void, Errors.LinearError>;
  readonly moveToInReview: (identifier: string) => Effect.Effect<void, Errors.LinearError>;
  // The close half of the board. No comment rides along: the column is the record.
  readonly moveToNeedsReview: (identifier: string) => Effect.Effect<void, Errors.LinearError>;
  readonly moveToFailed: (identifier: string) => Effect.Effect<void, Errors.LinearError>;
  readonly moveToSucceeded: (identifier: string) => Effect.Effect<void, Errors.LinearError>;
  readonly listBacklog: Effect.Effect<ReadonlyArray<LinearBacklogTicket>, Errors.LinearError>;
  readonly listAutomationNeeded: Effect.Effect<
    ReadonlyArray<LinearBacklogTicket>,
    Errors.LinearError
  >;
  readonly listNeedsReview: Effect.Effect<ReadonlyArray<LinearBacklogTicket>, Errors.LinearError>;
};

const makeLinear = (
  token: Redacted.Redacted,
  teamName: string,
  apiUrl: string,
): Effect.Effect<LinearService, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    // The header is the raw token: Linear personal API keys take no `Bearer`.
    const request = <S extends Schema.Top>(
      operation: string,
      query: string,
      variables: Readonly<Record<string, unknown>>,
      data: S,
    ): Effect.Effect<S["Type"], Errors.LinearError, S["DecodingServices"]> =>
      Effect.gen(function* () {
        const response = yield* client
          .execute(
            HttpClientRequest.post(apiUrl).pipe(
              HttpClientRequest.setHeader("Authorization", Redacted.value(token)),
              HttpClientRequest.setHeader("Content-Type", "application/json"),
              HttpClientRequest.bodyJsonUnsafe({ query, variables }),
            ),
          )
          .pipe(
            Effect.mapError((error) =>
              Errors.LinearError.make({
                operation,
                message: "linear: request failed",
                cause: error,
              }),
            ),
          );
        if (response.status < 200 || response.status >= 300) {
          const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
          return yield* Errors.LinearError.make({
            operation,
            status: response.status,
            message: `linear: request failed (${String(response.status)})${text === "" ? "" : `: ${text}`}`,
          });
        }
        const envelope = yield* decodeEnvelope(response).pipe(
          Effect.mapError((cause) => invalidResponse(operation, cause)),
        );
        if (envelope.errors !== undefined && envelope.errors.length > 0) {
          return yield* Errors.LinearError.make({
            operation,
            message: `linear: ${envelope.errors.map((error) => error.message).join("; ")}`,
          });
        }
        if (envelope.data === undefined) {
          return yield* invalidResponse(operation);
        }
        return yield* Schema.decodeUnknownEffect(data)(envelope.data).pipe(
          Effect.mapError((cause) => invalidResponse(operation, cause)),
        );
      }).pipe(
        Effect.timeoutOrElse({
          duration: REQUEST_TIMEOUT,
          orElse: () =>
            Errors.LinearError.make({
              operation,
              message: `linear: request failed: no answer within ${REQUEST_TIMEOUT}`,
            }),
        }),
      );

    const teamId: Effect.Effect<string, Errors.LinearError> = Effect.gen(function* () {
      const teams = yield* request("teamId", TEAM_QUERY, { name: teamName }, Teams);
      return yield* Option.match(Arr.head(teams.teams.nodes), {
        onNone: () =>
          Errors.LinearError.make({
            operation: "teamId",
            message: `linear: no team named ${teamName}`,
          }),
        onSome: (found) => Effect.succeed(found.id),
      });
    });

    const labelId = Effect.fn("Linear.labelId")(function* (team: string, name: string) {
      const found = yield* request("labelIds", LABEL_QUERY, { name, teamId: team }, Labels);
      const existing = Arr.head(found.issueLabels.nodes);
      if (Option.isSome(existing)) {
        return existing.value.id;
      }
      const created = yield* request(
        "labelIds",
        LABEL_CREATE_MUTATION,
        { input: { name, teamId: team } },
        LabelCreate,
      );
      if (!created.issueLabelCreate.success || created.issueLabelCreate.issueLabel === null) {
        return yield* Errors.LinearError.make({
          operation: "labelIds",
          message: "linear: label creation failed",
        });
      }
      return created.issueLabelCreate.issueLabel.id;
    });

    const labelIds = Effect.fn("Linear.labelIds")(function* (team: string, version: string) {
      const labels: ReadonlyArray<string> = yield* Effect.all([
        labelId(team, AGENT_TEST_LABEL),
        labelId(team, version),
      ]);
      return labels;
    });

    const assigneeId: Effect.Effect<string, Errors.LinearError> = Effect.gen(function* () {
      const users = yield* request("assigneeId", ASSIGNEE_QUERY, { email: ASSIGNEE_EMAIL }, Users);
      return yield* Option.match(Arr.head(users.users.nodes), {
        onNone: () =>
          Errors.LinearError.make({
            operation: "assigneeId",
            message: `linear: no user ${ASSIGNEE_EMAIL}`,
          }),
        onSome: (user) => Effect.succeed(user.id),
      });
    });

    const stateNamed = Effect.fn("Linear.stateNamed")(function* (team: string, name: string) {
      const found = yield* request("stateIds", STATE_QUERY, { name, teamId: team }, States);
      return yield* Option.match(Arr.head(found.workflowStates.nodes), {
        onNone: () =>
          Errors.LinearError.make({
            operation: "stateIds",
            message: `linear: no state named ${name}`,
          }),
        onSome: (state) => Effect.succeed(state.id),
      });
    });

    const stateIds = Effect.fn("Linear.stateIds")(function* (team: string) {
      const [backlog, automationNeeded] = yield* Effect.all([
        stateNamed(team, BACKLOG_STATE),
        stateNamed(team, AUTOMATION_NEEDED_STATE),
      ]);
      return { backlog, automationNeeded } satisfies WorkflowStateIds;
    });

    const createIssue = Effect.fn("Linear.createIssue")(function* (input: CreateIssueInput) {
      const created = yield* request(
        "createIssue",
        ISSUE_CREATE_MUTATION,
        { input: { ...input } },
        IssueCreate,
      );
      if (!created.issueCreate.success || created.issueCreate.issue === null) {
        return yield* Errors.LinearError.make({
          operation: "createIssue",
          message: "linear: issue creation failed",
        });
      }
      return created.issueCreate.issue;
    });

    // State only. A description of "" would wipe a body the watch does not have.
    const moveIssue = Effect.fn("Linear.moveIssue")(function* (
      ticket: LinearTicket,
      stateId: string,
    ) {
      yield* request(
        "moveIssue",
        ISSUE_UPDATE_MUTATION,
        { id: ticket.id, input: { stateId } },
        IssueUpdate,
      ).pipe(
        Effect.filterOrFail(
          (updated) => updated.issueUpdate.success,
          () =>
            Errors.LinearError.make({
              operation: "moveIssue",
              message: `linear: moving ${ticket.identifier} failed`,
            }),
        ),
      );
    });

    const moveToInProgress = Effect.fn("Linear.moveToInProgress")(function* (identifier: string) {
      const team = yield* teamId;
      const stateId = yield* stateNamed(team, IN_PROGRESS_STATE);
      yield* request(
        "moveToInProgress",
        ISSUE_UPDATE_MUTATION,
        { id: identifier, input: { stateId } },
        IssueUpdate,
      ).pipe(
        Effect.filterOrFail(
          (updated) => updated.issueUpdate.success,
          () =>
            Errors.LinearError.make({
              operation: "moveToInProgress",
              message: `linear: moving ${identifier} to In Progress failed`,
            }),
        ),
      );
    });

    // Looked up on their own, not in stateIds: `test run` and `mint` must not need the columns
    // the automation server moves a ticket through.
    const moveByName = (
      operation: "moveToInReview" | "moveToNeedsReview" | "moveToFailed" | "moveToSucceeded",
      stateName: string,
    ) =>
      Effect.fn(`Linear.${operation}`)(function* (identifier: string) {
        const team = yield* teamId;
        const stateId = yield* stateNamed(team, stateName);
        yield* request(
          operation,
          ISSUE_UPDATE_MUTATION,
          { id: identifier, input: { stateId } },
          IssueUpdate,
        ).pipe(
          Effect.filterOrFail(
            (updated) => updated.issueUpdate.success,
            () =>
              Errors.LinearError.make({
                operation,
                message: `linear: moving ${identifier} to ${stateName} failed`,
              }),
          ),
        );
      });

    const moveToInReview = moveByName("moveToInReview", IN_REVIEW_STATE);
    const moveToNeedsReview = moveByName("moveToNeedsReview", NEEDS_REVIEW_STATE);
    const moveToFailed = moveByName("moveToFailed", FAILED_STATE);
    const moveToSucceeded = moveByName("moveToSucceeded", SUCCEEDED_STATE);

    // Looked up on its own, not in stateIds: `test run` and `mint` must not need an Errored
    // column.
    const moveToErrored = Effect.fn("Linear.moveToErrored")(function* (
      identifier: string,
      message: string,
    ) {
      const team = yield* teamId;
      const stateId = yield* stateNamed(team, ERRORED_STATE);
      yield* request(
        "moveToErrored",
        ISSUE_UPDATE_MUTATION,
        { id: identifier, input: { stateId } },
        IssueUpdate,
      ).pipe(
        Effect.filterOrFail(
          (updated) => updated.issueUpdate.success,
          () =>
            Errors.LinearError.make({
              operation: "moveToErrored",
              message: `linear: moving ${identifier} to Errored failed`,
            }),
        ),
      );
      yield* request(
        "moveToErrored",
        COMMENT_CREATE_MUTATION,
        { input: { issueId: identifier, body: message } },
        CommentCreate,
      ).pipe(
        Effect.filterOrFail(
          (created) => created.commentCreate.success,
          () =>
            Errors.LinearError.make({
              operation: "moveToErrored",
              message: `linear: commenting on ${identifier} failed`,
            }),
        ),
      );
    });

    // Linear assigns the identifier on create, and the description names it as the driver's agent
    // id, so the body can only land in a second call. The move to `stateId` rides in that same
    // update: the ticket is never in Automation Needed without its body.
    const describeIssue = Effect.fn("Linear.describeIssue")(function* (
      ticket: LinearTicket,
      description: string,
      stateId: string,
    ) {
      yield* request(
        "describeIssue",
        ISSUE_UPDATE_MUTATION,
        { id: ticket.id, input: { description, stateId } },
        IssueUpdate,
      ).pipe(
        Effect.filterOrFail(
          (updated) => updated.issueUpdate.success,
          () =>
            Errors.LinearError.make({
              operation: "describeIssue",
              message: `linear: describing ${ticket.identifier} failed`,
            }),
        ),
      );
    });

    const listIssues = (
      operation: "listBacklog" | "listAutomationNeeded" | "listNeedsReview",
      filter: IssueFilter,
    ): Effect.Effect<ReadonlyArray<LinearBacklogTicket>, Errors.LinearError> =>
      Effect.gen(function* () {
        const tickets: Array<LinearBacklogTicket> = [];
        let after: string | undefined;
        while (true) {
          const variables = after === undefined ? { filter } : { filter, after };
          const page = yield* request(operation, ISSUES_QUERY, variables, Backlog);
          tickets.push(...page.issues.nodes);
          if (!page.issues.pageInfo.hasNextPage) {
            return tickets;
          }
          if (page.issues.pageInfo.endCursor === null) {
            return yield* invalidResponse(operation);
          }
          after = page.issues.pageInfo.endCursor;
        }
      });

    const backlogFilter: IssueFilter = {
      team: { name: { eq: teamName } },
      state: { type: { eq: "backlog" } },
    };

    const stateFilter = (name: string): IssueFilter => ({
      team: { name: { eq: teamName } },
      state: { name: { eq: name } },
    });

    // The id does not change for the life of the process. The watches and POST /linear can label
    // at once, so the lookup runs one at a time and a failed lookup is not stored. The next ticket
    // tries again.
    const readyLabel = yield* SynchronizedRef.make<Option.Option<string>>(Option.none());

    const readyLabelId = Effect.fn("Linear.readyLabelId")(function* () {
      return yield* SynchronizedRef.modifyEffect(readyLabel, (cached) =>
        Option.match(cached, {
          onSome: (found) => Effect.succeed([found, cached] as const),
          onNone: () =>
            teamId.pipe(
              Effect.flatMap((team) => labelId(team, READY_LABEL)),
              Effect.map((created) => [created, Option.some(created)] as const),
            ),
        }),
      );
    });

    const setReady = (
      operation: "markReady" | "clearReady",
      id: string,
      input:
        | { readonly addedLabelIds: ReadonlyArray<string> }
        | { readonly removedLabelIds: ReadonlyArray<string> },
      message: string,
    ) =>
      request(operation, ISSUE_UPDATE_MUTATION, { id, input }, IssueUpdate).pipe(
        Effect.filterOrFail(
          (updated) => updated.issueUpdate.success,
          () => Errors.LinearError.make({ operation, message }),
        ),
      );

    const markReady = Effect.fn("Linear.markReady")(function* (identifier: string) {
      const id = yield* readyLabelId();
      yield* setReady(
        "markReady",
        identifier,
        { addedLabelIds: [id] },
        `linear: labeling ${identifier} ready failed`,
      );
    });

    const clearReady = Effect.fn("Linear.clearReady")(function* (identifier: string) {
      const id = yield* readyLabelId();
      yield* setReady(
        "clearReady",
        identifier,
        { removedLabelIds: [id] },
        `linear: clearing ${identifier} ready failed`,
      );
    });

    // A name Linear does not have is an empty list, not an error. Resolve the team first so
    // that mistake is the same refusal as creating a ticket: `linear: no team named <name>`.
    const listOnTeam = (
      operation: "listBacklog" | "listAutomationNeeded" | "listNeedsReview",
      filter: IssueFilter,
    ): Effect.Effect<ReadonlyArray<LinearBacklogTicket>, Errors.LinearError> =>
      teamId.pipe(Effect.flatMap(() => listIssues(operation, filter)));

    const listBacklog = listOnTeam("listBacklog", backlogFilter);
    const listAutomationNeeded = listOnTeam("listAutomationNeeded", {
      ...stateFilter(AUTOMATION_NEEDED_STATE),
      labels: {
        or: [{ null: true }, { every: { name: { neq: READY_LABEL } } }],
      },
    });
    const listNeedsReview = listOnTeam("listNeedsReview", stateFilter(NEEDS_REVIEW_STATE));

    return {
      teamId,
      labelIds,
      assigneeId,
      stateIds,
      createIssue,
      describeIssue,
      moveIssue,
      markReady,
      clearReady,
      moveToErrored,
      moveToInProgress,
      moveToInReview,
      moveToNeedsReview,
      moveToFailed,
      moveToSucceeded,
      listBacklog,
      listAutomationNeeded,
      listNeedsReview,
    } satisfies LinearService;
  });

export class Linear extends Context.Service<Linear>()("@oligarchy/ctrl/Linear", {
  make: makeLinear,
}) {
  static readonly layer = (
    token: Redacted.Redacted,
    teamName: string,
    apiUrl = LINEAR_API_URL,
  ): Layer.Layer<Linear, never, HttpClient.HttpClient> =>
    Layer.effect(this)(this.make(token, teamName, apiUrl));
}
