import {
  Array as Arr,
  Clock,
  Console,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
  Stdio,
  Stream,
} from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";
import type { HttpClient } from "effect/unstable/http";
import * as ProxyClient from "../client/proxy-client.ts";
import * as Config from "../config.ts";
import * as Actions from "../db/actions.ts";
import * as Client from "../db/client.ts";
import * as Logs from "../db/logs.ts";
import * as Sessions from "../db/sessions.ts";
import * as Tests from "../db/tests.ts";
import * as Log from "../observability/log.ts";
import * as Errors from "../shared/errors.ts";
import * as Cursor from "./cursor.ts";
import * as Linear from "./linear.ts";
import * as Render from "./render.ts";

// ---------------------------------------------------------------------------
// Dependencies: the live layers, replaceable by fakes in tests
// ---------------------------------------------------------------------------

export type Stores =
  | Sessions.SessionStore
  | Actions.ActionStore
  | Logs.LogStore
  | Tests.TestStore
  | Log.Log;

// The one proxy call ctrl makes; the full client is WP-5's.
export type DumpClient = {
  readonly dump: (
    id: string,
  ) => Effect.Effect<Uint8Array, Errors.ProxyRefusal | Errors.ProxyUnreachable>;
};

export type ConnectProxy = (options: {
  readonly serverUrl: string;
  readonly token: Redacted.Redacted;
}) => Effect.Effect<DumpClient, never, HttpClient.HttpClient>;

export type Deps = {
  readonly database: (url: Redacted.Redacted) => Layer.Layer<Stores, Errors.DatabaseError>;
  readonly linear: (
    token: Redacted.Redacted,
  ) => Layer.Layer<Linear.Linear, never, HttpClient.HttpClient>;
  readonly cursor: (apiKey: Redacted.Redacted) => Layer.Layer<Cursor.CursorAgents>;
  readonly proxy: ConnectProxy;
};

// Log sits above the stores so its flush finalizer runs before the pool closes.
const databaseLayers = (url: Redacted.Redacted): Layer.Layer<Stores, Errors.DatabaseError> =>
  Layer.mergeAll(
    Sessions.SessionStore.layer,
    Actions.ActionStore.layer,
    Tests.TestStore.layer,
    Log.Log.layer.pipe(Layer.provideMerge(Logs.LogStore.layer)),
  ).pipe(Layer.provide(Client.Database.layer(url)));

export const live: Deps = {
  database: databaseLayers,
  linear: Linear.Linear.layer,
  cursor: Cursor.CursorAgents.layer,
  proxy: ProxyClient.connect,
};

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

const HttpUrl = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      if (!URL.canParse(value)) {
        return false;
      }
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
    },
    { message: "server-url must be a valid http or https url" },
  ),
);

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

const Count = Schema.Number.check(
  Schema.isGreaterThanOrEqualTo(1, { message: "count must be at least 1" }),
);

const DEFAULT_COUNT = 10;

// Declared by every action that talks about a proxy; test run does not, its driver reads the url
// from the ticket. No default: SERVER_URL or the flag, or a usage error.
const serverUrlFlag = Flag.string("server-url").pipe(
  Flag.withFallbackConfig(Config.serverUrl),
  Flag.withSchema(HttpUrl),
  Flag.withDescription("Oligarchy server URL; SERVER_URL when omitted"),
);

const sessionIdFlag = Flag.string("session-id").pipe(
  Flag.withSchema(Schema.NonEmptyString),
  Flag.withDescription("Session id"),
);

const nameFlag = (description: string) =>
  Flag.string("name").pipe(
    Flag.withSchema(Schema.NonEmptyString),
    Flag.optional,
    Flag.withDescription(description),
  );

const toggle = (name: string, description: string) =>
  Flag.boolean(name).pipe(Flag.withDefault(false), Flag.withDescription(description));

