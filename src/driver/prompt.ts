import { readFileSync } from "node:fs";

const TEMPLATE = "custom-harness-driving-agent.html";

// The driving prompt for this loop: one back and forth, one tool call back.
// Step, reasons, definition, proof, and the client tools are filled on each turn.
export const template = readFileSync(
  new URL(`../../prompts/${TEMPLATE}`, import.meta.url),
  "utf8",
).trimEnd();

// The five names this file uses. A value is inserted once, so a definition that
// itself contains {{NAME}} stays that text.
const PLACEHOLDER = /\{\{(TEST_DEFINITION|TEST_PROOF|STEP|REASONS|CLIENT_TOOLS)\}\}/g;

export type Values = {
  readonly TEST_DEFINITION: string;
  readonly TEST_PROOF: string;
  readonly STEP: string;
  readonly REASONS: string;
  readonly CLIENT_TOOLS: string;
};

export const render = (values: Values): string =>
  template.replace(PLACEHOLDER, (_match: string, name: keyof Values) => values[name]);
