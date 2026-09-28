import type * as Db from "@oligarchy/db";
import * as Linear from "@oligarchy/linear";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import type { Needs } from "./needs.ts";
import { linearRead } from "./retry.ts";
import * as Templates from "./templates.ts";

// The one definition a mint installs from, and the label its tickets carry beside the agent test
// label the automation server watches.
export const MINT_DEFINITION = "mint";
export const MINT_LABEL = "mint";

export type Refused =
  | Errors.NoDefinition
  | Errors.PromptError
  | Db.DatabaseError
  | Linear.LinearFailure;

// A mint's failures: the run's, or its pin's.
export type MintRefused = Refused | Errors.SetupGone | Errors.SetupHeld;

export type Definition = Pick<
  Stores.Tests.DefinitionRow,
  "id" | "name" | "description" | "instruction" | "proof"
>;

export type Opened = {
  readonly id: string;
  readonly tests: ReadonlyArray<{ readonly id: string; readonly linear: Linear.Ticket }>;
};

export type Minted = {
  readonly id: string;
  readonly result: string;
  readonly server: string;
  readonly linear: Linear.Ticket;
};

type Filing = Pick<Needs, "tests" | "linear" | "logger" | "prompts">;

const identifiers = (tickets: ReadonlyArray<Linear.Ticket>): string =>
  tickets.map((ticket) => ticket.identifier).join(", ");

// The suite's definitions, every one but the mint install, or the one named; none is refused.
const definitions = async (
  tests: Needs["tests"],
  name: string | undefined,
): Promise<jarl.Result<ReadonlyArray<Stores.Tests.DefinitionRow>, Refused>> => {
  if (name !== undefined) {
    const found = await tests.findTestDefinition(name);
    if (!found.ok) {
      return found;
    }
    return found.value === undefined
      ? jarl.err(new Errors.NoDefinition(`test: no test definition named ${name}`))
      : jarl.ok([found.value]);
  }
  const listed = await tests.listTestDefinitions();
  if (!listed.ok) {
    return listed;
  }
  const suite = listed.value.filter((definition) => definition.name !== MINT_DEFINITION);
  return suite.length === 0
    ? jarl.err(new Errors.NoDefinition("test: no test definitions found"))
    : jarl.ok(suite);
};

// The install's wording, refused before anything is created when nobody has defined it.
export const mintDefinition = async (
  needs: Pick<Needs, "tests">,
): Promise<jarl.Result<Stores.Tests.DefinitionRow, Errors.NoDefinition | Db.DatabaseError>> => {
  const found = await needs.tests.findTestDefinition(MINT_DEFINITION);
  if (!found.ok) {
    return found;
  }
  return found.value === undefined
    ? jarl.err(
        new Errors.NoDefinition(
          `mint: no test definition named ${MINT_DEFINITION}; define the install once with ./ctrl test define --name ${MINT_DEFINITION}`,
        ),
      )
    : jarl.ok(found.value);
};

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
const team = async (
  linear: Needs["linear"],
  label: string,
): Promise<jarl.Result<Team, Linear.LinearFailure>> => {
  const teamId = await linearRead(() => linear.teamId());
  if (!teamId.ok) {
    return teamId;
  }
  const labelIds = await linear.labelIds(teamId.value, label);
  if (!labelIds.ok) {
    return labelIds;
  }
  const assigneeId = await linearRead(() => linear.assigneeId());
  if (!assigneeId.ok) {
    return assigneeId;
  }
  const states = await linearRead(() => linear.stateIds(teamId.value));
  if (!states.ok) {
    return states;
  }
  return jarl.ok({
    teamId: teamId.value,
    labelIds: labelIds.value,
    assigneeId: assigneeId.value,
    states: states.value,
  });
};

// The one update that writes a new ticket's description and moves it out of Backlog, which
// queues its action. It is never sent twice: when Linear does not answer, the update may still
// have landed, so the ticket's column is read instead (asked once more if that read gets no
// answer either). A ticket that has left Backlog was handed off; one still in Backlog, or one
// whose column cannot be read, is the hand-off failing.
const handOff = async (
  linear: Needs["linear"],
  created: Linear.Ticket,
  description: string,
  states: Linear.WorkflowStateIds,
): Promise<jarl.Result<void, Linear.LinearFailure>> => {
  const described = await linear.describeIssue(created, description, states.automationNeeded);
  if (described.ok || !Linear.retryable(described.error)) {
    return described;
  }
  const state = await linearRead(() => linear.issueStateId(created));
  return state.ok && state.value !== states.backlog ? jarl.ok(undefined) : described;
};

