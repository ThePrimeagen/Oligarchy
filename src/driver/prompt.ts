import { readFileSync } from "node:fs";
import { Result } from "effect";
import * as Errors from "../shared/errors.ts";

const TEMPLATE = "custom-harness-driving-agent.html";

// The driving prompt for this loop: one back and forth, one tool call back.
// Step, reasons, definition, proof, and the client tools are filled on each turn.
export const template = readFileSync(
  new URL(`../../prompts/${TEMPLATE}`, import.meta.url),
  "utf8",
).trimEnd();

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

// The server writes the definition and the proof into the task. A task with neither tag is
// its own definition and has no separate proof.
export type Mission = {
  readonly definition: string;
  readonly proof: string;
};

const promptError = (message: string): Errors.PromptError => Errors.PromptError.make({ message });

const tag = (
  text: string,
  name: string,
): { readonly found: boolean; readonly value: string | undefined } => {
  const open = `<${name}>`;
  const start = text.indexOf(open);
  if (start === -1) {
    return { found: false, value: undefined };
  }
  const from = start + open.length;
  const end = text.indexOf(`</${name}>`, from);
  if (end === -1) {
    return { found: true, value: undefined };
  }
  return { found: true, value: text.slice(from, end).trim() };
};

export const mission = (task: string): Result.Result<Mission, Errors.PromptError> => {
  const instruction = tag(task, "instruction");
  const proof = tag(task, "proof");
  if (!instruction.found && !proof.found) {
    return Result.succeed({ definition: task, proof: "none" });
  }
  if (!instruction.found || instruction.value === undefined) {
    return Result.fail(promptError("prompt: the task's test definition is missing"));
  }
  if (!proof.found || proof.value === undefined) {
    return Result.fail(promptError("prompt: the task's test proof is missing"));
  }
  return Result.succeed({ definition: instruction.value, proof: proof.value });
};

// Fills every `{{NAME}}`. The first name without a value fails, naming this template.
export const render = (
  values: Readonly<Record<string, string>>,
): Result.Result<string, Errors.PromptError> => {
  const missing: Array<string> = [];
  const filled = template.replace(PLACEHOLDER, (match: string, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing.push(name);
      return match;
    }
    return value;
  });
  const name = missing[0];
  if (name === undefined) {
    return Result.succeed(filled);
  }
  return Result.fail(
    promptError(`prompt: prompts/${TEMPLATE} uses {{${name}}}, which has no value`),
  );
};
