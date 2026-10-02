import { readFile } from "node:fs/promises";
import * as Qemu from "@oligarchy/qemu-http-tools";
import * as jarl from "jarl";
import type { Mission } from "./mission.ts";

export const PromptError = jarl.error.define("PromptError");
export type PromptError = InstanceType<typeof PromptError>;

type Answer = jarl.Result<string, PromptError>;
type Read = (url: URL) => Promise<Answer>;

const read: Read = jarl.fn(
  (url: URL) => readFile(url, "utf8"),
  (cause, url) => {
    const error = new PromptError(`prompt: ${url.pathname}: ${String(cause)}`);
    error.cause = cause;
    return error;
  },
);

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

// One replacement pass: placeholders in instructions, past reasons and model replies are data.
const fill = (text: string, values: Readonly<Record<string, string>>): Answer => {
  let missing: string | undefined;
  const filled = text.replace(PLACEHOLDER, (match: string, name: string) => {
    if (values[name] === undefined) {
      missing ??= name;
      return match;
    }
    return values[name];
  });
  return missing === undefined
    ? jarl.ok(filled)
    : jarl.err(new PromptError(`prompt uses {{${missing}}}, which has no value`));
};

const values = (mission: Mission) => ({
  JOB_ID: mission.jobId,
  RUN_ID: mission.runId,
  ACTION: mission.action,
  TEST_NAME: mission.name,
  TEST_DESCRIPTION: mission.description,
  TEST_DEFINITION: mission.instruction,
  TEST_PROOF: mission.proof,
  // The very same definitions the guest tool runner accepts, without a second catalogue.
  QEMU_TOOLS: JSON.stringify(Qemu.tools),
});

export type Turn = {
  readonly reasons: string;
  readonly response?: string;
  readonly previous?: {
    readonly name: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  };
};

// A module, not a long-lived service. Apps can provide their file IO; importing it reads nothing.
export const create = (io: { readonly read: Read } = { read }) => {
  const template = (name: string) => io.read(new URL(`../../../prompts/${name}`, import.meta.url));
  return {
    agent: async (mission: Mission, options: { readonly model: string }): Promise<Answer> => {
      const source = await template(
        mission.action === "diagnose" ? "diagnosing-agent.html" : "driving-agent.html",
      );
      if (jarl.is_err(source)) {
        return source;
      }
      return fill(jarl.value(source), { ...values(mission), MODEL: options.model });
    },
    harness: async (mission: Mission, turn: Turn): Promise<Answer> => {
      const source = await template("custom-harness-driving-agent.html");
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
      return fill(text, {
        ...values(mission),
        REASONS: turn.reasons,
        RESPONSE: turn.response ?? "",
        PREVIOUS_ACTION: turn.previous?.name ?? "",
        PREVIOUS_VALUES: turn.previous === undefined ? "" : JSON.stringify(turn.previous.arguments),
      });
    },
  };
};
