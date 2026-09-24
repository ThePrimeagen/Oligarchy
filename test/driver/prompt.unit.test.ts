import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as Prompt from "../../src/driver/prompt.ts";

describe("openrouter-driving-agent.html", () => {
  it("is the driving prompt, and it states the three lines", () => {
    const file = readFileSync(
      new URL("../../prompts/openrouter-driving-agent.html", import.meta.url),
      "utf8",
    );
    expect(Prompt.text).toBe(file.trimEnd());
    expect(Prompt.text).toContain("complete ends the run");
    expect(Prompt.text).toContain("continue");
    expect(Prompt.text).toContain("what you did");
    expect(Prompt.text).toContain("next action");
    expect(Prompt.text).toContain("action you took");
    expect(Prompt.text).toContain("./client");
    expect(Prompt.text).not.toContain("{{");
  });
});
