import { readFileSync } from "node:fs";

// The driving prompt for this loop: one back and forth, three lines back.
export const text = readFileSync(
  new URL("../../prompts/OpenRouterDrivingAgent.html", import.meta.url),
  "utf8",
).trimEnd();
