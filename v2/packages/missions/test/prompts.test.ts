import { readFileSync } from "node:fs";
import * as Qemu from "@oligarchy/qemu-http-tools";
import * as jarl from "jarl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Mission } from "../src/mission.ts";
import * as Prompts from "../src/prompts.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const mission: Mission = {
  jobId: "job-1",
  runId: "run-1",
  action: "drive",
  name: "lock-screen",
  description: "Lock and unlock",
  instruction: "Type {{MODEL}}",
  proof: "Desktop visible",
  iso: "https://iso.example/test.iso",
  serverUrl: "http://proxy:42069",
  resume: true,
};

// Checked-in prompts are fixtures; runtime file IO is supplied by each test.
const contents = Object.fromEntries(
  ["driving-agent.html", "diagnosing-agent.html"].map((name) => [
    name,
    readFileSync(new URL(`../../../prompts/${name}`, import.meta.url), "utf8"),
  ]),
);

const tools = (prompt: string): unknown =>
  JSON.parse(/<tools>([\s\S]*)<\/tools>/.exec(prompt)?.[1] ?? "");

it("renders each mission and the native tool catalogue without reinterpreting inserted text", async () => {
  const readFile = vi.fn(async (url: URL) => contents[url.pathname.split("/").pop() ?? ""] ?? "");
  const prompts = Prompts.create({ readFile });
  const diagnosis = jarl.unwrap(
    await prompts.diagnosing({ ...mission, action: "diagnose" }, { model: "test-model" }),
  );
  expect(diagnosis).toContain("job-1");
  expect(diagnosis).toContain("run-1");
  expect(diagnosis).toContain("Type {{MODEL}}");
  expect(diagnosis).toContain("Desktop visible");
  expect(diagnosis).toContain("test-model");
  expect(diagnosis).toContain("./ctrl diagnose");
  expect(diagnosis).not.toMatch(/LINEAR_TICKET|RESULT_ID|session_id|\.\/client/);
  const first = jarl.unwrap(await prompts.driving(mission, { reasons: "No actions yet" }));
  expect(first).toContain("job-1");
  expect(first).toContain("run-1");
  expect(first).toContain("Type {{MODEL}}");
  expect(first).toContain("Desktop visible");
  expect(first).not.toMatch(/LINEAR_TICKET|RESULT_ID|session_id|\.\/client/);
  expect(first).not.toContain("<last-response>");
  expect(first).not.toContain("<previous-move>");
  expect(tools(first)).toEqual([
    ...Qemu.tools,
    {
      type: "function",
      function: expect.objectContaining({
        name: "Done",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      }),
    },
  ]);
  const next = jarl.unwrap(
    await prompts.driving(mission, {
      reasons: "1. Unlock",
      response: "{{REASONS}}",
      previous: { name: "send_keys", arguments: { keys: "prime<ENTER>" } },
    }),
  );
  expect(next).toContain("1. Unlock");
  expect(next).toContain("{{REASONS}}");
  expect(next).toContain('"keys":"prime<ENTER>"');
});

it("refuses an unknown placeholder in the template", async () => {
  const prompts = Prompts.create({ readFile: async () => "{{JOB_ID}} {{TYPO}}" });
  const result = await prompts.driving(mission, { reasons: "No actions yet" });
  expect(jarl.error.is(result, Prompts.PromptError)).toBe(true);
  if (jarl.is_err(result)) {
    expect(result.error.message).toBe(
      "prompt: driving-agent.html uses {{TYPO}}, which has no value",
    );
  }
});

it("returns a PromptError naming the template it could not read", async () => {
  const cause = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
  const prompts = Prompts.create({
    readFile: async () => {
      throw cause;
    },
  });
  const result = await prompts.driving(mission, { reasons: "No actions yet" });
  expect(jarl.error.is(result, Prompts.PromptError)).toBe(true);
  if (jarl.is_err(result)) {
    const path = new URL("../../../prompts/driving-agent.html", import.meta.url).pathname;
    expect(result.error.message).toBe(`prompt: ${path}: ENOENT: no such file or directory`);
    expect(result.error.cause).toBe(cause);
  }
});
