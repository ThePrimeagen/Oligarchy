import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { PromptError } from "../src/errors.ts";
import { renderLinearIssue, renderMintIssue, SUB_AGENT } from "../src/templates.ts";
import { errorOf, fakePrompts, TEST_TEMPLATE } from "./support.ts";

const VALUES = {
  LINEAR_TICKET: "OLI-42",
  RUN_ID: "run-1",
  RESULT_ID: "result-1",
  VERSION: "3.4.0",
  ISO_URL: "https://iso.omarchy.org/omarchy-3.4.0.iso",
  SERVER_URL: "http://proxy:8080",
  TEST_NAME: "wifi",
  TEST_DESCRIPTION: "joins a network",
  TEST_INSTRUCTION: "open the wifi menu",
  TEST_PROOF: "a screenshot of the network",
};

const MINT_VALUES = {
  LINEAR_TICKET: "OLI-43",
  RUN_ID: "run-2",
  RESULT_ID: "result-2",
  ISO_URL: VALUES.ISO_URL,
  SERVER_URL: VALUES.SERVER_URL,
  PINNED_SERVER: "http://qemu-1:9000",
  INSTALL_NAME: "mint",
  INSTALL_DESCRIPTION: "installs omarchy",
  INSTALL_INSTRUCTION: "run the installer",
  INSTALL_PROOF: "the desktop",
};

const expectPromptError = (error: unknown, message: string) => {
  expect(jarl.error.is(error, PromptError)).toBe(true);
  expect(error).toHaveProperty("message", message);
};

describe("rendering a ticket body", () => {
  it("fills a test ticket's values, the sub-agent, and the guides it names, trimmed (happy)", async () => {
    const { prompts, read } = fakePrompts();

    const rendered = await renderLinearIssue(prompts, VALUES);

    expect(rendered).toEqual(
      jarl.ok(
        "<p>OLI-42 wifi v3.4.0 run run-1 result result-1</p>" +
          "<p>https://iso.omarchy.org/omarchy-3.4.0.iso on http://proxy:8080</p>" +
          "<p>joins a network | open the wifi menu | a screenshot of the network</p>" +
          `<p>${SUB_AGENT}</p><pre>client guide</pre><pre>ctrl guide</pre>`,
      ),
    );
    expect(read).toEqual(["prompts/linear-issue.html", "client.md", "ctrl-linear.md"]);
  });

  it("is a PromptError naming the first placeholder without a value, and the template (error)", async () => {
    const { prompts } = fakePrompts({
      "prompts/linear-issue.html": "{{LINEAR_TICKET}} {{NOPE}} {{ALSO_NOPE}}",
    });

    const rendered = await renderLinearIssue(prompts, VALUES);

    expectPromptError(
      errorOf(rendered),
      "prompt: prompts/linear-issue.html uses {{NOPE}}, which has no value",
    );
  });

  it("is a PromptError saying why for a template that will not read, and reads no guide (error)", async () => {
    const { prompts, read } = fakePrompts({ "client.md": "client guide\n" });

    const rendered = await renderLinearIssue(prompts, VALUES);

    expectPromptError(
      errorOf(rendered),
      "prompt: ENOENT: no such file or directory, open 'prompts/linear-issue.html'",
    );
    expect(read).toEqual(["prompts/linear-issue.html"]);
  });

  it("is a PromptError saying why for a guide the template names that will not read (error)", async () => {
    const { prompts } = fakePrompts({
      "prompts/linear-issue.html": TEST_TEMPLATE,
      "ctrl-linear.md": "ctrl guide\n",
    });

    const rendered = await renderLinearIssue(prompts, VALUES);

    expectPromptError(
      errorOf(rendered),
      "prompt: ENOENT: no such file or directory, open 'client.md'",
    );
  });

  it("does not read, or need, a guide the template does not name (error)", async () => {
    const { prompts, read } = fakePrompts({
      "prompts/linear-issue.html": "{{LINEAR_TICKET}} {{TEST_NAME}}",
    });

    const rendered = await renderLinearIssue(prompts, VALUES);

    expect(rendered).toEqual(jarl.ok("OLI-42 wifi"));
    expect(read).toEqual(["prompts/linear-issue.html"]);
  });

  it("reads a mint ticket from mint-issue.html, and names it for a missing value (error)", async () => {
    const { prompts, read } = fakePrompts({
      "prompts/mint-issue.html": "{{PINNED_SERVER}} {{VERSION}}",
    });

    const rendered = await renderMintIssue(prompts, MINT_VALUES);

    expectPromptError(
      errorOf(rendered),
      "prompt: prompts/mint-issue.html uses {{VERSION}}, which has no value",
    );
    expect(read).toEqual(["prompts/mint-issue.html"]);
  });
});
