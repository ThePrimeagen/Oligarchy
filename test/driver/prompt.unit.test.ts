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

  it("is the diagnosing prompt, and it names ./ctrl rather than ./client", () => {
    const file = readFileSync(
      new URL("../../prompts/openrouter-diagnosing-agent.html", import.meta.url),
      "utf8",
    );
    expect(Prompt.diagnoseText).toBe(file.trimEnd());
    expect(Prompt.diagnoseText).toContain("./ctrl");
    expect(Prompt.diagnoseText).toContain("./session");
    expect(Prompt.diagnoseText).toContain("Do not call ./client");
    expect(Prompt.diagnoseText).toContain("Do not call intent");
    expect(Prompt.diagnoseText).not.toContain("{{");
  });
});