// `--list` is the verb of the bare form and required: absent, the parse reports the missing flag.
const list = Flag.boolean("list").pipe(
  Flag.withDefault(Effect.fail(new CliError.MissingOption({ option: "list" }))),
  Flag.withDescription("List stored test definitions"),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const refuse = (message: string) => Errors.CommandError.make({ message });

// The value of an Option, or the refusal the operator reads when it is absent.
const orRefuse = <A, E, R>(
  self: Effect.Effect<Option.Option<A>, E, R>,
  message: string,
): Effect.Effect<A, E | Errors.CommandError, R> =>
  Effect.flatMap(
    self,
    Option.match({
      onNone: () => Effect.fail(refuse(message)),
      onSome: (value) => Effect.succeed(value),
    }),
  );

const printLines = (lines: ReadonlyArray<string>) =>
  Effect.forEach(lines, (line) => Console.log(line), { discard: true });

const printJson = (value: unknown) => Console.log(Render.json(value));

const noDefinitions = (name: Option.Option<string>): Errors.CommandError =>
  refuse(
    Option.match(name, {
      onNone: () => "test: no test definitions found",
      onSome: (wanted) => `test: no test definition named ${wanted}`,
    }),
  );

// Every definition ordered by name, or the one named; a name that matches nothing is refused,
// an empty table is refused only when the caller needs at least one.
const selectDefinitions = Effect.fn("ctrl.selectDefinitions")(function* (
  name: Option.Option<string>,
  atLeastOne: boolean,
) {
  const tests = yield* Tests.TestStore;
  return yield* Option.match(name, {
    onNone: () => tests.listTestDefinitions,
    onSome: (wanted) => Effect.map(tests.findTestDefinition(wanted), Option.toArray),
  }).pipe(
    Effect.filterOrFail(
      (rows) => rows.length > 0 || (Option.isNone(name) && !atLeastOne),
      () => noDefinitions(name),
    ),
  );
});

const withReason = (error: Errors.LinearError, message: string): Errors.LinearError =>
  Errors.LinearError.make(
    Object.assign(
      { operation: error.operation, message },
      error.status === undefined ? undefined : { status: error.status },
      error.cause === undefined ? undefined : { cause: error.cause },
    ),
  );

// ---------------------------------------------------------------------------
// The command tree
// ---------------------------------------------------------------------------

export const makeCtrlCommand = (deps: Deps = live) => {
  const withDb = Layer.unwrap(Effect.map(Config.databaseUrl, (url) => deps.database(url)));

  // DATABASE_URL is read first so it is the one reported first.
  const withDbAndLinear = Layer.unwrap(
    Effect.gen(function* () {
      const url = yield* Config.databaseUrl;
      const token = yield* Config.linearApiToken;
      return Layer.mergeAll(deps.database(url), deps.linear(token));
    }),
  );

  const withDbAndCursor = Layer.unwrap(
    Effect.gen(function* () {
      const url = yield* Config.databaseUrl;
      const apiKey = yield* Config.cursorApiToken;
      return Layer.mergeAll(deps.database(url), deps.cursor(apiKey));
    }),
  );

  // test --list [--details] [--name <definition>]
  const testDefinitions = Effect.fn("ctrl.test.definitions")(function* (input: {
    readonly details: boolean;
    readonly name: Option.Option<string>;
  }) {
    const rows = yield* selectDefinitions(input.name, false);
    yield* printLines(Render.renderTestDefinitions(rows, input.details));
  });

  // test new --iso <https-url> --version <version> [--name <definition>]
  const testNew = Effect.fn("ctrl.test.new")(function* (input: {
    readonly serverUrl: string;
    readonly iso: string;
    readonly version: string;
    readonly name: Option.Option<string>;
  }) {
    const tests = yield* Tests.TestStore;
    const linear = yield* Linear.Linear;
    const log = yield* Log.Log;

    const definitions = yield* selectDefinitions(input.name, true);
    const created = yield* tests.createRun({
      iso: input.iso,
      serverUrl: input.serverUrl,
      definitions,
    });
    const resultIds = new Map(created.results.map((row) => [row.definitionId, row.id] as const));
    const experiment: Linear.Experiment = {
      id: created.runId,
      iso: input.iso,
      serverUrl: input.serverUrl,
      version: input.version,
      tests: definitions.flatMap((definition) => {
        const id = resultIds.get(definition.id);
        return id === undefined
          ? []
          : [
              {
                id,
                definitionId: definition.id,
                name: definition.name,
                description: definition.description,
                instruction: definition.instruction,
                proof: definition.proof,
              },
            ];
      }),
    };

    const tickets: Array<Linear.LinearTicket> = [];
    const createTickets = Effect.gen(function* () {
      const prompts = yield* Linear.loadPrompts;
      const teamId = yield* linear.teamId;
      const labelIds = yield* linear.labelIds(teamId, experiment.version);
      const assigneeId = yield* linear.assigneeId;
      for (const test of experiment.tests) {
        const ticket = yield* linear.createIssue({
          teamId,
          title: `Omarchy: ${test.name}`,
          labelIds,
          assigneeId,
        });
        tickets.push(ticket);
        const description = yield* Effect.fromResult(
          Linear.linearTicketDescription(experiment, test, ticket.identifier, prompts),
        );
        yield* linear.describeIssue(ticket, description);
      }
    });
    // A Linear failure fails the run and every result with the reason, naming the tickets that
    // did get created so they can be cleaned up by hand.
    yield* createTickets.pipe(
      Effect.catchTag("LinearError", (error) =>
        Effect.gen(function* () {
          const identifiers = tickets.map((ticket) => ticket.identifier).join(", ");
          const reason =
            identifiers === "" ? error.message : `${error.message}; created ${identifiers}`;
          yield* tests.failRun(experiment.id, reason);
          return yield* identifiers === "" ? error : withReason(error, reason);
        }),
      ),
    );

    yield* log.info(
      `test ${experiment.id} created; ${String(experiment.tests.length)} tests; ${tickets.map((ticket) => ticket.identifier).join(", ")}`,
    );
    yield* printJson({
      id: experiment.id,
      tests: experiment.tests.map((test, index) => ({ id: test.id, linear: tickets[index] })),
    });
  });

  // test list
  const testList = Effect.fn("ctrl.test.list")(function* () {
    const linear = yield* Linear.Linear;
    yield* printJson(yield* linear.listBacklog);
  });

  // test run --ticket <linear-ticket>
  const testRun = Effect.fn("ctrl.test.run")(function* (input: { readonly ticket: string }) {
    const agents = yield* Cursor.CursorAgents;
    const prompts = yield* Linear.loadPrompts;
    const text = yield* Effect.fromResult(Linear.drivingAgentPrompt(input.ticket, prompts));
    const { agentId } = yield* agents.prompt(text);
    yield* Console.log(Render.agentLink(Cursor.agentUrl(agentId)));
  });

  // test start --session-id <id> --test-result-id <id>
  const testStart = Effect.fn("ctrl.test.start")(function* (input: {
    readonly sessionId: string;
    readonly testResultId: string;
  }) {
    const sessions = yield* Sessions.SessionStore;
    const tests = yield* Tests.TestStore;
    const log = yield* Log.Log;
    yield* orRefuse(
      sessions.sessionExists(input.sessionId),
      `test start: no session ${input.sessionId}`,
    );
    yield* tests.startResult(input.testResultId, input.sessionId).pipe(
      Effect.filterOrFail(
        (started) => started,
        () => refuse(`test start: result ${input.testResultId} not found or not pending`),
      ),
    );
    yield* log.info(`test result ${input.testResultId}: running`, {
      sessionId: input.sessionId,
    });
  });

  // test-results --agent-id <agent> --id <id> --status success|failed [--reason <text>]
  const testResults = Effect.fn("ctrl.test-results")(function* (input: {
    readonly agentId: string;
    readonly id: string;
    readonly status: "passed" | "failed";
    readonly reason: Option.Option<string>;
  }) {
    const sessions = yield* Sessions.SessionStore;
    const tests = yield* Tests.TestStore;
    const log = yield* Log.Log;
    const agentSession = yield* sessions.sessionForAgent(input.agentId);
    yield* tests
      .closeResult(
        input.id,
        input.status,
        Option.getOrNull(input.reason),
        Option.getOrNull(agentSession),
      )
      .pipe(
        Effect.filterOrFail(
          (closed) => closed,
          () => refuse(`test-results: result ${input.id} not found`),
        ),
      );
    const reason = Option.match(input.reason, {
      onNone: () => "",
      onSome: (text) => `; ${text}`,
    });
    yield* log.info(
      `test result ${input.id}: ${input.status}${reason}`,
      Object.assign(
        { agentId: input.agentId },
        Option.match(agentSession, {
          onNone: () => undefined,
          onSome: (session) => ({ sessionId: session }),
        }),
      ),
    );
  });

  // session list [--count <n>] [--active] [--json]
  const sessionList = Effect.fn("ctrl.session.list")(function* (input: {
    readonly count: number;
    readonly active: boolean;
    readonly json: boolean;
  }) {
    const sessions = yield* Sessions.SessionStore;
    const rows = yield* sessions.listSessions(input.count, input.active);
    const now = yield* Clock.currentTimeMillis;
    yield* printLines(Render.renderSessions(rows, input.json, now));
  });

  // Postgres matched the id however it was cased; the proxy's map and paths hold the canonical
  // form.
  const sessionDump = Effect.fn("ctrl.session.dump")(function* (id: string, server: string) {
    const token = yield* Config.oligarchyToken;
    const sessions = yield* Sessions.SessionStore;
    const canonical = yield* orRefuse(sessions.sessionExists(id), `session: no session ${id}`);
    const proxy = yield* deps.proxy({ serverUrl: server, token });
    const bytes = yield* proxy.dump(canonical);
    const stdio = yield* Stdio.Stdio;
    yield* Stream.run(Stream.make(bytes), stdio.stdout());
  });

  type Selectors = {
    readonly logs: boolean;
    readonly testDef: boolean;
    readonly testResults: boolean;
    readonly actions: boolean;
    readonly all: boolean;
  };

  const sessionJson = Effect.fn("ctrl.session.json")(function* (id: string, input: Selectors) {
    const sessions = yield* Sessions.SessionStore;
    const logs = yield* Logs.LogStore;
    const tests = yield* Tests.TestStore;
    const actions = yield* Actions.ActionStore;
    yield* orRefuse(sessions.sessionExists(id), `session: no session ${id}`);

    const parts: Array<readonly [string, unknown]> = [];
    if (input.all || input.logs) {
      parts.push(["logs", yield* logs.listLogs(id)]);
    }
    if (input.all || input.testResults || input.testDef) {
      const row = yield* tests.resultForSession(id).pipe(
        Effect.filterOrFail(
          (rows) => rows.length <= 1,
          () => refuse(`session: multiple test results for ${id}`),
        ),
        Effect.map(Arr.head),
      );
      if (input.all || input.testResults) {
        parts.push([
          "results",
          Option.match(row, { onNone: () => null, onSome: (joined) => joined.result }),
        ]);
      }
      if (input.all || input.testDef) {
        parts.push([
          "test_definition",
          Option.match(row, { onNone: () => null, onSome: (joined) => joined.definition }),
        ]);
      }
    }
    if (input.all || input.actions) {
      parts.push(["actions", yield* actions.listActions(id)]);
    }
    // One selector prints its bare value; several print an object keyed by selector.
    const single = parts.length === 1 ? parts[0] : undefined;
    yield* printJson(single === undefined ? Object.fromEntries(parts) : single[1]);
  });

  // session --session-id <id> --logs|--test-def|--test-results|--actions|--all|--dump
  const sessionInspect = Effect.fn("ctrl.session.inspect")(function* (
    input: Selectors & {
      readonly serverUrl: string;
      readonly sessionId: string;
      readonly dump: boolean;
    },
  ) {
    const inspecting =
      input.logs || input.testDef || input.testResults || input.actions || input.all;
    if (!inspecting && !input.dump) {
      return yield* refuse(
        "session: --logs, --test-def, --test-results, --actions, --all, or --dump is required",
      );
    }
    if (inspecting && input.dump) {
      return yield* refuse(
        "session: --dump does not combine with --logs, --test-def, --test-results, --actions, or --all",
      );
    }
    return yield* input.dump
      ? sessionDump(input.sessionId, input.serverUrl)
      : sessionJson(input.sessionId, input);
  });

  const testNewCommand = Command.make(
    "new",
    {
      serverUrl: serverUrlFlag,
      iso: Flag.string("iso").pipe(
        Flag.withSchema(HttpsUrl),
        Flag.withDescription("HTTPS URL of the ISO"),
      ),
      version: Flag.string("version").pipe(
        Flag.withSchema(Schema.NonEmptyString),
        Flag.withDescription("Version label attached to every Linear ticket"),
      ),
      name: nameFlag("Create a test for this test definition only"),
    },
    testNew,
  ).pipe(
    Command.withDescription("Create a test run and one Linear ticket per test definition"),
    Command.provide(withDbAndLinear),
  );

  const testListCommand = Command.make("list", { serverUrl: serverUrlFlag }, testList).pipe(
    Command.withDescription("Print the Oligarchy backlog from Linear as JSON"),
    Command.provide(withDbAndLinear),
  );

  const testRunCommand = Command.make(
    "run",
    {
      ticket: Flag.string("ticket").pipe(
        Flag.withSchema(Schema.NonEmptyString),
        Flag.withDescription("Linear ticket the driving agent completes"),
      ),
    },
    testRun,
  ).pipe(
    Command.withDescription("Kick off a Cursor cloud agent that drives one Linear ticket"),
    Command.provide(withDbAndCursor),
  );

  const testStartCommand = Command.make(
    "start",
    {
      serverUrl: serverUrlFlag,
      sessionId: sessionIdFlag,
      testResultId: Flag.string("test-result-id").pipe(
        Flag.withSchema(Schema.NonEmptyString),
        Flag.withDescription("Test result id from the Linear ticket"),
      ),
    },
    testStart,
  ).pipe(
    Command.withDescription("Tie a pending test result to the session that runs it"),
    Command.provide(withDb),
  );

  const testCommand = Command.make(
    "test",
    {
      serverUrl: serverUrlFlag,
      list,
      details: toggle("details", "Print every field as JSON"),
      name: nameFlag("Print this test definition only"),
    },
    testDefinitions,
  ).pipe(
    Command.withDescription(
      "test --list [--details] [--name <definition>]; or new, list, run, start",
    ),
    Command.provide(withDb),
    Command.withSubcommands([testNewCommand, testListCommand, testRunCommand, testStartCommand]),
  );

  const testResultsCommand = Command.make(
    "test-results",
    {
      serverUrl: serverUrlFlag,
      agentId: Flag.string("agent-id").pipe(
        Flag.withSchema(Schema.NonEmptyString),
        Flag.withDescription("Calling agent's id"),
      ),
      id: Flag.string("id").pipe(
        Flag.withSchema(Schema.NonEmptyString),
        Flag.withDescription("Test result id"),
      ),
      status: Flag.choiceWithValue("status", [
        ["success", "passed"],
        ["failed", "failed"],
      ]).pipe(Flag.withDescription("Whether the test succeeded")),
      reason: Flag.string("reason").pipe(
        Flag.optional,
        Flag.withDescription("Why the test passed or failed"),
      ),
    },
    testResults,
  ).pipe(Command.withDescription("Close a test result with its verdict"), Command.provide(withDb));

  const sessionListCommand = Command.make(
    "list",
    {
      serverUrl: serverUrlFlag,
      count: Flag.integer("count").pipe(
        Flag.withSchema(Count),
        Flag.withDefault(DEFAULT_COUNT),
        Flag.withDescription("How many of the most recent sessions to print"),
      ),
      active: toggle("active", "Print only active sessions, running before downloads"),
      json: toggle("json", "Print the sessions as a JSON array"),
    },
    sessionList,
  ).pipe(Command.withDescription("Print the most recent sessions"), Command.provide(withDb));

  const sessionCommand = Command.make(
    "session",
    {
      serverUrl: serverUrlFlag,
      sessionId: sessionIdFlag,
      logs: toggle("logs", "Print session logs"),
      testDef: toggle("test-def", "Print the session's test definition"),
      testResults: toggle("test-results", "Print the session's test result"),
      actions: toggle("actions", "Print session actions"),
      all: toggle("all", "Print logs, test definition, test results, and actions"),
      dump: toggle(
        "dump",
        "Print the session's serial console from the proxy: the running machine's, or what a dead one left on disk",
      ),
    },
    sessionInspect,
  ).pipe(
    Command.withDescription(
      "session --session-id <id> --logs|--test-def|--test-results|--actions|--all|--dump; or list",
    ),
    Command.provide(withDb),
    Command.withSubcommands([sessionListCommand]),
  );

  return Command.make("ctrl").pipe(
    Command.withDescription(
      "Record and inspect Oligarchy test runs. Every action reads DATABASE_URL; every action but test run takes --server-url (or SERVER_URL).",
    ),
    Command.withSubcommands([testCommand, testResultsCommand, sessionCommand]),
  );
};
