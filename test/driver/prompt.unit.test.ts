import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Prompt from "../../src/driver/prompt.ts";
import * as Reply from "../../src/driver/reply.ts";

const CLIENT =
  '{"name":"client","arguments":{"reason":"why, in a few words","args":["get-image"]}}';
const DONE = '{"name":"Done","arguments":{}}';
const EXAMPLE =
  '{"name":"client","arguments":{"reason":"type the password","args":["send-keys","--keys","prime<ENTER>"]}}';

const FILLED = {
  TEST_DEFINITION: "Lock the screen from the menu.",
  TEST_PROOF: "The screen is locked.",
  REASONS: "open the menu: menu is up",
  CLIENT_TOOLS: "# Client\n\n./client start --agent-id OLI-1",
};

const file = (): string =>
  readFileSync(new URL("../../prompts/custom-harness-driving-agent.html", import.meta.url), "utf8");

describe("custom-harness-driving-agent.html", () => {
  it("shows tool calls the reply parser accepts", () => {
    const text = file();
    expect(Prompt.template).toBe(text.trimEnd());
    expect(text).toContain(CLIENT);
    expect(text).toContain(DONE);
    expect(text).toContain(EXAMPLE);
    expect(text).toContain("{{TEST_DEFINITION}}");
    expect(text).toContain("{{TEST_PROOF}}");
    expect(text).toContain("{{REASONS}}");
    expect(text).toContain("{{CLIENT_TOOLS}}");
    expect(Result.isSuccess(Reply.parse(CLIENT))).toBe(true);
    expect(Result.isSuccess(Reply.parse(EXAMPLE))).toBe(true);
    const done = Reply.parse(DONE);
    expect(Result.isSuccess(done)).toBe(true);
    if (Result.isSuccess(done)) {
      expect(done.success).toEqual({ _tag: "Done" });
    }
  });

  it("has no step number and no step-status for the model to track (unhappy)", () => {
    const text = file();
    expect(text).not.toContain("{{STEP}}");
    expect(text).not.toContain("This is step");
    expect(text).not.toContain("step-status");
    expect(text).not.toMatch(/"completed"|"continue"/);
  });

  it("fills the definition, the proof, the reasons, and the client tools", () => {
    const rendered = Prompt.render(FILLED);
    expect(rendered).toContain("Lock the screen from the menu.");
    expect(rendered).toContain("The screen is locked.");
    expect(rendered).toContain("open the menu: menu is up");
    expect(rendered).toContain("# Client");
    expect(rendered).toContain("./client start --agent-id OLI-1");
    expect(rendered).not.toContain("{{");
    expect(rendered).toContain(EXAMPLE);
  });

  it("leaves a placeholder that arrives inside a value", () => {
    const rendered = Prompt.render({
      ...FILLED,
      TEST_DEFINITION: "see {{TEST_PROOF}}",
      TEST_PROOF: "locked",
    });
    expect(rendered).toContain("see {{TEST_PROOF}}");
    expect(rendered).toContain("<proof>\nlocked\n</proof>");
  });
});
