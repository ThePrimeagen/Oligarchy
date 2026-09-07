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
import * as DebugLogs from "../db/debug-logs.ts";
import * as Client from "../db/client.ts";
import * as Diagnosis from "../db/diagnosis.ts";
import * as Logs from "../db/logs.ts";
import * as Sessions from "../db/sessions.ts";
import * as Tests from "../db/tests.ts";
import * as Log from "../observability/log.ts";
import * as Contract from "../shared/contract.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";
import * as Cursor from "./cursor.ts";
import * as Linear from "./linear.ts";
import * as Prompts from "./prompts.ts";
import * as Render from "./render.ts";

// ---------------------------------------------------------------------------
// Dependencies: the live layers, replaceable by fakes in tests
// ---------------------------------------------------------------------------

export type Stores =
  | Sessions.SessionStore
  | Actions.ActionStore
  | Logs.LogStore
  | DebugLogs.DebugLogStore
  | Diagnosis.DiagnosisStore
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
    Tests.TestStore.layer,
    DebugLogs.DebugLogStore.layer,
    Diagnosis.DiagnosisStore.layer,
    Log.Log.layer,
  ).pipe(
    Layer.provideMerge(Actions.ActionStore.layer),
    Layer.provideMerge(Logs.LogStore.layer),
    Layer.provide(Client.Database.layer(url)),
  );

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

const modelFlag = (description: string) =>
  Flag.string("model").pipe(
    Flag.withSchema(Schema.NonEmptyString),
    Flag.withDescription(description),
  );

