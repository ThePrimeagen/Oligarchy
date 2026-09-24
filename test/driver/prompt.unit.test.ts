import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Option, Result } from "effect";
import * as Prompt from "../../src/driver/prompt.ts";
import * as Reply from "../../src/driver/reply.ts";

const CLIENT =
  '{"name":"client","arguments":{"step":1,"reason":"why, in a few words","args":["get-image"]}}';
const DONE = '{"name":"Done","arguments":{}}';
const EXAMPLE =
  '{"name":"client","arguments":{"step":1,"reason":"type the password","args":["send-keys","--keys","prime<ENTER>"]}}';

const FILLED = {
  TEST_DEFINITION: "Lock the screen from the menu.",
  TEST_PROOF: "The screen is locked.",
  REASONS: "open the menu: menu is up",
  CLIENT_TOOLS: "# Client\n\n./client start --agent-id OLI-1",
  RESPONSE: Option.some(CLIENT),
  PREVIOUS: Option.none(),
};

const LAST_RESPONSE = `<last-response>
Your last response was
<tool-call>
{{RESPONSE}}
</tool-call>
</last-response>`;

const PREVIOUS_MOVE = `<previous-move>
Your previous action was {{PREVIOUS_ACTION}} with values {{PREVIOUS_VALUES}}
And the screenshot provided is the result of your action
</previous-move>`;

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
    expect(text).toContain(LAST_RESPONSE);
    expect(text).toContain(PREVIOUS_MOVE);
    expect(Result.isSuccess(Reply.parse(CLIENT))).toBe(true);
    expect(Result.isSuccess(Reply.parse(EXAMPLE))).toBe(true);
    const done = Reply.parse(DONE);
    expect(Result.isSuccess(done)).toBe(true);
    if (Result.isSuccess(done)) {
      expect(done.success).toEqual({ _tag: "Done" });
    }
  });

  it("has no step-status and no harness-filled step; the model names its own step (unhappy)", () => {
    const text = file();
    expect(text).not.toContain("{{STEP}}");
    expect(text).not.toContain("This is step");
    expect(text).not.toContain("step-status");
    expect(text).not.toMatch(/"completed"|"continue"/);
  });

  it("tells the model to move the mouse, then validate the pointer on the next image, before clicking", () => {
    const text = file();
    expect(text).toContain(
      "Move the mouse to the location you want to click, then take an image and validate the pointer is in the correct location before clicking.",
    );
  });

  it("tells the model a click and a double-click take no point and a drag names only its end", () => {
    const text = file();
    expect(text).toMatch(/mouse click[^<]*mouse double-click[^<]*no --x or --y/);
    expect(text).toMatch(/mouse drag[^<]*only --to-x and --to-y/);
    expect(text).toMatch(/where the pointer is/);
  });

  it("tells the model the first step is 1, step N is the Nth ActionList line, and one step keeps its number", () => {
    const text = file();
    expect(text).toMatch(/first step is 1/i);
    expect(text).not.toMatch(/first step is 0/i);
    expect(text).toMatch(/ActionList line/);
    expect(text).toMatch(/same step[^<]*same number/i);
  });

  it("tells the model to call Done once the machine is shut down", () => {
    const text = file();
    expect(text).toMatch(/shut down[^<]*call Done/i);
    expect(text).toContain("IMAGE HAS FAILED, MACHINE IS SHUT DOWN");
  });

  it("names no tool the reply parser refuses (unhappy)", () => {
    const text = file();
    expect(text).not.toContain("update_screenshot");
    expect(Result.isFailure(Reply.parse('{"name":"update_screenshot","arguments":{}}'))).toBe(true);
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

  it("shows the model its last response", () => {
    const rendered = Prompt.render({ ...FILLED, RESPONSE: Option.some("hello") });
    expect(rendered).toContain(
      "<last-response>\nYour last response was\n<tool-call>\nhello\n</tool-call>\n</last-response>",
    );
  });

  it("leaves the last response out when there is none (unhappy)", () => {
    const rendered = Prompt.render({ ...FILLED, RESPONSE: Option.none() });
    expect(rendered).not.toContain("last-response");
    expect(rendered).not.toContain("Your last response was");
    expect(rendered).not.toContain("{{");
    expect(rendered).toContain("open the menu: menu is up");
  });

  it("leaves a placeholder that arrives inside the last response (unhappy)", () => {
    const rendered = Prompt.render({ ...FILLED, RESPONSE: Option.some("{{TEST_PROOF}}") });
    expect(rendered).toContain("<tool-call>\n{{TEST_PROOF}}\n</tool-call>");
  });

  it("names the previous action and its flags as JSON, the screenshot its result", () => {
    const rendered = Prompt.render({
      ...FILLED,
      PREVIOUS: Option.some(["mouse", "move", "--x", "0.5", "--y", "0.5"]),
    });
    expect(rendered).toContain(
      '<previous-move>\nYour previous action was mouse move with values {"x":"0.5","y":"0.5"}\nAnd the screenshot provided is the result of your action\n</previous-move>',
    );
    expect(rendered).not.toContain("{{");
  });

  it("leaves the previous move out when there is none (unhappy)", () => {
    const rendered = Prompt.render({ ...FILLED, PREVIOUS: Option.none() });
    expect(rendered).not.toContain("previous-move");
    expect(rendered).not.toContain("Your previous action was");
    expect(rendered).not.toContain("{{");
    expect(rendered).toContain("Your last response was");
  });

  it("reads a --flag=value and leaves a placeholder inside a value as written (unhappy)", () => {
    const rendered = Prompt.render({
      ...FILLED,
      PREVIOUS: Option.some(["send-keys", "--keys={{TEST_PROOF}}<ENTER>"]),
    });
    expect(rendered).toContain(
      'Your previous action was send-keys with values {"keys":"{{TEST_PROOF}}<ENTER>"}',
    );
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
