import {
  Array as Arr,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import * as Errors from "../shared/errors.ts";

export const LINEAR_API_URL = "https://api.linear.app/graphql";
export const LINEAR_TEAM = "Oligarchy";
export const AGENT_TEST_LABEL = "agent test";
export const ASSIGNEE_EMAIL = "prime@terminal.shop";
export const SUB_AGENT = "Grok 4.6 high fast (cursor-grok-4.6-high-fast)";

export type ExperimentTest = {
  readonly id: string;
  readonly definitionId: number;
  readonly name: string;
  readonly description: string;
  readonly instruction: string;
  readonly proof: string;
};

export type Experiment = {
  readonly id: string;
  readonly iso: string;
  readonly serverUrl: string;
  readonly version: string;
  readonly tests: ReadonlyArray<ExperimentTest>;
};

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
});
export type LinearBacklogTicket = typeof LinearBacklogTicket.Type;

export type CreateIssueInput = {
  readonly teamId: string;
  readonly title: string;
  readonly labelIds: ReadonlyArray<string>;
  readonly assigneeId: string;
};

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

// The ticket template and the two guides it embeds, read once per `test new`.
export type IssuePrompts = {
  readonly linearIssue: string;
  readonly clientMd: string;
  readonly ctrlMd: string;
};

const LINEAR_ISSUE_FILE = "linear-issue.html";
const DRIVING_AGENT_FILE = "driving-agent.html";

// The files sit beside the package, not the working directory: resolve them from this module.
const besideModule = (relative: string): string =>
  decodeURIComponent(new URL(relative, import.meta.url).pathname);

const PROMPT_PATHS = {
  linearIssue: besideModule(`../../prompts/${LINEAR_ISSUE_FILE}`),
  drivingAgent: besideModule(`../../prompts/${DRIVING_AGENT_FILE}`),
  clientMd: besideModule("../../client.md"),
  ctrlMd: besideModule("../../ctrl-linear.md"),
};

const readPrompt = Effect.fn("Linear.readPrompt")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(path).pipe(
    Effect.mapError((error) =>
      Errors.LinearError.make({
        operation: "prompts",
        message: `linear: ${error.message}`,
        cause: error,
      }),
    ),
  );
});

// `test run` reads its kickoff template alone: the guides `test new` embeds are not its business,
// so an unreadable one cannot stop it.
export const loadDrivingPrompt: Effect.Effect<string, Errors.LinearError, FileSystem.FileSystem> =
  readPrompt(PROMPT_PATHS.drivingAgent);

export const loadIssuePrompts: Effect.Effect<
  IssuePrompts,
  Errors.LinearError,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  return {
    linearIssue: yield* readPrompt(PROMPT_PATHS.linearIssue),
    clientMd: yield* readPrompt(PROMPT_PATHS.clientMd),
    ctrlMd: yield* readPrompt(PROMPT_PATHS.ctrlMd),
  } satisfies IssuePrompts;
});

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

export const renderPrompt = (
  template: string,
  file: string,
  values: Readonly<Record<string, string>>,
): Result.Result<string, Errors.LinearError> => {
  const missing: Array<string> = [];
  const rendered = template.replace(PLACEHOLDER, (match: string, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing.push(name);
      return match;
    }
    return value;
  });
  return Option.match(Arr.head(missing), {
    onNone: () => Result.succeed(rendered),
    onSome: (name) =>
      Result.fail(
        Errors.LinearError.make({
          operation: "renderPrompt",
          message: `linear: prompts/${file} uses {{${name}}}, which has no value`,
        }),
      ),
  });
};

export const linearTicketDescription = (
  experiment: Experiment,
  test: ExperimentTest,
  ticket: string,
  prompts: IssuePrompts,
): Result.Result<string, Errors.LinearError> =>
  renderPrompt(prompts.linearIssue, LINEAR_ISSUE_FILE, {
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
    CLIENT_MD: prompts.clientMd.trimEnd(),
    CTRL_MD: prompts.ctrlMd.trimEnd(),
    SUB_AGENT,
  });

export const drivingAgentPrompt = (
  ticket: string,
  template: string,
): Result.Result<string, Errors.LinearError> =>
  renderPrompt(template, DRIVING_AGENT_FILE, { LINEAR_TICKET: ticket });

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

const BACKLOG_QUERY = `query ExperimentBacklog($filter: IssueFilter!, $after: String) {
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
}`;

const BACKLOG_FILTER = {
  team: { name: { eq: LINEAR_TEAM } },
  state: { type: { eq: "backlog" } },
};

const Nodes = Schema.Struct({ nodes: Schema.Array(Schema.Struct({ id: Schema.String })) });
const Teams = Schema.Struct({ teams: Nodes });
const Labels = Schema.Struct({ issueLabels: Nodes });
const Users = Schema.Struct({ users: Nodes });
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
  readonly createIssue: (
    input: CreateIssueInput,
  ) => Effect.Effect<LinearTicket, Errors.LinearError>;
  readonly describeIssue: (
    ticket: LinearTicket,
    description: string,
  ) => Effect.Effect<void, Errors.LinearError>;
  readonly listBacklog: Effect.Effect<ReadonlyArray<LinearBacklogTicket>, Errors.LinearError>;
};

const makeLinear = (
  token: Redacted.Redacted,
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
            HttpClientRequest.post(LINEAR_API_URL).pipe(
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
      });

    const teamId: Effect.Effect<string, Errors.LinearError> = Effect.gen(function* () {
      const teams = yield* request("teamId", TEAM_QUERY, { name: LINEAR_TEAM }, Teams);
      return yield* Option.match(Arr.head(teams.teams.nodes), {
        onNone: () =>
          Errors.LinearError.make({
            operation: "teamId",
            message: `linear: no team named ${LINEAR_TEAM}`,
          }),
        onSome: (team) => Effect.succeed(team.id),
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

    // Linear assigns the identifier on create, and the description names it as the driver's agent
    // id, so the body can only land in a second call.
    const describeIssue = Effect.fn("Linear.describeIssue")(function* (
      ticket: LinearTicket,
      description: string,
    ) {
      yield* request(
        "describeIssue",
        ISSUE_DESCRIBE_MUTATION,
        { id: ticket.id, input: { description } },
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

    const listBacklog: Effect.Effect<
      ReadonlyArray<LinearBacklogTicket>,
      Errors.LinearError
    > = Effect.gen(function* () {
      const tickets: Array<LinearBacklogTicket> = [];
      let after: string | undefined;
      while (true) {
        const variables =
          after === undefined ? { filter: BACKLOG_FILTER } : { filter: BACKLOG_FILTER, after };
        const page = yield* request("listBacklog", BACKLOG_QUERY, variables, Backlog);
        tickets.push(...page.issues.nodes);
        if (!page.issues.pageInfo.hasNextPage) {
          return tickets;
        }
        if (page.issues.pageInfo.endCursor === null) {
          return yield* invalidResponse("listBacklog");
        }
        after = page.issues.pageInfo.endCursor;
      }
    });

    return {
      teamId,
      labelIds,
      assigneeId,
      createIssue,
      describeIssue,
      listBacklog,
    } satisfies LinearService;
  });

export class Linear extends Context.Service<Linear>()("@oligarchy/ctrl/Linear", {
  make: makeLinear,
}) {
  static readonly layer = (
    token: Redacted.Redacted,
  ): Layer.Layer<Linear, never, HttpClient.HttpClient> => Layer.effect(this)(this.make(token));
}
