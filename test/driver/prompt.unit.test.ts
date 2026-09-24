import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Prompt from "../../src/driver/prompt.ts";
import * as Reply from "../../src/driver/reply.ts";

const CLIENT =
  '{"name":"client","arguments":{"reason":"why, in a few words","args":["start","--agent-id","OLI-1"]}}';
const DONE = '{"name":"Done","arguments":{}}';
const EXAMPLE =
  '{"name":"client","arguments":{"reason":"type the password","args":["send-keys","--agent-id","OLI-1","--server-url","https://qemu.example.com","--session-id","aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","--keys","prime<ENTER>"]}}';

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
    expect(Result.isSuccess(rendered)).toBe(true);
    if (Result.isFailure(rendered)) {
      return;
    }
    expect(rendered.success).toContain("Lock the screen from the menu.");
    expect(rendered.success).toContain("The screen is locked.");
    expect(rendered.success).toContain("This is step 4.");
    expect(rendered.success).toContain("open the menu: menu is up");
    expect(rendered.success).toContain("# Client");
    expect(rendered.success).toContain("./client start --agent-id OLI-1");
    expect(rendered.success).not.toContain("{{");
    expect(rendered.success).toContain(EXAMPLE);
  });

  it("reads the instruction and the proof out of the task", () => {
    const task = [
      "<mission>",
      "<name>lock</name>",
      "<instruction>",
      "  Lock the screen from the menu.  ",
      "</instruction>",
      "<proof>The screen is locked.</proof>",
      "</mission>",
    ].join("\n");
    const read = Prompt.mission(task);
    expect(Result.isSuccess(read)).toBe(true);
    if (Result.isSuccess(read)) {
      expect(read.success).toEqual({
        definition: "Lock the screen from the menu.",
        proof: "The screen is locked.",
      });
    }
  });

  it("a task with no mission is its own definition and has no separate proof", () => {
    const read = Prompt.mission("Lock the screen.");
    expect(Result.isSuccess(read)).toBe(true);
    if (Result.isSuccess(read)) {
      expect(read.success).toEqual({ definition: "Lock the screen.", proof: "none" });
    }
  });
});

describe("custom harness prompt unhappy path", () => {
  it("the first placeholder without a value is the one named", () => {
    const { TEST_PROOF: _proof, ...rest } = FILLED;
    const rendered = Prompt.render(rest);
    expect(Result.isFailure(rendered)).toBe(true);
    if (Result.isFailure(rendered)) {
      expect(rendered.failure).toMatchObject({
        _tag: "PromptError",
        message:
          "prompt: prompts/custom-harness-driving-agent.html uses {{TEST_PROOF}}, which has no value",
      });
    }
  });

  it("an instruction without a proof fails and names the proof", () => {
    const read = Prompt.mission("<instruction>lock it</instruction>");
    expect(Result.isFailure(read)).toBe(true);
    if (Result.isFailure(read)) {
      expect(read.failure._tag).toBe("PromptError");
      expect(read.failure.message).toContain("proof");
    }
  });

  it("a proof without an instruction fails and names the definition", () => {
    const read = Prompt.mission("<proof>locked</proof>");
    expect(Result.isFailure(read)).toBe(true);
    if (Result.isFailure(read)) {
      expect(read.failure.message).toContain("definition");
    }
  });

  it("an unclosed instruction fails and names the definition", () => {
    const read = Prompt.mission("<instruction>lock it<proof>locked</proof>");
    expect(Result.isFailure(read)).toBe(true);
    if (Result.isFailure(read)) {
      expect(read.failure.message).toContain("definition");
    }
  });
});
