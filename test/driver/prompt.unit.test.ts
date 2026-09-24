import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Prompt from "../../src/driver/prompt.ts";
import * as Reply from "../../src/driver/reply.ts";

const CLIENT =
  '{"name":"client","arguments":{"reason":"why, in a few words","args":["start","--agent-id","OLI-1"]}}';
const DONE = '{"name":"Done","arguments":{}}';

describe("openrouter-driving-agent.html", () => {
  it("requires one tool call, and Done leaves the loop", () => {
    const file = readFileSync(
      new URL("../../prompts/openrouter-driving-agent.html", import.meta.url),
      "utf8",
    );
    expect(Prompt.text).toBe(file.trimEnd());
    expect(Prompt.text).toContain("You MUST use a tool");
    expect(Prompt.text).toContain("one line");
    expect(Prompt.text).toContain("tool call JSON");
    expect(Prompt.text).toContain(CLIENT);
    expect(Prompt.text).toContain(DONE);
    expect(Prompt.text).toContain("./client");
    expect(Prompt.text).toContain("Do not call intent");
    expect(Prompt.text).not.toContain("{{");
    expect(Prompt.text).not.toContain("three lines");
    expect(Result.isSuccess(Reply.parse(CLIENT))).toBe(true);
    const done = Reply.parse(DONE);
    expect(Result.isSuccess(done)).toBe(true);
    if (Result.isSuccess(done)) {
      expect(done.success).toEqual({ _tag: "Done" });
    }
  });
});
