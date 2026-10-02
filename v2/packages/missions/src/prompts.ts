import { readFile } from "node:fs/promises";
import * as Qemu from "@oligarchy/qemu-http-tools";
import * as jarl from "jarl";
import type { Mission } from "./mission.ts";

export const PromptError = jarl.error.define("PromptError");
export type PromptError = InstanceType<typeof PromptError>;

type Answer = jarl.Result<string, PromptError>;

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

// One replacement pass: placeholders in instructions, past reasons and model replies are data.
const fill = (name: string, text: string, values: Readonly<Record<string, string>>): Answer => {
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
    : jarl.err(new PromptError(`prompt: ${name} uses {{${missing}}}, which has no value`));
};

// The harness's own tool: it ends the loop, so qemu-http-tools never runs it.
const DONE: (typeof Qemu.tools)[number] = {
  type: "function",
  function: {
    name: "Done",
    description: "Finish the driving loop so the harness can save or stop the guest.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

const values = (mission: Mission) => ({
  JOB_ID: mission.jobId,
  RUN_ID: mission.runId,
  ACTION: mission.action,
  TEST_NAME: mission.name,
  TEST_DESCRIPTION: mission.description,
  TEST_DEFINITION: mission.instruction,
  TEST_PROOF: mission.proof,
});

export type Turn = {
  readonly reasons: string;
  readonly response?: string;
  readonly previous?: {
    readonly name: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  };
};

const DRIVING = "driving-agent.html";
const DIAGNOSING = "diagnosing-agent.html";

// A module, not a long-lived service. Apps can provide their file IO; importing it reads nothing.
export const create = (
  io: { readonly readFile: (url: URL, encoding: "utf8") => Promise<string> } = { readFile },
) => {
  const read = jarl.fn(
    (url: URL) => io.readFile(url, "utf8"),
    (cause, url) => {
      const error = new PromptError(`prompt: ${url.pathname}: ${messageOf(cause)}`);
      error.cause = cause;
      return error;
    },
  );
  const template = (name: string) => read(new URL(`../../../prompts/${name}`, import.meta.url));
  return {
    diagnosing: async (mission: Mission, options: { readonly model: string }): Promise<Answer> => {
      const source = await template(DIAGNOSING);
      if (jarl.is_err(source)) {
        return source;
      }
      return fill(DIAGNOSING, jarl.value(source), { ...values(mission), MODEL: options.model });
    },
    driving: async (mission: Mission, turn: Turn): Promise<Answer> => {
      const source = await template(DRIVING);
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
      return fill(DRIVING, text, {
        ...values(mission),
        // The very same definitions the guest tool runner accepts, without a second catalogue.
        TOOLS: JSON.stringify([...Qemu.tools, DONE]),
        REASONS: turn.reasons,
        ...(turn.response === undefined ? {} : { RESPONSE: turn.response }),
        ...(turn.previous === undefined
          ? {}
          : {
              PREVIOUS_ACTION: turn.previous.name,
              PREVIOUS_VALUES: JSON.stringify(turn.previous.arguments),
            }),
      });
    },
  };
};
