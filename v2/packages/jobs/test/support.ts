import { readFileSync } from "node:fs";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as Linear from "@oligarchy/linear";
import * as Logger from "@oligarchy/logger";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach } from "vitest";
import type { Action, Job, Needs } from "../src/needs.ts";
import type * as Templates from "../src/templates.ts";

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

// A logger that prints into `lines`, nothing stored.
export const logging = () => {
  const lines: Array<string> = [];
  const logger = Logger.create({ write: (line) => lines.push(line), colors: false });
  return { lines, logger };
};

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

// A real database of the test's own, with the stores over it.
export const database = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const env = jarl.unwrap(
    await Env.create(
      Env.cli({ name: "jobs-test", description: "" }).needs("databaseUrl").done(),
      Env.fakeIo({ env: { DATABASE_URL: fake.url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  );
  const db = jarl.unwrap(Db.open({ url: env.vars.databaseUrl, onPoolError: () => undefined }));
  cleanups.push(() => db.close());
  return {
    tests: Stores.Tests.create(db),
    automation: Stores.Automation.create(db),
    sessions: Stores.Sessions.create(db),
    diagnosis: Stores.Diagnosis.create(db),
    setupRequests: Stores.SetupRequests.create(db),
    servers: Stores.Servers.create(db),
  };
};

export const ISO = "https://iso.omarchy.org/omarchy-3.4.0.iso";
export const SERVER_URL = "http://proxy:8080";

// A definition with the wording definitionRow gives it, stored.
export const define = async (stores: Awaited<ReturnType<typeof database>>, name: string) =>
  jarl.unwrap(
    await stores.tests.defineTestDefinition({
      name,
      description: `${name} description`,
      instruction: `${name} instruction`,
      proof: `${name} proof`,
    }),
  );

// One stored job of a run of its own, for a definition named `name`, ticketed `ticket`.
export const storedJob = async (
  stores: Awaited<ReturnType<typeof database>>,
  name: string,
  ticket: string | null = "OLI-42",
): Promise<Job> => {
  const definition = await define(stores, name);
  const run = jarl.unwrap(
    await stores.tests.createRun({ iso: ISO, serverUrl: SERVER_URL, definitions: [definition] }),
  );
  const id = run.results[0]?.id ?? "";
  if (ticket !== null) {
    jarl.unwrap(await stores.tests.setLinearId(id, ticket));
  }
  const job = jarl.unwrap(await stores.tests.findResult(id));
  if (job === undefined) {
    throw new Error(`storedJob: no result ${id}`);
  }
  return job;
};

// A store with only the methods a test gives; any other it is asked for throws, naming itself.
export const only = <T extends object>(given: Partial<T>): T =>
  new Proxy(given, {
    get: (target, key) =>
      Reflect.get(target, key) ??
      (() => {
        throw new Error(`unexpected call: ${String(key)}`);
      }),
  }) as T;

// The error a result failed with; a result that did not fail fails the test.
export const errorOf = <R extends jarl.Result<unknown, unknown>>(
  result: R,
): Extract<R, { ok: false }>["error"] => {
  if (result.ok) {
    throw new Error(`expected an error, got ${JSON.stringify(result.value)}`);
  }
  return result.error;
};

// What a failed database write says: drizzle's failed query, with the driver's reason as cause.
export const refusedWrite = (reason: string) => {
  const error = new Db.DatabaseError(`Failed query: update ...: ${reason}`);
  error.cause = new Error(reason);
  return error;
};

// What a second insert of a (result, action) says.
export const duplicateKey = () =>
  refusedWrite(
    'duplicate key value violates unique constraint "automation_jobs_result_action_idx"',
  );

export const unavailable = (message = "linear: request failed (503): busy") =>
  new Linear.LinearUnavailable(message);

export const refused = (message = "linear: Entity not found") => new Linear.LinearError(message);

export const ticketNamed = (identifier: string): Linear.Ticket => ({
  id: `issue-${identifier}`,
  identifier,
  url: `https://linear.app/${identifier}`,
});

export const STATES: Linear.WorkflowStateIds = {
  backlog: "state-backlog",
  automationNeeded: "state-automation-needed",
};

type LinearNeeds = Needs["linear"];

type Answered<K extends keyof LinearNeeds> = Awaited<ReturnType<LinearNeeds[K]>>;

// The answers a method gives, call by call; a call past the list, or an undefined entry, is
// answered as Linear answers when all is well. A promise that never settles is no answer at all.
export type Script = {
  readonly [K in keyof LinearNeeds]?: ReadonlyArray<Answered<K> | Promise<never> | undefined>;
};

export const NO_ANSWER: Promise<never> = new Promise(() => undefined);

// A Linear that files OLI-42 upward, one number per create asked (an unanswered one included),
// and keeps every request in `asked`, in order.
export const fakeLinear = (script: Script = {}) => {
  const asked: Array<string> = [];
  const created: Array<Linear.CreateIssueInput> = [];
  const described = new Map<string, string>();
  const made = new Map<keyof LinearNeeds, number>();
  const answer = async <K extends keyof LinearNeeds>(
    method: K,
    said: string,
    otherwise: Answered<K>,
  ): Promise<Answered<K>> => {
    asked.push(said);
    const call = made.get(method) ?? 0;
    made.set(method, call + 1);
    const scripted: Answered<K> | Promise<never> | undefined = script[method]?.[call];
    return scripted ?? otherwise;
  };
  const done = jarl.ok(undefined);
  const linear: LinearNeeds = {
    teamId: () => answer("teamId", "teamId", jarl.ok("team-1")),
    labelIds: (_teamId, version) =>
      answer("labelIds", `labelIds ${version}`, jarl.ok(["label-agent-test", `label-${version}`])),
    assigneeId: () => answer("assigneeId", "assigneeId", jarl.ok("user-1")),
    stateIds: () => answer("stateIds", "stateIds", jarl.ok(STATES)),
    createIssue: (input) => {
      created.push(input);
      const identifier = `OLI-${String(42 + (made.get("createIssue") ?? 0))}`;
      return answer("createIssue", `createIssue ${input.title}`, jarl.ok(ticketNamed(identifier)));
    },
    describeIssue: (ticket, description, stateId) => {
      described.set(ticket.identifier, description);
      return answer("describeIssue", `describeIssue ${ticket.identifier} ${stateId}`, done);
    },
    issueStateId: (ticket) =>
      answer("issueStateId", `issueStateId ${ticket.identifier}`, jarl.ok(STATES.automationNeeded)),
    markReady: (ticket) => answer("markReady", `markReady ${ticket}`, done),
    clearReady: (ticket) => answer("clearReady", `clearReady ${ticket}`, done),
    moveToErrored: (ticket, message) =>
      answer("moveToErrored", `moveToErrored ${ticket}: ${message}`, done),
    moveToNeedsReview: (ticket) => answer("moveToNeedsReview", `moveToNeedsReview ${ticket}`, done),
    moveToFailed: (ticket) => answer("moveToFailed", `moveToFailed ${ticket}`, done),
    moveToSucceeded: (ticket) => answer("moveToSucceeded", `moveToSucceeded ${ticket}`, done),
    moveToAborted: (ticket) => answer("moveToAborted", `moveToAborted ${ticket}`, done),
  };
  return { linear, asked, created, described };
};

export const TEST_TEMPLATE =
  "<p>{{LINEAR_TICKET}} {{TEST_NAME}} v{{VERSION}} run {{RUN_ID}} result {{RESULT_ID}}</p>" +
  "<p>{{ISO_URL}} on {{SERVER_URL}}</p>" +
  "<p>{{TEST_DESCRIPTION}} | {{TEST_INSTRUCTION}} | {{TEST_PROOF}}</p>" +
  "<p>{{SUB_AGENT}}</p><pre>{{CLIENT_MD}}</pre><pre>{{CTRL_MD}}</pre>";

export const MINT_TEMPLATE =
  "<p>{{LINEAR_TICKET}} mint on {{PINNED_SERVER}} run {{RUN_ID}} result {{RESULT_ID}}</p>" +
  "<p>{{ISO_URL}} on {{SERVER_URL}}</p>" +
  "<p>{{INSTALL_NAME}}: {{INSTALL_DESCRIPTION}} | {{INSTALL_INSTRUCTION}} | {{INSTALL_PROOF}}</p>" +
  "<pre>{{CTRL_MD}}</pre>";

export const PROMPT_FILES: Readonly<Record<string, string>> = {
  "prompts/linear-issue.html": TEST_TEMPLATE,
  "prompts/mint-issue.html": MINT_TEMPLATE,
  "client.md": "client guide\n",
  "ctrl-linear.md": "ctrl guide\n",
};

// The checkout's files as the test gives them, keeping every path read in `read`.
export const fakePrompts = (files: Readonly<Record<string, string>> = PROMPT_FILES) => {
  const read: Array<string> = [];
  const prompts: Templates.Prompts = {
    read: async (path) => {
      read.push(path);
      const text = files[path];
      return text === undefined
        ? jarl.err({ message: `ENOENT: no such file or directory, open '${path}'` })
        : jarl.ok(text);
    },
  };
  return { prompts, read };
};

export const definitionRow = (id: number, name: string): Stores.Tests.DefinitionRow => ({
  id,
  name,
  description: `${name} description`,
  instruction: `${name} instruction`,
  proof: `${name} proof`,
  createdAt: new Date(0),
});

export const resultRow = (row: Partial<Job> = {}): Job => ({
  id: "result-1",
  runId: "run-1",
  definitionId: 1,
  sessionId: null,
  model: null,
  linearId: "OLI-42",
  status: "passed",
  reason: null,
  createdAt: new Date(0),
  finishedAt: null,
  ...row,
});

export const actionRow = (row: Partial<Action> = {}): Action => ({
  id: "action-1",
  resultId: "result-1",
  action: "drive",
  status: "running",
  reason: null,
  serverId: null,
  createdAt: new Date(0),
  startedAt: null,
  finishedAt: null,
  ...row,
});

// A tests store over `definitions`: runs are run-1 upward and results result-1 upward; every
// failRun and Linear id written is kept.
export const fakeTests = (
  definitions: ReadonlyArray<Stores.Tests.DefinitionRow> = [
    definitionRow(1, "alpha"),
    definitionRow(2, "beta"),
  ],
  overrides: Partial<Needs["tests"]> = {},
) => {
  const failed: Array<{ runId: string; reason: string; resultIds: ReadonlyArray<string> }> = [];
  const linked: Array<string> = [];
  let runs = 0;
  let results = 0;
  const tests = only<Needs["tests"]>({
    listTestDefinitions: async () => jarl.ok(definitions),
    findTestDefinition: async (name) =>
      jarl.ok(definitions.find((definition) => definition.name === name)),
    createRun: async (input) => {
      runs += 1;
      return jarl.ok({
        runId: `run-${String(runs)}`,
        results: input.definitions.map((definition) => {
          results += 1;
          return { id: `result-${String(results)}`, definitionId: definition.id };
        }),
      });
    },
    failRun: async (runId, reason, resultIds) => {
      failed.push({ runId, reason, resultIds });
      return jarl.ok(undefined);
    },
    setLinearId: async (resultId, linearId) => {
      linked.push(`${resultId} ${linearId}`);
      return jarl.ok(undefined);
    },
    ...overrides,
  });
  return { tests, failed, linked };
};