// One ticket, born in Backlog: the automation server queues nothing there, so the create webhook
// cannot beat the job's Linear id to the row. `body` writes what must land before the action can
// be queued, then renders the description, which names the ticket and so waits for its creation.
// The move into Automation Needed rides with the description and goes last: it queues the action.
// Every ticket Linear creates is pushed onto `tickets` first, so a failure can name it; one left
// in Backlog is a line, so it can be found and cleaned up by hand.
const ticket = async <E extends Error>(
  needs: Pick<Needs, "linear" | "logger">,
  to: Team,
  title: string,
  tickets: Array<Linear.Ticket>,
  body: (ticket: Linear.Ticket) => Promise<jarl.Result<string, E>>,
): Promise<jarl.Result<Linear.Ticket, E | Linear.LinearFailure>> => {
  const created = await needs.linear.createIssue({
    teamId: to.teamId,
    title,
    labelIds: to.labelIds,
    assigneeId: to.assigneeId,
    stateId: to.states.backlog,
  });
  if (!created.ok) {
    return created;
  }
  tickets.push(created.value);
  const description = await body(created.value);
  const handed = description.ok
    ? await handOff(needs.linear, created.value, description.value, to.states)
    : description;
  if (!handed.ok) {
    needs.logger.error(`ticket trapped in Backlog; ${Errors.detail(handed.error)}`, {
      agentId: created.value.identifier,
    });
    return handed;
  }
  return created;
};

// A failure fails the run and the jobs in `failed`, the ones whose tickets were not handed off,
// with the reason: it names every ticket that did get created, so one left in Backlog can be
// found and cleaned up by hand, then the definitions in `named`, when part of the run stands, so
// they can be filed again. The error goes on carrying that reason. A run that will not take it
// is a line: the failure that stopped the run is the one the caller reports.
const failRun = async <E extends Error>(
  needs: Pick<Needs, "tests" | "logger">,
  runId: string,
  failed: ReadonlyArray<string>,
  named: ReadonlyArray<string>,
  tickets: ReadonlyArray<Linear.Ticket>,
  error: E,
): Promise<jarl.Result<never, E>> => {
  const created = identifiers(tickets);
  const reason = [
    error.message,
    created === "" ? "" : `created ${created}`,
    named.length === 0 ? "" : `failed ${named.join(", ")}`,
  ]
    .filter((part) => part !== "")
    .join("; ");
  const written = await needs.tests.failRun(runId, reason, failed);
  if (!written.ok) {
    needs.logger.error(`failRun failed; ${runId}: ${Errors.detail(written.error)}`);
  }
  return jarl.err(reason === error.message ? error : Errors.renamed(error, reason));
};

// One ticket per job, in order. A ticket Linear did not answer for is that ticket's failure: the
// suite files the rest, and fails once every definition has been tried. A second one in a row is
// Linear down, and stops the suite rather than leave a Backlog ticket, or an unanswered create,
// per definition; so does any other failure, which every ticket after it would repeat.
const fileSuite = async (
  needs: Filing,
  input: { readonly serverUrl: string; readonly iso: string; readonly version: string },
  runId: string,
  jobs: ReadonlyArray<{ readonly id: string; readonly definition: Definition }>,
  tickets: Array<Linear.Ticket>,
  opened: Array<{ readonly id: string; readonly linear: Linear.Ticket }>,
): Promise<jarl.Result<void, Refused>> => {
  const to = await team(needs.linear, input.version);
  if (!to.ok) {
    return to;
  }
  let lost: Refused | undefined;
  let lostLast = false;
  for (const { id, definition } of jobs) {
    const filed = await ticket<Errors.PromptError | Db.DatabaseError>(
      needs,
      to.value,
      `Omarchy: ${definition.name}`,
      tickets,
      async (issued) => {
        // Webhooks name the ticket by its identifier; the job carries it so the automation queue
        // finds the row without parsing the ticket body.
        const linked = await needs.tests.setLinearId(id, issued.identifier);
        if (!linked.ok) {
          return linked;
        }
        return Templates.renderLinearIssue(needs.prompts, {
          LINEAR_TICKET: issued.identifier,
          RUN_ID: runId,
          RESULT_ID: id,
          VERSION: input.version,
          ISO_URL: input.iso,
          SERVER_URL: input.serverUrl,
          TEST_NAME: definition.name,
          TEST_DESCRIPTION: definition.description,
          TEST_INSTRUCTION: definition.instruction,
          TEST_PROOF: definition.proof,
        });
      },
    );
    if (filed.ok) {
      opened.push({ id, linear: filed.value });
      lostLast = false;
      continue;
    }
    if (!Linear.retryable(filed.error) || lostLast) {
      return filed;
    }
    lost = filed.error;
    lostLast = true;
  }
  return lost === undefined ? jarl.ok(undefined) : jarl.err(lost);
};

