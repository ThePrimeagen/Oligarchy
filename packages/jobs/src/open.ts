import { Array as Arr, Cause, Effect, Option } from "effect";
import * as DbErrors from "@oligarchy/db/errors";
import * as SetupRequests from "@oligarchy/db/setup-requests";
import * as Tests from "@oligarchy/db/tests";
import * as Linear from "@oligarchy/linear/client";
import * as LinearErrors from "@oligarchy/linear/errors";
import * as Log from "@oligarchy/log/log";
import * as Render from "@oligarchy/log/render";
import * as SharedErrors from "@oligarchy/shared/errors";
import * as Errors from "./errors.ts";
import * as Templates from "./templates.ts";

// The one definition a mint installs from, and the label its tickets carry beside the agent test
// label the automation server watches.
export const MINT_DEFINITION = "mint";
export const MINT_LABEL = "mint";

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
export type Team = {
  readonly teamId: string;
  readonly labelIds: ReadonlyArray<string>;
  readonly assigneeId: string;
  readonly states: Linear.WorkflowStateIds;
};

export const team = Effect.fn("Open.team")(function* (label: string) {
  const linear = yield* Linear.Linear;
  const teamId = yield* linear.teamId;
  const labelIds = yield* linear.labelIds(teamId, label);
  const assigneeId = yield* linear.assigneeId;
  const states = yield* linear.stateIds(teamId);
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

// One ticket, born in Backlog: the automation server queues nothing there, so the create webhook
// cannot beat the job's Linear id to the row. `body` writes what must land before the action can
// be queued, then renders the description, which names the ticket and so waits for its creation.
// The move into Automation Needed rides with the description and goes last: it queues the action.
// Every ticket Linear creates is pushed onto `tickets` first, so a failure can name it.
export const ticket = <E, R>(
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
      Effect.flatMap((description) =>
        linear.describeIssue(created, description, to.states.automationNeeded),
      ),
      Effect.onError(trapped(log, created)),
    );
    return created;
  });

const withCause = (cause: unknown) => (cause === undefined ? undefined : { cause });

// The same failure, its message now the run's reason.
export const withReason = {
  LinearError: (error: LinearErrors.LinearError, message: string) =>
    LinearErrors.LinearError.make(
      Object.assign(
        { operation: error.operation, message },
        error.status === undefined ? undefined : { status: error.status },
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
};

// A failure fails the run and every job in it with the reason, naming the tickets that did get
// created so they can be cleaned up by hand; the error goes on carrying that reason. A run that
// will not take it is a line: the failure that stopped the run is the one the caller reports.
export const failRun = <E extends { readonly message: string }>(
  runId: string,
  tickets: ReadonlyArray<Linear.LinearTicket>,
  error: E,
  rename: (error: E, reason: string) => E,
) =>
  Effect.gen(function* () {
    const tests = yield* Tests.TestStore;
    const log = yield* Log.Log;
    const created = tickets.map((issued) => issued.identifier).join(", ");
    const reason = created === "" ? error.message : `${error.message}; created ${created}`;
    yield* tests
      .failRun(runId, reason)
      .pipe(
        Effect.catchTag("DatabaseError", (write) =>
          log.error(`failRun failed; ${runId}: ${Errors.detail(write)}`, { cause: write }),
        ),
      );
    return yield* Effect.fail(created === "" ? error : rename(error, reason));
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
  const opened = yield* Effect.gen(function* () {
    const to = yield* team(input.version);
    return yield* Effect.forEach(jobs, ({ id, definition }) =>
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
      ).pipe(Effect.map((linear) => ({ id, linear }))),
    );
  }).pipe(
    Effect.catchTags({
      LinearError: (error) => failRun(created.runId, tickets, error, withReason.LinearError),
      PromptError: (error) => failRun(created.runId, tickets, error, withReason.PromptError),
      DatabaseError: (error) => failRun(created.runId, tickets, error, withReason.DatabaseError),
    }),
  );

  yield* log.info(
    `test ${created.runId} created; ${String(opened.length)} tests; ${tickets.map((issued) => issued.identifier).join(", ")}`,
  );
  return { id: created.runId, tests: opened };
});

// The proxy's first reserve of an iso on a qemu server: one mint job and its ticket, pinned to
// that server. The pin goes on the setup row before the ticket reaches Automation Needed, or the
// dispatcher would reserve the mint with no server; a setup row gone by then is SetupGone and the
// ticket stays in Backlog.
export const openMint = Effect.fn("Open.openMint")(function* (input: {
  readonly iso: string;
  readonly serverUrl: string;
  readonly pinned: string;
}) {
  const tests = yield* Tests.TestStore;
  const setups = yield* SetupRequests.SetupRequestStore;
  const definition = yield* mintDefinition();
  const created = yield* tests.createRun({
    iso: input.iso,
    serverUrl: input.serverUrl,
    definitions: [definition],
  });
  // createRun inserts the job in the same transaction; a missing one is a broken invariant.
  const result = yield* Effect.fromOption(Arr.head(created.results)).pipe(
    Effect.mapError(() => new Error(`mint: run ${created.runId} has no result`)),
    Effect.orDie,
  );

  const tickets: Array<Linear.LinearTicket> = [];
  const linear = yield* Effect.gen(function* () {
    const to = yield* team(MINT_LABEL);
    return yield* ticket(to, `Omarchy mint: ${input.pinned}`, tickets, (issued) =>
      Effect.gen(function* () {
        yield* tests.setLinearId(result.id, issued.identifier);
        if (!(yield* setups.setResult(input.iso, input.pinned, result.id))) {
          return yield* Errors.SetupGone.make({
            message: "setup row gone before its result was stored",
          });
        }
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
    );
  }).pipe(
    Effect.catchTags({
      LinearError: (error) => failRun(created.runId, tickets, error, withReason.LinearError),
      PromptError: (error) => failRun(created.runId, tickets, error, withReason.PromptError),
      DatabaseError: (error) => failRun(created.runId, tickets, error, withReason.DatabaseError),
      SetupGone: (error) => failRun(created.runId, tickets, error, withReason.SetupGone),
    }),
  );
  return { id: created.runId, result: result.id, linear };
});
