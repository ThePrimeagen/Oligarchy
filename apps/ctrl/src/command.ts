import { Array as Arr, Clock, Console, Effect, Layer, Option, Redacted, Schema } from "effect";
import * as CliError from "effect/unstable/cli/CliError";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import * as Actions from "@oligarchy/db/actions";
import * as Automation from "@oligarchy/db/automation";
import * as Client from "@oligarchy/db/client";
import * as DebugLogs from "@oligarchy/db/debug-logs";
import * as Diagnosis from "@oligarchy/db/diagnosis";
import * as DbErrors from "@oligarchy/db/errors";
import * as Logs from "@oligarchy/db/logs";
import * as Servers from "@oligarchy/db/servers";
import * as Sessions from "@oligarchy/db/sessions";
import * as Tests from "@oligarchy/db/tests";
import * as Config from "@oligarchy/env/config";
import * as EnvFile from "@oligarchy/env/env-file";
import * as Open from "@oligarchy/jobs/open";
import * as Linear from "@oligarchy/linear/client";
import * as Log from "@oligarchy/log/log";
import * as Observability from "@oligarchy/observability/log";
import * as Contract from "@oligarchy/http/contract";
import * as ProxyClient from "@oligarchy/http/proxy-client";
import * as Domain from "@oligarchy/shared/domain";
import * as SharedErrors from "@oligarchy/shared/errors";
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
  | Automation.AutomationStore
  | Servers.ServerStore
  | Log.Log;

// ctrl is the record keeper: every read and write is a database call, and Linear is the remote
// service it reaches. It avoids calling a server for any data that is in the database; only data
// that is ephemeral and machine-specific, stored nowhere but in the state of the machine itself,
// is asked of the reverse proxy — today that is one call, `mint --unminted`'s GET /minted.
export type Deps = {
  readonly database: (url: Redacted.Redacted) => Layer.Layer<Stores, DbErrors.DatabaseError>;
  readonly linear: (
    token: Redacted.Redacted,
    team: string,
  ) => Layer.Layer<Linear.Linear, never, HttpClient.HttpClient>;
};

// Log sits above the stores so its flush finalizer runs before the pool closes.
const databaseLayers = (url: Redacted.Redacted): Layer.Layer<Stores, DbErrors.DatabaseError> =>
  Layer.mergeAll(
    Sessions.SessionStore.layer,
    Tests.TestStore.layer,
    Automation.AutomationStore.layer,
    DebugLogs.DebugLogStore.layer,
    Diagnosis.DiagnosisStore.layer,
    Servers.ServerStore.layer,
    Observability.LogLive,
  ).pipe(
    Layer.provideMerge(Actions.ActionStore.layer),
    Layer.provideMerge(Logs.LogStore.layer),
    Layer.provide(Client.Database.layer(url)),
  );

