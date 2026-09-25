import { readFileSync } from "node:fs";
import { Option } from "effect";
import * as Oligarchy from "@oligarchy/env/oligarchy";

const TEMPLATE = "custom-harness-driving-agent.html";

// The driving prompt for this loop: one back and forth, one tool call back.
// Reasons, definition, proof, the client tools, the model's last reply, and the action the
// screenshot is the result of are filled on each turn.
export const template = readFileSync(
  new URL(`prompts/${TEMPLATE}`, Oligarchy.ROOT),
  "utf8",
).trimEnd();

// The names this file uses. A value is inserted once, so a definition that
// itself contains {{NAME}} stays that text.
const PLACEHOLDER =
  /\{\{(TEST_DEFINITION|TEST_PROOF|REASONS|CLIENT_TOOLS|RESPONSE|PREVIOUS_ACTION|PREVIOUS_VALUES)\}\}/g;

// The first ask has no reply before it, so the whole element goes, not only its placeholder.
const LAST_RESPONSE = /\n*<last-response>[\s\S]*?<\/last-response>/;
// Nor does an ask with no screenshot, or one no action came before.
const PREVIOUS_MOVE = /\n*<previous-move>[\s\S]*?<\/previous-move>/;

export type Values = {
  readonly TEST_DEFINITION: string;
  readonly TEST_PROOF: string;
  readonly REASONS: string;
  readonly CLIENT_TOOLS: string;
  readonly RESPONSE: Option.Option<string>;
  // The action as the guest ran it, without the harness's own flags.
  readonly PREVIOUS: Option.Option<ReadonlyArray<string>>;
};

// A guest action's flags all take a value, so each is `--name value` or `--name=value`, and
// the action is the words before the first one.
const described = (
  args: ReadonlyArray<string>,
): { readonly action: string; readonly values: string } => {
  const words: Array<string> = [];
  const values: Record<string, string> = {};
  let flagged = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("--")) {
      if (!flagged) {
        words.push(arg);
      }
      continue;
    }
    flagged = true;
    const equals = arg.indexOf("=");
    if (equals !== -1) {
      values[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
    values[arg.slice(2)] = args[index + 1] ?? "";
    index += 1;
  }
  return { action: words.join(" "), values: JSON.stringify(values) };
};

export const render = (values: Values): string => {
  const previous = Option.map(values.PREVIOUS, described);
  const filled = {
    TEST_DEFINITION: values.TEST_DEFINITION,
    TEST_PROOF: values.TEST_PROOF,
    REASONS: values.REASONS,
    CLIENT_TOOLS: values.CLIENT_TOOLS,
    RESPONSE: Option.getOrElse(values.RESPONSE, () => ""),
    PREVIOUS_ACTION: Option.match(previous, { onNone: () => "", onSome: (p) => p.action }),
    PREVIOUS_VALUES: Option.match(previous, { onNone: () => "", onSome: (p) => p.values }),
  };
  let shown = Option.isSome(values.RESPONSE) ? template : template.replace(LAST_RESPONSE, "");
  shown = Option.isSome(previous) ? shown : shown.replace(PREVIOUS_MOVE, "");
  return shown.replace(PLACEHOLDER, (_match: string, name: keyof typeof filled) => filled[name]);
};
