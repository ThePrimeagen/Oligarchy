import { Array as Arr, Effect, FileSystem, Option, Result } from "effect";
import * as Errors from "../shared/errors.ts";

// Every text ctrl hands an agent is one of the templates under `prompts/`, filled from a value map
// by `render`; the guides an agent needs are read beside the package and embedded as values.

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

// The ticket template and the two guides it embeds, read once per `test new`.
export type IssuePrompts = {
  readonly linearIssue: string;
  readonly clientMd: string;
  readonly ctrlMd: string;
};

// The reviewer's kickoff and the one guide it embeds, read once per `diagnose run`.
export type DiagnosisPrompts = {
  readonly diagnosingAgent: string;
  readonly ctrlMd: string;
};

const LINEAR_ISSUE_FILE = "linear-issue.html";
const DRIVING_AGENT_FILE = "driving-agent.html";
const DIAGNOSING_AGENT_FILE = "diagnosing-agent.html";

// The files sit beside the package, not the working directory: resolve them from this module.
const besideModule = (relative: string): string =>
  decodeURIComponent(new URL(relative, import.meta.url).pathname);

const PATHS = {
  linearIssue: besideModule(`../../prompts/${LINEAR_ISSUE_FILE}`),
  drivingAgent: besideModule(`../../prompts/${DRIVING_AGENT_FILE}`),
  diagnosingAgent: besideModule(`../../prompts/${DIAGNOSING_AGENT_FILE}`),
  clientMd: besideModule("../../client.md"),
  ctrlLinearMd: besideModule("../../ctrl-linear.md"),
  ctrlDiagnoseMd: besideModule("../../ctrl-diagnose.md"),
};

const read = Effect.fn("Prompts.read")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .readFileString(path)
    .pipe(
      Effect.mapError((error) =>
        Errors.PromptError.make({ message: `prompt: ${error.message}`, cause: error }),
      ),
    );
});

// Each command reads only the templates it renders, so an unreadable guide cannot stop a command
// that never embeds it.
export const loadDrivingPrompt: Effect.Effect<string, Errors.PromptError, FileSystem.FileSystem> =
  read(PATHS.drivingAgent);

export const loadIssuePrompts: Effect.Effect<
  IssuePrompts,
  Errors.PromptError,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  return {
    linearIssue: yield* read(PATHS.linearIssue),
    clientMd: yield* read(PATHS.clientMd),
    ctrlMd: yield* read(PATHS.ctrlLinearMd),
  } satisfies IssuePrompts;
});

export const loadDiagnosisPrompts: Effect.Effect<
  DiagnosisPrompts,
  Errors.PromptError,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  return {
    diagnosingAgent: yield* read(PATHS.diagnosingAgent),
    ctrlMd: yield* read(PATHS.ctrlDiagnoseMd),
  } satisfies DiagnosisPrompts;
});

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

// Fills every `{{NAME}}` in the template from the values; the first name without a value fails
// the whole rendering, naming the template file it came from.
export const render = (
  template: string,
  file: string,
  values: Readonly<Record<string, string>>,
): Result.Result<string, Errors.PromptError> => {
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
        Errors.PromptError.make({
          message: `prompt: prompts/${file} uses {{${name}}}, which has no value`,
        }),
      ),
  });
};

export const linearTicketDescription = (
  experiment: Experiment,
  test: ExperimentTest,
  ticket: string,
  prompts: IssuePrompts,
): Result.Result<string, Errors.PromptError> =>
  render(prompts.linearIssue, LINEAR_ISSUE_FILE, {
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
): Result.Result<string, Errors.PromptError> =>
  render(template, DRIVING_AGENT_FILE, { LINEAR_TICKET: ticket });

// The session and the proxy are all the reviewer is told; everything else it reads back with ctrl.
export const diagnosingAgentPrompt = (
  sessionId: string,
  serverUrl: string,
  prompts: DiagnosisPrompts,
): Result.Result<string, Errors.PromptError> =>
  render(prompts.diagnosingAgent, DIAGNOSING_AGENT_FILE, {
    SESSION_ID: sessionId,
    SERVER_URL: serverUrl,
    CTRL_MD: prompts.ctrlMd.trimEnd(),
  });
