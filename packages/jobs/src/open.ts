import { Array as Arr, Cause, Effect, Option, Result } from "effect";
import * as DbErrors from "@oligarchy/db/errors";
import * as SetupRequests from "@oligarchy/db/setup-requests";
import * as Tests from "@oligarchy/db/tests";
import * as Linear from "@oligarchy/linear/client";
import * as LinearErrors from "@oligarchy/linear/errors";
import * as Log from "@oligarchy/log/log";
import * as Render from "@oligarchy/log/render";
import * as SharedErrors from "@oligarchy/shared/errors";
import * as Errors from "./errors.ts";
import * as Retry from "./retry.ts";
import * as Templates from "./templates.ts";

// The one definition a mint installs from, and the label its tickets carry beside the agent test
// label the automation server watches.
export const MINT_DEFINITION = "mint";
const MINT_LABEL = "mint";

const refuse = (message: string) => SharedErrors.CommandError.make({ message });

export const noDefinitions = (name: Option.Option<string>): SharedErrors.CommandError =>
  refuse(
    Option.match(name, {
      onNone: () => "test: no test definitions found",
      onSome: (wanted) => `test: no test definition named ${wanted}`,
    }),
  );

// Every definition ordered by name, or the one named; a name that matches nothing is refused,
// an empty table is refused only when the caller needs at least one.
export const selectDefinitions = Effect.fn("Open.selectDefinitions")(function* (
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

// The install's wording, refused before anything is created when nobody has defined it.
export const mintDefinition = Effect.fn("Open.mintDefinition")(function* () {
  const tests = yield* Tests.TestStore;
  return yield* tests.findTestDefinition(MINT_DEFINITION).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            refuse(
              `mint: no test definition named ${MINT_DEFINITION}; define the install once with ./ctrl test define --name ${MINT_DEFINITION}`,
            ),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );
});

// Where a run's tickets go: the team, the labels (the agent test label and the run's own), the
// assignee, and the columns.
type Team = {
  readonly teamId: string;
  readonly labelIds: ReadonlyArray<string>;
  readonly assigneeId: string;
  readonly states: Linear.WorkflowStateIds;
};

// The lookups are asked again once when Linear did not answer. The labels are not: a missing one
// is created, and a create whose answer was lost is not safe to send twice.
const team = Effect.fn("Open.team")(function* (label: string) {
  const linear = yield* Linear.Linear;
  const teamId = yield* Retry.linearRead(linear.teamId);
  const labelIds = yield* linear.labelIds(teamId, label);
  const assigneeId = yield* Retry.linearRead(linear.assigneeId);
  const states = yield* Retry.linearRead(linear.stateIds(teamId));
  const found: Team = { teamId, labelIds, assigneeId, states };
  return found;
});

// From its creation until the update that moves it lands, a ticket sits in Backlog, where
// nothing drives it. Whatever cuts that stretch short (a refusal, a defect, the operator's
// SIGINT) leaves it there for good, so the line reaches Sentry rather than only a terminal.
// Attached with Effect.onError: a finalizer runs on an interrupt too, and uninterruptibly, where
// a tapCause handler is skipped once the fiber is interrupted.
const trapped =
  (log: typeof Log.Log.Service, ticket: Linear.LinearTicket) =>
  <E>(cause: Cause.Cause<E>) => {
    const agentId = ticket.identifier;
    if (Cause.hasInterruptsOnly(cause)) {
      return log.error("ticket trapped in Backlog; interrupted", { agentId });
    }
    const error = Cause.squash(cause);
    return log.error(`ticket trapped in Backlog; ${Render.errorDetail(error)}`, {
      agentId,
      cause: error,
    });
  };

// The one update that writes a new ticket's description and moves it out of Backlog, which
// queues its action. It is never sent twice: when Linear does not answer, the update may still
// have landed, so the ticket's column is read instead (asked once more if that read gets no
// answer either). A ticket that has left Backlog was handed off; one still in Backlog, or one
// whose column cannot be read, is the hand-off failing.
const handOff = (
  linear: typeof Linear.Linear.Service,
  created: Linear.LinearTicket,
  description: string,
  states: Linear.WorkflowStateIds,
) =>
  linear.describeIssue(created, description, states.automationNeeded).pipe(
    Effect.catchIf(
      (error) => error.retryable === true,
      (error) =>
        Retry.linearRead(linear.issueStateId(created)).pipe(
          Effect.catch(() => Effect.fail(error)),
          Effect.flatMap((state) => (state === states.backlog ? Effect.fail(error) : Effect.void)),
        ),
    ),
  );

// One ticket, born in Backlog: the automation server queues nothing there, so the create webhook
// cannot beat the job's Linear id to the row. `body` writes what must land before the action can
// be queued, then renders the description, which names the ticket and so waits for its creation.
// The move into Automation Needed rides with the description and goes last: it queues the action.
// Every ticket Linear creates is pushed onto `tickets` first, so a failure can name it.
const ticket = <E, R>(
  to: Team,
  title: string,
  tickets: Array<Linear.LinearTicket>,
  body: (ticket: Linear.LinearTicket) => Effect.Effect<string, E, R>,
) =>
  Effect.gen(function* () {
    const linear = yield* Linear.Linear;
    const log = yield* Log.Log;
    const created = yield* linear.createIssue({
      teamId: to.teamId,
      title,
      labelIds: to.labelIds,
      assigneeId: to.assigneeId,
      stateId: to.states.backlog,
    });
    tickets.push(created);
    yield* body(created).pipe(
      Effect.flatMap((description) => handOff(linear, created, description, to.states)),
      Effect.onError(trapped(log, created)),
    );
    return created;
  });

const withCause = (cause: unknown) => (cause === undefined ? undefined : { cause });

// The same failure, its message now the run's reason.
const withReason = {
  LinearError: (error: LinearErrors.LinearError, message: string) =>
    LinearErrors.LinearError.make(
      Object.assign(
        { operation: error.operation, message },
        error.status === undefined ? undefined : { status: error.status },
        error.retryable === undefined ? undefined : { retryable: error.retryable },
        withCause(error.cause),
      ),
    ),
  PromptError: (error: Errors.PromptError, message: string) =>
    Errors.PromptError.make(Object.assign({ message }, withCause(error.cause))),
  DatabaseError: (error: DbErrors.DatabaseError, message: string) =>
    DbErrors.DatabaseError.make(
      Object.assign({ operation: error.operation, message }, withCause(error.cause)),
    ),
  SetupGone: (_error: Errors.SetupGone, message: string) => Errors.SetupGone.make({ message }),
  SetupHeld: (_error: Errors.SetupHeld, message: string) => Errors.SetupHeld.make({ message }),
};

// A failure fails the run and the jobs in `failed`, the ones whose tickets were not handed off,
// with the reason: it names every ticket that did get created, so one left in Backlog can be
// found and cleaned up by hand, then the definitions in `named`, when part of the run stands, so
// they can be filed again. The error goes on carrying that reason. A run that will not take it
// is a line: the failure that stopped the run is the one the caller reports.
const failRun = <E extends { readonly message: string }>(
  runId: string,
  failed: ReadonlyArray<string>,
  named: ReadonlyArray<string>,
  tickets: ReadonlyArray<Linear.LinearTicket>,
  error: E,
  rename: (error: E, reason: string) => E,
) =>
  Effect.gen(function* () {
    const tests = yield* Tests.TestStore;
    const log = yield* Log.Log;
    const created = tickets.map((issued) => issued.identifier).join(", ");
    const reason = [
      error.message,
      created === "" ? "" : `created ${created}`,
      named.length === 0 ? "" : `failed ${named.join(", ")}`,
    ]
      .filter((part) => part !== "")
      .join("; ");
    yield* tests
      .failRun(runId, reason, failed)
      .pipe(
        Effect.catchTag("DatabaseError", (write) =>
          log.error(`failRun failed; ${runId}: ${Errors.detail(write)}`, { cause: write }),
        ),
      );
    return yield* Effect.fail(reason === error.message ? error : rename(error, reason));
  });

// `./ctrl test run --name <definition>`, and `test run testsuite`, which names none: one pending
// job per definition (the suite leaves the mint install out), each in its newest wording, and
// one ticket each. Returns the run and its tickets and prints nothing.
export const open = Effect.fn("Open.open")(function* (input: {
  readonly serverUrl: string;
  readonly iso: string;
  readonly version: string;
  readonly name: Option.Option<string>;
}) {
  const tests = yield* Tests.TestStore;
  const log = yield* Log.Log;
  const definitions = yield* Option.match(input.name, {
    onNone: () =>
      selectDefinitions(input.name, false).pipe(
        Effect.map((rows) => rows.filter((row) => row.name !== MINT_DEFINITION)),
        Effect.filterOrFail(
          (rows) => rows.length > 0,
          () => noDefinitions(input.name),
        ),
      ),
    onSome: () => selectDefinitions(input.name, true),
  });
  const created = yield* tests.createRun({
    iso: input.iso,
    serverUrl: input.serverUrl,
    definitions,
  });
  const resultIds = new Map(created.results.map((row) => [row.definitionId, row.id] as const));
  // createRun inserts one job per definition in the same transaction; a missing one is a broken
  // invariant, never a smaller run.
  const jobs = yield* Effect.forEach(definitions, (definition) => {
    const id = resultIds.get(definition.id);
    return id === undefined
      ? Effect.die(
          new Error(`test: run ${created.runId} has no result for definition ${definition.name}`),
        )
      : Effect.succeed({ id, definition });
  });

  const tickets: Array<Linear.LinearTicket> = [];
  const opened: Array<{ readonly id: string; readonly linear: Linear.LinearTicket }> = [];
  // A failure fails every job not handed off; their definitions are named when some were.
  const failSuite = <E extends { readonly message: string }>(
    error: E,
    rename: (error: E, reason: string) => E,
  ) => {
    const handedOff = new Set(opened.map((test) => test.id));
    const failed = jobs.filter((job) => !handedOff.has(job.id));
    return failRun(
      created.runId,
      failed.map((job) => job.id),
      opened.length === 0 ? [] : failed.map((job) => job.definition.name),
      tickets,
      error,
      rename,
    );
  };
  yield* Effect.gen(function* () {
    const to = yield* team(input.version);
    // A ticket Linear did not answer for is that ticket's failure: the suite files the rest,
    // and fails once every definition has been tried. A second one in a row is Linear down, and
    // stops the suite rather than leave a Backlog ticket, or an unanswered create, per
    // definition; so does any other failure, which every ticket after it would repeat.
    let lost: Option.Option<LinearErrors.LinearError> = Option.none();
    let lostLast = false;
    for (const { id, definition } of jobs) {
      const filed = yield* Effect.result(
        ticket(to, `Omarchy: ${definition.name}`, tickets, (issued) =>
          Effect.gen(function* () {
            // Webhooks name the ticket by its identifier; the job carries it so the automation
            // queue finds the row without parsing the ticket body.
            yield* tests.setLinearId(id, issued.identifier);
            return yield* Templates.renderLinearIssue({
              LINEAR_TICKET: issued.identifier,
              RUN_ID: created.runId,
              RESULT_ID: id,
              VERSION: input.version,
              ISO_URL: input.iso,
              SERVER_URL: input.serverUrl,
              TEST_NAME: definition.name,
              TEST_DESCRIPTION: definition.description,
              TEST_INSTRUCTION: definition.instruction,
              TEST_PROOF: definition.proof,
            });
          }),
        ),
      );
      if (Result.isSuccess(filed)) {
        opened.push({ id, linear: filed.success });
        lostLast = false;
        continue;
      }
      const error = filed.failure;
      if (error._tag !== "LinearError" || error.retryable !== true || lostLast) {
        return yield* Effect.fail(error);
      }
      lost = Option.some(error);
      lostLast = true;
    }
    return yield* Option.match(lost, { onNone: () => Effect.void, onSome: Effect.fail });
  }).pipe(
    Effect.catchTags({
      LinearError: (error) => failSuite(error, withReason.LinearError),
      PromptError: (error) => failSuite(error, withReason.PromptError),
      DatabaseError: (error) => failSuite(error, withReason.DatabaseError),
    }),
  );

  yield* log.info(
    `test ${created.runId} created; ${String(opened.length)} tests; ${tickets.map((issued) => issued.identifier).join(", ")}`,
  );
  return { id: created.runId, tests: opened };
});

type Definition = Tests.DefinitionInput & { readonly id: number };

// Not a test: one install, its own run with one job, and a ticket pinned to the server that ends
// up holding the iso's minted disk. `pin` writes what must land beside the job's Linear id before
// the ticket reaches Automation Needed. A failure fails this run, naming every ticket in
// `tickets`; runs already whole for earlier servers stand.
const mintJob = (input: {
  readonly iso: string;
  readonly serverUrl: string;
  readonly definition: Definition;
  readonly pinned: string;
  readonly to: Team;
  readonly tickets: Array<Linear.LinearTicket>;
  readonly pin: (
    result: string,
  ) => Effect.Effect<void, Errors.SetupGone | Errors.SetupHeld | DbErrors.DatabaseError>;
}) =>
  Effect.gen(function* () {
    const tests = yield* Tests.TestStore;
    const { definition } = input;
    const created = yield* tests.createRun({
      iso: input.iso,
      serverUrl: input.serverUrl,
      definitions: [definition],
    });
    // createRun inserts the job in the same transaction; a missing one is a broken invariant.
    const result = yield* Effect.fromOption(Arr.head(created.results)).pipe(
      Effect.mapError(
        () =>
          new Error(`mint: run ${created.runId} has no result for definition ${definition.name}`),
      ),
      Effect.orDie,
    );
    const failMint = <E extends { readonly message: string }>(
      error: E,
      rename: (error: E, reason: string) => E,
    ) => failRun(created.runId, [result.id], [], input.tickets, error, rename);
    const linear = yield* ticket(
      input.to,
      `Omarchy mint: ${input.pinned}`,
      input.tickets,
      (issued) =>
        Effect.gen(function* () {
          yield* tests.setLinearId(result.id, issued.identifier);
          yield* input.pin(result.id);
          return yield* Templates.renderMintIssue({
            LINEAR_TICKET: issued.identifier,
            RUN_ID: created.runId,
            RESULT_ID: result.id,
            ISO_URL: input.iso,
            SERVER_URL: input.serverUrl,
            PINNED_SERVER: input.pinned,
            INSTALL_NAME: definition.name,
            INSTALL_DESCRIPTION: definition.description,
            INSTALL_INSTRUCTION: definition.instruction,
            INSTALL_PROOF: definition.proof,
          });
        }),
    ).pipe(
      Effect.catchTags({
        LinearError: (error) => failMint(error, withReason.LinearError),
        PromptError: (error) => failMint(error, withReason.PromptError),
        DatabaseError: (error) => failMint(error, withReason.DatabaseError),
        SetupGone: (error) => failMint(error, withReason.SetupGone),
        SetupHeld: (error) => failMint(error, withReason.SetupHeld),
      }),
    );
    return { id: created.runId, result: result.id, server: input.pinned, linear };
  });

// The proxy's first reserve of an iso on a qemu server: one mint job and its ticket, pinned to
// that server. The pin goes on the setup row before the ticket reaches Automation Needed, or the
// dispatcher would reserve the mint with no server; a setup row gone by then is SetupGone and the
// ticket stays in Backlog. Linear refusing the team opens no run.
export const openMint = Effect.fn("Open.openMint")(function* (input: {
  readonly iso: string;
  readonly serverUrl: string;
  readonly pinned: string;
}) {
  const setups = yield* SetupRequests.SetupRequestStore;
  const definition = yield* mintDefinition();
  const to = yield* team(MINT_LABEL);
  const opened = yield* mintJob({
    ...input,
    definition,
    to,
    tickets: [],
    pin: (result) =>
      setups.setResult(input.iso, input.pinned, result).pipe(
        Effect.filterOrFail(
          (stored) => stored,
          () => Errors.SetupGone.make({ message: "setup row gone before its result was stored" }),
        ),
        Effect.asVoid,
      ),
  });
  return { id: opened.id, result: opened.result, linear: opened.linear };
});

// `./ctrl mint`: one mint job and its ticket per server, in order, the team asked for once. Each
// claims that server's setup lock with its result before the ticket moves, since the lock is where
// the dispatcher reads a mint's pin; ctrl has no hold of the proxy's, so the lock and its result
// go in one write. A lock a mint in flight holds is refused. The first failure stops the rest.
// Returns what it opened and prints nothing.
export const openMints = Effect.fn("Open.openMints")(function* (input: {
  readonly iso: string;
  readonly serverUrl: string;
  readonly definition: Definition;
  readonly servers: ReadonlyArray<string>;
}) {
  const log = yield* Log.Log;
  if (input.servers.length === 0) {
    return [];
  }
  const setups = yield* SetupRequests.SetupRequestStore;
  const to = yield* team(MINT_LABEL);
  const tickets: Array<Linear.LinearTicket> = [];
  const opened = yield* Effect.forEach(input.servers, (pinned) =>
    mintJob({
      iso: input.iso,
      serverUrl: input.serverUrl,
      definition: input.definition,
      pinned,
      to,
      tickets,
      pin: (result) =>
        setups.claim(input.iso, pinned, result).pipe(
          Effect.filterOrFail(
            (claimed) => claimed,
            () =>
              Errors.SetupHeld.make({
                message: `${pinned} is held by a mint still being created or run`,
              }),
          ),
          Effect.asVoid,
        ),
    }),
  );
  yield* log.info(
    `mint ${input.iso} created; ${String(opened.length)} servers; ${tickets.map((issued) => issued.identifier).join(", ")}`,
  );
  return opened;
});
