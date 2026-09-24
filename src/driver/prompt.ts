import { readFileSync } from "node:fs";

// The driving prompt for this loop: one back and forth, three lines back.
export const text = readFileSync(
  new URL("../../prompts/openrouter-driving-agent.html", import.meta.url),
  "utf8",
).trimEnd();

// The diagnosing prompt: the same three lines, and ./ctrl or ./session instead of ./client.
export const diagnoseText = readFileSync(
  new URL("../../prompts/openrouter-diagnosing-agent.html", import.meta.url),
  "utf8",
).trimEnd();