export const live: Deps = {
  database: databaseLayers,
  linear: Linear.Linear.layer,
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

// test run and test run testsuite store it on the run and write it into every ticket for ./client. mint
// takes the same flag, for the reverse proxy the install's drivers talk to. No default: SERVER_URL
// or the flag, or a usage error.
const serverUrlFlag = Flag.string("server-url").pipe(
  Flag.withFallbackConfig(Config.serverUrl),
  Flag.withSchema(HttpUrl),
  Flag.withDescription("QEMU server the driving agents talk to; SERVER_URL when omitted"),
);

// Tickets written before --server-url left ctrl still name it on test start and test-results, and
// a driver runs its ticket's lines as written: those two accept it and never read it.
const legacyServerUrlFlag = Flag.string("server-url").pipe(
  Flag.optional,
  Flag.withDescription("Ignored; tickets written before it went still name it"),
);

// The flag wins; SESSION_ID stands in when it is omitted, so a shell exports the id once.
const sessionIdFlag = Flag.string("session-id").pipe(
  Flag.withFallbackConfig(Config.sessionId),
  Flag.withSchema(Schema.NonEmptyString),
  Flag.withDescription("Session id; SESSION_ID when omitted"),
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

const refuse = (message: string) => SharedErrors.CommandError.make({ message });

// The value of an Option, or the refusal the operator reads when it is absent.
const orRefuse = <A, E, R>(
  self: Effect.Effect<Option.Option<A>, E, R>,
  message: string,
): Effect.Effect<A, E | SharedErrors.CommandError, R> =>
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

// ---------------------------------------------------------------------------
// The command tree
// ---------------------------------------------------------------------------

export const makeCtrlCommand = (deps: Deps = live) => {
  const withDb = Layer.unwrap(Effect.map(Config.databaseUrl, (url) => deps.database(url)));

  // Sequential on purpose: DATABASE_URL, then LINEAR_API_TOKEN, then LINEAR_TEAM.
  const withDbAndLinear = Layer.unwrap(
    Effect.gen(function* () {
      const url = yield* Config.databaseUrl;
      const { token, team } = yield* Config.linearAccess;
      return Layer.mergeAll(deps.database(url), deps.linear(token, team));
    }),
  );

  // test --list [--details] [--name <definition>] [--history]
  const testDefinitions = Effect.fn("ctrl.test.definitions")(function* (input: {
    readonly details: boolean;
    readonly name: Option.Option<string>;
    readonly history: boolean;
  }) {
    const tests = yield* Tests.TestStore;
    const lines = input.history
      ? yield* tests.listTestDefinitionHistory(input.name).pipe(
          Effect.filterOrFail(
            (wordings) => wordings.length > 0 || Option.isNone(input.name),
            () => Open.noDefinitions(input.name),
          ),
          Effect.map((wordings) => Render.renderTestDefinitionHistory(wordings, input.details)),
        )
      : Render.renderTestDefinitions(
          yield* Open.selectDefinitions(input.name, false),
          input.details,
        );
    yield* printLines(lines);
  });

  // test details --name <definition>
  const testDetails = Effect.fn("ctrl.test.details")(function* (input: { readonly name: string }) {
    const tests = yield* Tests.TestStore;
    const wordings = yield* tests.listTestDefinitionHistory(Option.some(input.name));
    if (!Arr.isReadonlyArrayNonEmpty(wordings)) {
      return yield* Open.noDefinitions(Option.some(input.name));
    }
    return yield* printLines(Render.renderTestDefinitionDetails(wordings));
  });

  // test define --name <definition> [--description <text>] [--instruction <text>] [--proof <text>]
  const testDefine = Effect.fn("ctrl.test.define")(function* (input: {
    readonly name: string;
    readonly description: Option.Option<string>;
    readonly instruction: Option.Option<string>;
    readonly proof: Option.Option<string>;
  }) {
    const tests = yield* Tests.TestStore;
    const log = yield* Log.Log;
    const current = yield* tests.findTestDefinition(input.name);
    const wording = yield* Option.match(current, {
      // A new name is written whole.
      onNone: () =>
        Option.match(
          Option.all({
            description: input.description,
            instruction: input.instruction,
            proof: input.proof,
          }),
          {
            onNone: () =>
              Effect.fail(
                refuse(
                  "test define: a new definition needs --description, --instruction and --proof",
                ),
              ),
            onSome: Effect.succeed,
          },
        ),
      // A known name carries forward what was not given; the same text again is not a new wording.
      onSome: (latest) => {
        const next = {
          description: Option.getOrElse(input.description, () => latest.description),
          instruction: Option.getOrElse(input.instruction, () => latest.instruction),
          proof: Option.getOrElse(input.proof, () => latest.proof),
        };
        return next.description === latest.description &&
          next.instruction === latest.instruction &&
          next.proof === latest.proof
          ? Effect.fail(refuse(`test define: ${input.name} is unchanged`))
          : Effect.succeed(next);
      },
    });
    const defined = yield* tests.defineTestDefinition({ name: input.name, ...wording });
    yield* log.info(
      `test definition defined; ${input.name} v${String(defined.version)}; id ${String(defined.id)}`,
    );
    yield* printJson({ id: defined.id, name: input.name, version: defined.version });
  });

  // test run --name <definition>, and test run testsuite, which passes no name: the run and its
  // tickets, as Jobs.open made them.
  const openRun = Effect.fn("ctrl.test.run")(function* (input: {
    readonly serverUrl: string;
    readonly iso: string;
    readonly version: string;
    readonly name: Option.Option<string>;
  }) {
    yield* printJson(yield* Open.open(input));
  });

  // mint --iso <https-url> [--unminted]
  //
  // Not a test: one install per live qemu server, each a ticket pinned to its server, so that
  // server ends up holding the iso's minted disk for every later test to boot. The install is
  // still a run with one result, because that is what a driver ties its session to and what the
  // automation queue dispatches; the `mint` definition holds the install's wording once.
  // `--unminted` tickets only the servers that lack the disk, by the reverse proxy's GET /minted:
  // the one server call ctrl makes, for the one fact that lives nowhere but on the machines.
  const mint = Effect.fn("ctrl.mint")(function* (input: {
    readonly serverUrl: string;
    readonly iso: string;
    readonly unminted: boolean;
  }) {
    // Configuration before work: after DATABASE_URL, LINEAR_API_TOKEN and LINEAR_TEAM (the
    // command's layers, the same order as every ctrl command), the bearer is the next variable
    // reported, and it is refused before any query or Linear call.
    const token = input.unminted ? Option.some(yield* Config.oligarchyToken) : Option.none();
    const servers = yield* Servers.ServerStore;
    const log = yield* Log.Log;

    const definition = yield* Open.mintDefinition();
    const fleet = yield* servers.listLiveServers("qemu").pipe(
      Effect.filterOrFail(
        (rows) => rows.length > 0,
        () => refuse("mint: no live qemu server"),
      ),
    );
    // With --unminted, every live server must have answered the proxy: a minted one is skipped,
    // an unminted one ticketed, and one with no answer of its own stops the command before
    // anything is created — a mint it silently missed would be the failure this flag exists to
    // redo.
    const targets = yield* Option.match(token, {
      onNone: () => Effect.succeed(fleet),
      onSome: (bearer) =>
        Effect.gen(function* () {
          const answer = yield* ProxyClient.minted(
            { serverUrl: input.serverUrl, token: bearer },
            input.iso,
          );
          const state = (url: string) => answer.servers.find((row) => row.url === url)?.state;
          for (const target of fleet) {
            const known = state(target.url);
            if (known !== "minted" && known !== "unminted") {
              return yield* refuse(
                `mint: ${target.url} did not answer /minted; --unminted needs every live qemu server to answer`,
              );
            }
          }
          const skipped = fleet.filter((target) => state(target.url) === "minted");
          if (skipped.length > 0) {
            yield* log.info(
              `mint ${input.iso} already minted; ${String(skipped.length)} servers skipped; ${skipped.map((target) => target.url).join(", ")}`,
            );
          }
          return fleet.filter((target) => state(target.url) === "unminted");
        }),
    });
    // A failure fails the run it was creating and names the tickets that stand, as `test run`
    // does; the runs already whole for earlier servers are left standing, they are complete.
    return yield* printJson(
      yield* Open.openMints({
        iso: input.iso,
        serverUrl: input.serverUrl,
        definition,
        servers: targets.map((target) => target.url),
      }),
    );
  });

  // test list
  const testList = Effect.fn("ctrl.test.list")(function* () {
    const linear = yield* Linear.Linear;
    yield* printJson(yield* linear.listBacklog);
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
      location: input.sessionId,
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
    const closed = yield* tests.closeResult(
      input.id,
      input.status,
      Option.getOrNull(input.reason),
      Option.getOrNull(agentSession),
    );
    if (!closed) {
      const found = yield* tests.findResult(input.id);
      return yield* refuse(
        Option.match(found, {
          onNone: () => `test-results: result ${input.id} not found`,
          onSome: (row) => `test-results: result ${input.id} is ${row.status}`,
        }),
      );
    }
    const reason = Option.match(input.reason, {
      onNone: () => "",
      onSome: (text) => `; ${text}`,
    });
    return yield* log.info(
      `test result ${input.id}: ${input.status}${reason}`,
      Object.assign(
        { agentId: input.agentId },
        Option.match(agentSession, {
          onNone: () => undefined,
          onSome: (session) => ({ location: session }),
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
      location: input.sessionId,
    });
  });

  // automation --list [--count <n>]
  const automationList = Effect.fn("ctrl.automation.list")(function* (input: {
    readonly count: number;
  }) {
    const automation = yield* Automation.AutomationStore;
    const queue = yield* automation.listJobs(input.count);
    const now = yield* Clock.currentTimeMillis;
    yield* printLines(Render.renderAutomationJobs(queue, now));
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

  // session --search --test-result-id <id>: the id of the session that ran the result, as one bare
  // line a shell captures into SESSION_ID for the commands that follow.
  const sessionSearch = Effect.fn("ctrl.session.search")(function* (resultId: string) {
    const tests = yield* Tests.TestStore;
    const row = yield* orRefuse(tests.findResult(resultId), `session: no test result ${resultId}`);
    if (row.sessionId === null) {
      return yield* refuse(`session: result ${resultId} has no session yet`);
    }
    return yield* Console.log(row.sessionId);
  });

  // session --session-id <id>|--agent-id <ticket> --status|--logs|--test-def|--test-results|--test-run|--actions|--images|--debug-logs|--diagnosis|--all
  // session --search --test-result-id <id>
  // The ticket names its result, and the result names the session it ran in.
  const sessionOfAgent = Effect.fn("ctrl.session.ofAgent")(function* (agentId: string) {
    const tests = yield* Tests.TestStore;
    const row = yield* orRefuse(
      tests.findResultByLinearId(agentId),
      `session: no test result for ${agentId}`,
    );
    if (row.sessionId === null) {
      return yield* refuse(`session: ${agentId} has no session yet`);
    }
    return row.sessionId;
  });

  const sessionInspect = Effect.fn("ctrl.session.inspect")(function* (input: {
    readonly sessionId: Option.Option<string>;
    readonly agentId: Option.Option<string>;
    readonly search: boolean;
    readonly testResultId: Option.Option<string>;
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
  }) {
    const selected =
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
    // A search names its session through the result: a parsed --session-id or SESSION_ID has no
    // say in it.
    if (input.search) {
      const resultId = yield* orRefuse(
        Effect.succeed(input.testResultId),
        "session: --search needs --test-result-id",
      );
      if (selected) {
        return yield* refuse("session: --search takes no selector");
      }
      if (Option.isSome(input.agentId)) {
        return yield* refuse("session: --search takes no --agent-id");
      }
      return yield* sessionSearch(resultId);
    }
    if (Option.isSome(input.testResultId)) {
      return yield* refuse("session: --test-result-id needs --search");
    }
    if (Option.isNone(input.agentId) && Option.isNone(input.sessionId)) {
      return yield* refuse("session: --session-id, SESSION_ID or --agent-id is required");
    }
    if (!selected) {
      return yield* refuse(
        "session: --status, --logs, --test-def, --test-results, --test-run, --actions, --images, --debug-logs, --diagnosis, or --all is required",
      );
    }
    // --agent-id names the session through its ticket: a parsed --session-id or SESSION_ID has no
    // say in it.
    const id = Option.isSome(input.agentId)
      ? yield* sessionOfAgent(input.agentId.value)
      : Option.getOrElse(input.sessionId, () => "");
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
    return yield* printJson(single === undefined ? Object.fromEntries(parts) : single[1]);
  });

  // A field of a definition's wording: given, it is written; absent on a known name, the newest
  // wording's value is carried forward.
  const wordingFlag = (name: string, description: string) =>
    Flag.string(name).pipe(
      Flag.withSchema(Schema.NonEmptyString),
      Flag.optional,
      Flag.withDescription(description),
    );

  const testDefineCommand = Command.make(
    "define",
    {
      name: Flag.string("name").pipe(
        Flag.withSchema(Schema.NonEmptyString),
        Flag.withDescription("Test definition name; a known name gets a new wording"),
      ),
      description: wordingFlag("description", "What the test is about"),
      instruction: wordingFlag("instruction", "What the driver does"),
      proof: wordingFlag("proof", "What must be on screen for the test to pass"),
    },
    testDefine,
  ).pipe(
    Command.withDescription(
      "Define a test, or a new wording of one; a wording is never edited in place",
    ),
    Command.provide(withDb),
  );

  const testDetailsCommand = Command.make(
    "details",
    {
      name: Flag.string("name").pipe(
        Flag.withSchema(Schema.NonEmptyString),
        Flag.withDescription("Test definition name"),
      ),
    },
    testDetails,
  ).pipe(
    Command.withDescription(
      "Print a test's newest version, when it was added, and its description, instruction and proof",
    ),
    Command.provide(withDb),
  );

  // test run testsuite --server-url <url> --iso <https-url> --version <version>
  //
  // Every definition but mint, each its newest wording. A name cannot be picked; one definition is
  // `test run --name`, and omitting --name there is a usage error.
  const testRunTestSuiteCommand = Command.make(
    "testsuite",
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
    },
    (input) => openRun({ ...input, name: Option.none() }),
  ).pipe(
    Command.withDescription(
      "Create one test run for every definition but mint, each in its newest wording, and one Linear ticket each",
    ),
    Command.provide(withDbAndLinear),
  );

  const testRunCommand = Command.make(
    "run",
    {
      name: Flag.string("name").pipe(
        Flag.withSchema(Schema.NonEmptyString),
        Flag.withDescription("The one test definition to run, in its newest wording"),
      ),
      serverUrl: serverUrlFlag,
      iso: Flag.string("iso").pipe(
        Flag.withSchema(HttpsUrl),
        Flag.withDescription("HTTPS URL of the ISO"),
      ),
      version: Flag.string("version").pipe(
        Flag.withSchema(Schema.NonEmptyString),
        Flag.withDescription("Version label attached to the Linear ticket"),
      ),
    },
    (input) => openRun({ ...input, name: Option.some(input.name) }),
  ).pipe(
    Command.withDescription(
      "test run --name <definition> --server-url <url> --iso <https-url> --version <version>; or testsuite",
    ),
    Command.provide(withDbAndLinear),
    Command.withSubcommands([testRunTestSuiteCommand]),
  );

  const testListCommand = Command.make("list", {}, testList).pipe(
    Command.withDescription("Print LINEAR_TEAM's backlog from Linear as JSON"),
    Command.provide(withDbAndLinear),
  );

  const mintCommand = Command.make(
    "mint",
    {
      serverUrl: serverUrlFlag,
      iso: Flag.string("iso").pipe(
        Flag.withSchema(HttpsUrl),
        Flag.withDescription(
          "HTTPS URL of the ISO to install and keep as each server's minted disk",
        ),
      ),
      unminted: toggle(
        "unminted",
        "Ticket only the live qemu servers that do not hold the ISO's minted disk, asking the reverse proxy at --server-url; needs OLIGARCHY_TOKEN",
      ),
    },
    mint,
  ).pipe(
    Command.withDescription(
      "Mint the ISO on every live qemu server: one install ticket pinned to each, ending in save",
    ),
    Command.provide(withDbAndLinear),
  );

  const testStartCommand = Command.make(
    "start",
    {
      serverUrl: legacyServerUrlFlag,
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
      list,
      details: toggle("details", "Print every field as JSON"),
      name: nameFlag("Print this test definition only"),
      history: toggle("history", "Print every wording of each definition, oldest first"),
    },
    testDefinitions,
  ).pipe(
    Command.withDescription(
      "test --list [--details] [--name <definition>] [--history]; or define, details, run, list, start",
    ),
    Command.provide(withDb),
    Command.withSubcommands([
      testDefineCommand,
      testDetailsCommand,
      testRunCommand,
      testListCommand,
      testStartCommand,
    ]),
  );

  const testResultsCommand = Command.make(
    "test-results",
    {
      serverUrl: legacyServerUrlFlag,
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
      // Optional here alone: a search names its session through the result.
      sessionId: sessionIdFlag.pipe(Flag.optional),
      agentId: Flag.string("agent-id").pipe(
        Flag.withSchema(Schema.NonEmptyString),
        Flag.optional,
        Flag.withDescription("Linear ticket; inspect the session its result ran in"),
      ),
      search: toggle("search", "Print the id of the session that ran --test-result-id"),
      testResultId: Flag.string("test-result-id").pipe(
        Flag.withSchema(Schema.NonEmptyString),
        Flag.optional,
        Flag.withDescription("Test result id from the Linear ticket; with --search"),
      ),
      status: toggle("status", "Print the session row: how it ended, why, and what it booted"),
      logs: toggle("logs", "Print session logs"),
      testDef: toggle("test-def", "Print the session's test definition"),
      testResults: toggle("test-results", "Print the session's test result"),
      testRun: toggle("test-run", "Print the test run the session's result belongs to"),
      actions: toggle("actions", "Print session actions"),
      images: toggle("images", "Print the session's screenshots: id, action, url, when"),
      debugLogs: toggle(
        "debug-logs",
        "Print the session's debug log (serial, proxy, qemu, actions), saved when it ended",
      ),
      diagnosis: toggle("diagnosis", "Print the session's post-run diagnosis, written by diagnose"),
      all: toggle(
        "all",
        "Print the session, logs, test result, definition and run, actions, images, debug log, and diagnosis",
      ),
    },
    sessionInspect,
  ).pipe(
    Command.withDescription(
      "session --session-id <id>|--agent-id <ticket> --status|--logs|--test-def|--test-results|--test-run|--actions|--images|--debug-logs|--diagnosis|--all; session --search --test-result-id <id>; or list",
    ),
    Command.provide(withDb),
    Command.withSubcommands([sessionListCommand]),
  );

  const errorTypeNewCommand = Command.make(
    "new",
    {
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
    { json: toggle("json", "Print the types as a JSON array") },
    errorTypeList,
  ).pipe(
    Command.withDescription("Print every error type with its description, ordered by key"),
    Command.provide(withDb),
  );

  const errorTypeCommand = Command.make("error-type").pipe(
    Command.withDescription("error-type new --key <key> --description <text>; or list"),
    Command.withSubcommands([errorTypeNewCommand, errorTypeListCommand]),
  );

  const automationCommand = Command.make(
    "automation",
    {
      list: Flag.boolean("list").pipe(
        Flag.withDefault(Effect.fail(new CliError.MissingOption({ option: "list" }))),
        Flag.withDescription("List automation jobs from the database"),
      ),
      count: Flag.integer("count").pipe(
        Flag.withSchema(Count),
        Flag.withDefault(DEFAULT_COUNT),
        Flag.withDescription("How many of the most recently completed jobs to print"),
      ),
    },
    ({ count }) => automationList({ count }),
  ).pipe(Command.withDescription("automation --list [--count <n>]"), Command.provide(withDb));

  const diagnoseCommand = Command.make(
    "diagnose",
    {
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
      "diagnose --session-id <id> --verdict passed|failed [--type <key>] --summary <text> --model <id>",
    ),
    Command.provide(withDb),
  );

  return Command.make("ctrl").pipe(
    Command.withDescription(
      "Record and inspect Oligarchy test runs. Every action reads DATABASE_URL; test run and test run testsuite take --server-url (or SERVER_URL), the qemu server their drivers talk to; test start and test-results accept it unread.",
    ),
    Command.withSubcommands([
      testCommand,
      mintCommand,
      testResultsCommand,
      sessionCommand,
      errorTypeCommand,
      diagnoseCommand,
      automationCommand,
    ]),
    EnvFile.withEnvFile,
  );
};
