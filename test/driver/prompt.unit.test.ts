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
  STEP: "4",
  REASONS: "open the menu: menu is up",
  CLIENT_TOOLS: "# Client\n\n./client start --agent-id OLI-1",
};

const file = (): string =>
  readFileSync(new URL("../../prompts/custom-harness-driving-agent.html", import.meta.url), "utf8");

describe("custom-harness-driving-agent.html", () => {
  it("names the tool call, Done, the context example, and the screenshot rules", () => {
    const text = file();
    expect(Prompt.template).toBe(text.trimEnd());
    expect(text).toContain("You MUST use a tool");
    expect(text).toContain("one line");
    expect(text).toContain("tool call JSON");
    expect(text).toContain(CLIENT);
    expect(text).toContain(DONE);
    expect(text).toContain("./client");
    expect(text).toContain("Do not call intent");
    expect(text).toContain("Do not call start, stop, or save.");
    expect(text).toContain("The harness starts the guest and stops it when you call Done.");
    expect(text).toContain("{{TEST_DEFINITION}}");
    expect(text).toContain("{{TEST_PROOF}}");
    expect(text).toContain("{{STEP}}");
    expect(text).toContain("{{REASONS}}");
    expect(text).toContain("{{CLIENT_TOOLS}}");
    expect(text).toContain("<context>");
    expect(text).toContain("</context>");
    expect(text).toContain("your response should look like");
    expect(text).toContain(EXAMPLE);
    expect(text).toContain("When you are done, call Done. You are done.");
    expect(text).toContain("If a screenshot is not good enough, take another screenshot.");
    expect(text).toContain("Never take more than two screenshots in a row.");
    expect(text).not.toContain("three lines");
    expect(text).not.toContain("openrouter");
    expect(Result.isSuccess(Reply.parse(CLIENT))).toBe(true);
    expect(Result.isSuccess(Reply.parse(EXAMPLE))).toBe(true);
    const done = Reply.parse(DONE);
    expect(Result.isSuccess(done)).toBe(true);
    if (Result.isSuccess(done)) {
      expect(done.success).toEqual({ _tag: "Done" });
    }
  });

  it("fills the definition, the proof, the step, the reasons, and the client tools", () => {
    const rendered = Prompt.render(FILLED);
    expect(rendered).toContain("Lock the screen from the menu.");
    expect(rendered).toContain("The screen is locked.");
    expect(rendered).toContain("This is step 4.");
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
