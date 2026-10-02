import type * as OpenRouter from "@oligarchy/openrouter";
import * as jarl from "jarl";
import type * as Types from "./types.ts";

export const PromptError = jarl.error.define("PromptError");
export type PromptError = InstanceType<typeof PromptError>;

export type ReadFile = (url: URL, encoding: "utf8") => Promise<string>;

const TEMPLATE = "driving-agent.html";

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

// One replacement pass: placeholders in instructions, past reasons and model replies are data.
const fill = (text: string, values: Readonly<Record<string, string>>) => {
  let missing: string | undefined;
  const filled = text.replace(PLACEHOLDER, (match: string, key: string) => {
    if (values[key] === undefined) {
      missing ??= key;
      return match;
    }
    return values[key];
  });
  return missing === undefined
    ? jarl.ok(filled)
    : jarl.err(new PromptError(`prompt: ${TEMPLATE} uses {{${missing}}}, which has no value`));
};

// The driving system prompt for one model turn. Importing this reads nothing.
export const renderer = (readFile: ReadFile) => {
  const read = jarl.fn(
    (url: URL) => readFile(url, "utf8"),
    (cause, url) => {
      const error = new PromptError(`prompt: ${url.pathname}: ${messageOf(cause)}`);
      error.cause = cause;
      return error;
    },
  );
  return async (
    data: Types.JobHarnessData,
    turn: Types.Turn,
    tools: ReadonlyArray<OpenRouter.Tool>,
  ): Promise<jarl.Result<string, PromptError>> => {
    const source = await read(new URL(`../../../prompts/${TEMPLATE}`, import.meta.url));
    if (jarl.is_err(source)) {
      return source;
    }
    let text = jarl.value(source);
    if (turn.response === undefined) {
      text = text.replace(/\n*<last-response>[\s\S]*?<\/last-response>/, "");
    }
    if (turn.previous === undefined) {
      text = text.replace(/\n*<previous-move>[\s\S]*?<\/previous-move>/, "");
    }
    // A stripped section gets no value, so a section the strip missed fails fill.
    return fill(text, {
      JOB_ID: data.jobId,
      RUN_ID: data.runId,
      ACTION: data.action,
      TEST_NAME: data.name,
      TEST_DESCRIPTION: data.description,
      TEST_DEFINITION: data.instruction,
      TEST_PROOF: data.proof,
      TOOLS: JSON.stringify(tools),
      REASONS: turn.reasons,
      ...(turn.response === undefined ? {} : { RESPONSE: turn.response }),
      ...(turn.previous === undefined
        ? {}
        : {
            PREVIOUS_ACTION: turn.previous.name,
            PREVIOUS_VALUES: JSON.stringify(turn.previous.arguments),
          }),
    });
  };
};