// `./ctrl test run --name <definition>`, and `test run testsuite`, which names none: one pending
// job per definition (the suite leaves the mint install out), each in its newest wording, and
// one ticket each. Returns the run and its tickets and prints nothing but its line.
export const open = async (
  needs: Filing,
  input: {
    readonly serverUrl: string;
    readonly iso: string;
    readonly version: string;
    readonly name?: string;
  },
): Promise<jarl.Result<Opened, Refused>> => {
  const selected = await definitions(needs.tests, input.name);
  if (!selected.ok) {
    return selected;
  }
  const created = await needs.tests.createRun({
    iso: input.iso,
    serverUrl: input.serverUrl,
    definitions: selected.value,
  });
  if (!created.ok) {
    return created;
  }
  const { runId } = created.value;
  const resultIds = new Map(created.value.results.map((row) => [row.definitionId, row.id]));
  // createRun inserts one job per definition in the same transaction; a missing one is a broken
  // invariant, never a smaller run.
  const jobs = selected.value.map((definition) => {
    const id = resultIds.get(definition.id);
    if (id === undefined) {
      throw new Error(`test: run ${runId} has no result for definition ${definition.name}`);
    }
    return { id, definition };
  });

  const tickets: Array<Linear.Ticket> = [];
  const opened: Array<{ readonly id: string; readonly linear: Linear.Ticket }> = [];
  const filed = await fileSuite(needs, input, runId, jobs, tickets, opened);
  if (!filed.ok) {
    // Every job not handed off fails; their definitions are named when some were.
    const handedOff = new Set(opened.map((test) => test.id));
    const failed = jobs.filter((job) => !handedOff.has(job.id));
    return failRun<Refused>(
      needs,
      runId,
      failed.map((job) => job.id),
      opened.length === 0 ? [] : failed.map((job) => job.definition.name),
      tickets,
      filed.error,
    );
  }
  needs.logger.info(
    `test ${runId} created; ${String(opened.length)} tests; ${identifiers(tickets)}`,
  );
  return jarl.ok({ id: runId, tests: opened });
};

// Not a test: one install, its own run with one job, and a ticket pinned to the server that ends
// up holding the iso's minted disk. `pin` writes what must land beside the job's Linear id before
// the ticket reaches Automation Needed. A failure fails this run, naming every ticket in
// `tickets`; runs already whole for earlier servers stand.
const mintJob = async (
  needs: Filing,
  input: {
    readonly iso: string;
    readonly serverUrl: string;
    readonly definition: Definition;
    readonly pinned: string;
    readonly to: Team;
    readonly tickets: Array<Linear.Ticket>;
    readonly pin: (
      result: string,
    ) => Promise<jarl.Result<void, Errors.SetupGone | Errors.SetupHeld | Db.DatabaseError>>;
  },
): Promise<jarl.Result<Minted, MintRefused>> => {
  const { definition } = input;
  const created = await needs.tests.createRun({
    iso: input.iso,
    serverUrl: input.serverUrl,
    definitions: [definition],
  });
  if (!created.ok) {
    return created;
  }
  const { runId } = created.value;
  // createRun inserts the job in the same transaction; a missing one is a broken invariant.
  const [result] = created.value.results;
  if (result === undefined) {
    throw new Error(`mint: run ${runId} has no result for definition ${definition.name}`);
  }
  const issued = await ticket<
    Errors.PromptError | Db.DatabaseError | Errors.SetupGone | Errors.SetupHeld
  >(needs, input.to, `Omarchy mint: ${input.pinned}`, input.tickets, async (made) => {
    const linked = await needs.tests.setLinearId(result.id, made.identifier);
    if (!linked.ok) {
      return linked;
    }
    const pinned = await input.pin(result.id);
    if (!pinned.ok) {
      return pinned;
    }
    return Templates.renderMintIssue(needs.prompts, {
      LINEAR_TICKET: made.identifier,
      RUN_ID: runId,
      RESULT_ID: result.id,
      ISO_URL: input.iso,
      SERVER_URL: input.serverUrl,
      PINNED_SERVER: input.pinned,
      INSTALL_NAME: definition.name,
      INSTALL_DESCRIPTION: definition.description,
      INSTALL_INSTRUCTION: definition.instruction,
      INSTALL_PROOF: definition.proof,
    });
  });
  if (!issued.ok) {
    return failRun<MintRefused>(needs, runId, [result.id], [], input.tickets, issued.error);
  }
  return jarl.ok({ id: runId, result: result.id, server: input.pinned, linear: issued.value });
};