const errorTypeKeyFlag = (name: string, description: string) =>
  Flag.string(name).pipe(Flag.withSchema(Domain.ErrorTypeKey), Flag.withDescription(description));

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
    // createRun inserts one result per definition in the same transaction; a missing one is a
    // broken invariant, never a smaller experiment.
    const experimentTests = yield* Effect.forEach(definitions, (definition) => {
      const id = resultIds.get(definition.id);
      return id === undefined
        ? Effect.die(
            new Error(`test: run ${created.runId} has no result for definition ${definition.name}`),
          )
        : Effect.succeed({
            id,
            definitionId: definition.id,
            name: definition.name,
            description: definition.description,
            instruction: definition.instruction,
            proof: definition.proof,
          });
    });
    const experiment = {
      id: created.runId,
      iso: input.iso,
      serverUrl: input.serverUrl,
      version: input.version,
      tests: experimentTests,
    };

    const tickets: Array<Linear.LinearTicket> = [];
    const createTickets = Effect.gen(function* () {
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
        // Linear assigns the identifier on create, and the body names it as the driver's agent
        // id, so the description can only be rendered once the ticket exists.
        const description = yield* Prompts.render("linear-issue.html", {
          LINEAR_TICKET: ticket.identifier,
          RUN_ID: experiment.id,
          RESULT_ID: test.id,
          VERSION: experiment.version,
          ISO_URL: experiment.iso,
          SERVER_URL: experiment.serverUrl,
          TEST_NAME: test.name,
          TEST_DESCRIPTION: test.description,
          TEST_INSTRUCTION: test.instruction,
          TEST_PROOF: test.proof,
        });
        yield* linear.describeIssue(ticket, description);
      }
    });
    // A failure fails the run and every result with the reason, naming the tickets that did get
    // created so they can be cleaned up by hand; the error goes on carrying that reason.
    const failRunWith = <E extends { readonly message: string }>(
      error: E,
      namingTickets: (reason: string) => E,
    ) =>
      Effect.gen(function* () {
        const identifiers = tickets.map((ticket) => ticket.identifier).join(", ");
        const reason =
          identifiers === "" ? error.message : `${error.message}; created ${identifiers}`;
        yield* tests.failRun(experiment.id, reason);
        return yield* Effect.fail(identifiers === "" ? error : namingTickets(reason));
      });
    yield* createTickets.pipe(
      Effect.catchTags({
        LinearError: (error) => failRunWith(error, (reason) => withReason(error, reason)),
        PromptError: (error) =>
          failRunWith(error, (reason) =>
            Errors.PromptError.make(
              Object.assign(
                { message: reason },
                error.cause === undefined ? undefined : { cause: error.cause },
              ),
            ),
          ),
      }),
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
    const text = yield* Prompts.render("driving-agent.html", { LINEAR_TICKET: input.ticket });
    const { agentId } = yield* agents.prompt(text);
    yield* Console.log(Render.agentLink(Cursor.agentUrl(agentId)));
  });

  // test start --session-id <id> --test-result-id <id> --model <id>
  const testStart = Effect.fn("ctrl.test.start")(function* (input: {
    readonly sessionId: string;
    readonly testResultId: string;
    readonly model: string;
  }) {
    const sessions = yield* Sessions.SessionStore;
    const tests = yield* Tests.TestStore;
    const log = yield* Log.Log;
    yield* orRefuse(
      sessions.sessionExists(input.sessionId),
      `test start: no session ${input.sessionId}`,
    );
    yield* tests.startResult(input.testResultId, input.sessionId, input.model).pipe(
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
    // The agent has no live session on this process, so its colour is taken here for the line.
    yield* log.acquireColor(input.agentId);
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

  // error-type new --key <key> --description <text>
  const errorTypeNew = Effect.fn("ctrl.error-type.new")(function* (input: {
    readonly key: string;
    readonly description: string;
  }) {
    const diagnosis = yield* Diagnosis.DiagnosisStore;
    const log = yield* Log.Log;
    yield* diagnosis.createErrorType(input.key, input.description).pipe(
      Effect.filterOrFail(
        (created) => created,
        () => refuse(`error-type new: ${input.key} already exists`),
      ),
    );
    yield* log.info(`error type created; ${input.key}`);
  });

  // error-type list [--json]
  const errorTypeList = Effect.fn("ctrl.error-type.list")(function* (input: {
    readonly json: boolean;
  }) {
    const diagnosis = yield* Diagnosis.DiagnosisStore;
    const rows = yield* diagnosis.listErrorTypes();
    yield* printLines(Render.renderErrorTypes(rows, input.json));
  });

  // A session is reviewed once it has ended, whatever the driver said about it.
  const endedSession = Effect.fn("ctrl.endedSession")(function* (action: string, id: string) {
    const sessions = yield* Sessions.SessionStore;
    return yield* orRefuse(sessions.getSessionStatus(id), `${action}: no session ${id}`).pipe(
      Effect.filterOrFail(
        (status) => status !== "running" && status !== "downloading",
        (status) => refuse(`${action}: session ${id} is still ${status}`),
      ),
    );
  });

  // diagnose --session-id <id> --verdict passed|failed [--type <key>] --summary <text> --model <id>
  const diagnose = Effect.fn("ctrl.diagnose")(function* (input: {
    readonly sessionId: string;
    readonly verdict: Domain.DiagnosisVerdict;
    readonly type: Option.Option<string>;
    readonly summary: string;
    readonly model: string;
  }) {
    const diagnosis = yield* Diagnosis.DiagnosisStore;
    const log = yield* Log.Log;
    yield* endedSession("diagnose", input.sessionId);
    if (input.verdict === "failed" && Option.isNone(input.type)) {
      return yield* refuse("diagnose: --verdict failed needs --type");
    }
    if (input.verdict === "passed" && Option.isSome(input.type)) {
      return yield* refuse("diagnose: --verdict passed takes no --type");
    }
    if (Option.isSome(input.type)) {
      yield* orRefuse(
        diagnosis.findErrorType(input.type.value),
        `diagnose: no error type ${input.type.value}; create it with ./ctrl error-type new`,
      );
    }
    yield* diagnosis
      .saveDiagnosis({
        sessionId: input.sessionId,
        verdict: input.verdict,
        errorType: Option.getOrNull(input.type),
        summary: input.summary,
        model: input.model,
      })
      .pipe(
        Effect.filterOrFail(
          (saved) => saved,
          () => refuse(`diagnose: session ${input.sessionId} already has a diagnosis`),
        ),
      );
    const cause = Option.match(input.type, {
      onNone: () => "",
      onSome: (key) => `${key}; `,
    });
    return yield* log.info(`diagnosed; ${input.verdict}; ${cause}${input.model}`, {
      sessionId: input.sessionId,
    });
  });

  // diagnose run --session-id <id>
  const diagnoseRun = Effect.fn("ctrl.diagnose.run")(function* (input: {
    readonly serverUrl: string;
    readonly sessionId: string;
  }) {
    const diagnosis = yield* Diagnosis.DiagnosisStore;
    const agents = yield* Cursor.CursorAgents;
    yield* endedSession("diagnose run", input.sessionId);
    // A reviewer whose diagnose would be refused is an agent run wasted: refuse it here instead.
    yield* diagnosis
      .getDiagnosis(input.sessionId)
      .pipe(
        Effect.filterOrFail(Option.isNone, () =>
          refuse(`diagnose run: session ${input.sessionId} already has a diagnosis`),
        ),
      );
    const text = yield* Prompts.render("diagnosing-agent.html", {
      SESSION_ID: input.sessionId,
      SERVER_URL: input.serverUrl,
    });
    const { agentId } = yield* agents.prompt(text);
    yield* Console.log(Render.agentLink(Cursor.agentUrl(agentId)));
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
    readonly status: boolean;
    readonly logs: boolean;
    readonly testDef: boolean;
    readonly testResults: boolean;
    readonly testRun: boolean;
    readonly actions: boolean;
    readonly images: boolean;
    readonly debugLogs: boolean;
    readonly diagnosis: boolean;
    readonly all: boolean;
  };

  const SELECTORS =
    "--status, --logs, --test-def, --test-results, --test-run, --actions, --images, --debug-logs, --diagnosis";

  const sessionJson = Effect.fn("ctrl.session.json")(function* (id: string, input: Selectors) {
    const sessions = yield* Sessions.SessionStore;
    const logs = yield* Logs.LogStore;
    const tests = yield* Tests.TestStore;
    const actions = yield* Actions.ActionStore;
    const debugLogs = yield* DebugLogs.DebugLogStore;
    const diagnosis = yield* Diagnosis.DiagnosisStore;
    const session = yield* orRefuse(sessions.getSession(id), `session: no session ${id}`);

    const parts: Array<readonly [string, unknown]> = [];
    if (input.all || input.status) {
      parts.push(["session", session]);
    }
    if (input.all || input.logs) {
      parts.push(["logs", yield* logs.listLogs(id)]);
    }
    if (input.all || input.testResults || input.testDef || input.testRun) {
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
      if (input.all || input.testRun) {
        parts.push([
          "test_run",
          Option.match(row, { onNone: () => null, onSome: (joined) => joined.run }),
        ]);
      }
    }
    if (input.all || input.actions) {
      parts.push(["actions", yield* actions.listActions(id)]);
    }
    if (input.all || input.images) {
      const rows = yield* actions.listImages(id);
      parts.push([
        "images",
        rows.map((row) => ({
          id: row.id,
          actionId: row.actionId,
          url: Contract.StoredImageUrl(row.id),
          createdAt: row.createdAt,
        })),
      ]);
    }
    if (input.all || input.debugLogs) {
      parts.push(["debug_log", Option.getOrNull(yield* debugLogs.getDebugLog(id))]);
    }
    if (input.all || input.diagnosis) {
      parts.push(["diagnosis", Option.getOrNull(yield* diagnosis.getDiagnosis(id))]);
    }
    // One selector prints its bare value; several print an object keyed by selector.
    const single = parts.length === 1 ? parts[0] : undefined;
    yield* printJson(single === undefined ? Object.fromEntries(parts) : single[1]);
  });

  // session --session-id <id> --status|--logs|--test-def|--test-results|--test-run|--actions|--images|--debug-logs|--diagnosis|--all|--dump
  const sessionInspect = Effect.fn("ctrl.session.inspect")(function* (
    input: Selectors & {
      readonly serverUrl: string;
      readonly sessionId: string;
      readonly dump: boolean;
    },
  ) {
    const inspecting =
      input.status ||
      input.logs ||
      input.testDef ||
      input.testResults ||
      input.testRun ||
      input.actions ||
      input.images ||
      input.debugLogs ||
      input.diagnosis ||
      input.all;
    if (!inspecting && !input.dump) {
      return yield* refuse(`session: ${SELECTORS}, --all, or --dump is required`);
    }
    if (inspecting && input.dump) {
      return yield* refuse(`session: --dump does not combine with ${SELECTORS}, or --all`);
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
      model: modelFlag("Cursor model id that is running this result"),
    },
    testStart,
  ).pipe(
    Command.withDescription("Tie a pending test result to the session and model that run it"),
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
      status: toggle("status", "Print the session row: how it ended, why, and what it booted"),
      logs: toggle("logs", "Print session logs"),
      testDef: toggle("test-def", "Print the session's test definition"),
      testResults: toggle("test-results", "Print the session's test result"),
      testRun: toggle("test-run", "Print the test run the session's result belongs to"),
      actions: toggle("actions", "Print session actions"),
      images: toggle("images", "Print the session's screenshots: id, action, url, when"),
      debugLogs: toggle(
        "debug-logs",
        "Print the session's debug log (serial, proxy, qemu, actions), saved when it did not succeed",
      ),
      diagnosis: toggle("diagnosis", "Print the session's post-run diagnosis, written by diagnose"),
      all: toggle(
        "all",
        "Print the session, logs, test result, definition and run, actions, images, debug log, and diagnosis",
      ),
      dump: toggle(
        "dump",
        "Print the session's serial console from the proxy: the running machine's, or what a dead one left on disk",
      ),
    },
    sessionInspect,
  ).pipe(
    Command.withDescription(
      "session --session-id <id> --status|--logs|--test-def|--test-results|--test-run|--actions|--images|--debug-logs|--diagnosis|--all|--dump; or list",
    ),
    Command.provide(withDb),
    Command.withSubcommands([sessionListCommand]),
  );

  const errorTypeNewCommand = Command.make(
    "new",
    {
      serverUrl: serverUrlFlag,
      key: errorTypeKeyFlag("key", "snake_case key the diagnoses of this type carry"),
      description: Flag.string("description").pipe(
        Flag.withSchema(Schema.NonEmptyString),
        Flag.withDescription("What a failure of this type looks like"),
      ),
    },
    errorTypeNew,
  ).pipe(
    Command.withDescription("Add an error type to the diagnosis vocabulary"),
    Command.provide(withDb),
  );

  const errorTypeListCommand = Command.make(
    "list",
    {
      serverUrl: serverUrlFlag,
      json: toggle("json", "Print the types as a JSON array"),
    },
    errorTypeList,
  ).pipe(
    Command.withDescription("Print every error type with its description, ordered by key"),
    Command.provide(withDb),
  );

  const errorTypeCommand = Command.make("error-type").pipe(
    Command.withDescription("error-type new --key <key> --description <text>; or list"),
    Command.withSubcommands([errorTypeNewCommand, errorTypeListCommand]),
  );

  const diagnoseRunCommand = Command.make(
    "run",
    { serverUrl: serverUrlFlag, sessionId: sessionIdFlag },
    diagnoseRun,
  ).pipe(
    Command.withDescription("Kick off a Cursor cloud agent that reviews one ended session"),
    Command.provide(withDbAndCursor),
  );

  const diagnoseCommand = Command.make(
    "diagnose",
    {
      serverUrl: serverUrlFlag,
      sessionId: sessionIdFlag,
      verdict: Flag.choice("verdict", Domain.DiagnosisVerdict.literals).pipe(
        Flag.withDescription("Whether the proof landed, as the evidence shows it"),
      ),
      type: errorTypeKeyFlag(
        "type",
        "Error type key of a failed verdict; error-type list prints them",
      ).pipe(Flag.optional),
      summary: Flag.string("summary").pipe(
        Flag.withSchema(Schema.NonEmptyString),
        Flag.withDescription("What happened, read from the evidence"),
      ),
      model: modelFlag("Cursor model id that is writing this diagnosis"),
    },
    diagnose,
  ).pipe(
    Command.withDescription(
      "diagnose --session-id <id> --verdict passed|failed [--type <key>] --summary <text> --model <id>; or run",
    ),
    Command.provide(withDb),
    Command.withSubcommands([diagnoseRunCommand]),
  );

  return Command.make("ctrl").pipe(
    Command.withDescription(
      "Record and inspect Oligarchy test runs. Every action reads DATABASE_URL; every action but test run takes --server-url (or SERVER_URL).",
    ),
    Command.withSubcommands([
      testCommand,
      testResultsCommand,
      sessionCommand,
      errorTypeCommand,
      diagnoseCommand,
    ]),
  );
};
