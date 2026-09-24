import { readFileSync } from "node:fs";
import { Option } from "effect";

const TEMPLATE = "custom-harness-driving-agent.html";

// The driving prompt for this loop: one back and forth, one tool call back.
// Reasons, definition, proof, the client tools, and the model's last reply are filled on
// each turn.
export const template = readFileSync(
  new URL(`../../prompts/${TEMPLATE}`, import.meta.url),
  "utf8",
).trimEnd();

// The names this file uses. A value is inserted once, so a definition that
// itself contains {{NAME}} stays that text.
const PLACEHOLDER = /\{\{(TEST_DEFINITION|TEST_PROOF|REASONS|CLIENT_TOOLS|RESPONSE)\}\}/g;

// The first ask has no reply before it, so the whole element goes, not only its placeholder.
const LAST_RESPONSE = /\n*<last-response>[\s\S]*?<\/last-response>/;

export type Values = {
  readonly TEST_DEFINITION: string;
  readonly TEST_PROOF: string;
  readonly REASONS: string;
  readonly CLIENT_TOOLS: string;
  readonly RESPONSE: Option.Option<string>;
};

export const render = (values: Values): string => {
  const filled = {
    TEST_DEFINITION: values.TEST_DEFINITION,
    TEST_PROOF: values.TEST_PROOF,
    REASONS: values.REASONS,
    CLIENT_TOOLS: values.CLIENT_TOOLS,
    RESPONSE: Option.getOrElse(values.RESPONSE, () => ""),
  };
  const shown = Option.isSome(values.RESPONSE) ? template : template.replace(LAST_RESPONSE, "");
  return shown.replace(PLACEHOLDER, (_match: string, name: keyof typeof filled) => filled[name]);
};