// The proxy's first reserve of an iso on a qemu server: one mint job and its ticket, pinned to
// that server. The pin goes on the setup row before the ticket reaches Automation Needed, or the
// dispatcher would reserve the mint with no server; a setup row gone by then is SetupGone and the
// ticket stays in Backlog. Linear refusing the team opens no run.
export const openMint = async (
  needs: Filing & Pick<Needs, "setupRequests">,
  input: { readonly iso: string; readonly serverUrl: string; readonly pinned: string },
): Promise<
  jarl.Result<
    { readonly id: string; readonly result: string; readonly linear: Linear.Ticket },
    MintRefused
  >
> => {
  const definition = await mintDefinition(needs);
  if (!definition.ok) {
    return definition;
  }
  const to = await team(needs.linear, MINT_LABEL);
  if (!to.ok) {
    return to;
  }
  const opened = await mintJob(needs, {
    ...input,
    definition: definition.value,
    to: to.value,
    tickets: [],
    pin: async (result) => {
      const stored = await needs.setupRequests.setResult(input.iso, input.pinned, result);
      if (!stored.ok) {
        return stored;
      }
      return stored.value
        ? jarl.ok(undefined)
        : jarl.err(new Errors.SetupGone("setup row gone before its result was stored"));
    },
  });
  return opened.ok
    ? jarl.ok({ id: opened.value.id, result: opened.value.result, linear: opened.value.linear })
    : opened;
};

// `./ctrl mint`: one mint job and its ticket per server, in order, the team asked for once. Each
// claims that server's setup lock with its result before the ticket moves, since the lock is where
// the dispatcher reads a mint's pin; ctrl has no hold of the proxy's, so the lock and its result
// go in one write. A lock a mint in flight holds is refused. The first failure stops the rest.
export const openMints = async (
  needs: Filing & Pick<Needs, "setupRequests">,
  input: {
    readonly iso: string;
    readonly serverUrl: string;
    readonly definition: Definition;
    readonly servers: ReadonlyArray<string>;
  },
): Promise<jarl.Result<ReadonlyArray<Minted>, MintRefused>> => {
  if (input.servers.length === 0) {
    return jarl.ok([]);
  }
  const to = await team(needs.linear, MINT_LABEL);
  if (!to.ok) {
    return to;
  }
  const tickets: Array<Linear.Ticket> = [];
  const opened: Array<Minted> = [];
  for (const pinned of input.servers) {
    const minted = await mintJob(needs, {
      iso: input.iso,
      serverUrl: input.serverUrl,
      definition: input.definition,
      pinned,
      to: to.value,
      tickets,
      pin: async (result) => {
        const claimed = await needs.setupRequests.claim(input.iso, pinned, result);
        if (!claimed.ok) {
          return claimed;
        }
        return claimed.value
          ? jarl.ok(undefined)
          : jarl.err(
              new Errors.SetupHeld(`${pinned} is held by a mint still being created or run`),
            );
      },
    });
    if (!minted.ok) {
      return minted;
    }
    opened.push(minted.value);
  }
  needs.logger.info(
    `mint ${input.iso} created; ${String(opened.length)} servers; ${identifiers(tickets)}`,
  );
  return jarl.ok(opened);
};
