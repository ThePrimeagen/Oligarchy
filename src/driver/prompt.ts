import { readFileSync } from "node:fs";

// The driving prompt for this loop: one back and forth, one tool call back.
export const text = readFileSync(
  new URL("../../prompts/openrouter-driving-agent.html", import.meta.url),
  "utf8",
).trimEnd();
