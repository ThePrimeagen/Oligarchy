import * as Db from "@oligarchy/db";
import * as Http from "@oligarchy/http";
import * as OpenRouter from "@oligarchy/openrouter";
import * as Qemu from "@oligarchy/qemu-http-tools";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as DriveHarness from "../src/main.ts";
import { data, details, JOB, RUN, said, world } from "./support.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ASK = { model: "test-model", reasoning: "low", deadline: 60_000 } as const;

const asked = { asked: { method: "POST", url: "http://proxy:42069/start" } };

it("drives a job from its harness data to its end", async () => {
  const { harness, calls, requests } = world({
    turns: [
      said("send_keys", { step: 1, reason: "Type the password", keys: "prime<ENTER>" }),
      said("Done", {}),
    ],
  });

  const job = jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.start(job));
  jarl.unwrap(await harness.openStep("Type the password"));
  const first = jarl.unwrap(await harness.prompt(job, { reasons: "none" }));
  const move = jarl.unwrap(await harness.ask({ ...ASK, prompt: first }));
  expect(move).toEqual({
    kind: "guest",
    step: 1,
    reason: "Type the password",
    name: "send_keys",
    arguments: { keys: "prime<ENTER>" },
  });
  if (move.kind !== "guest") throw new Error("expected a guest move");
  expect(jarl.unwrap(await harness.act(move))).toEqual({ text: "sent the keys" });
  const next = jarl.unwrap(
    await harness.prompt(job, {
      reasons: "step 1: Type the password: sent the keys",
      response: "{{REASONS}}",
      previous: { name: move.name, arguments: move.arguments },
    }),
  );
  const screen = new Uint8Array([1, 2]);
  expect(jarl.unwrap(await harness.ask({ ...ASK, prompt: next, screen }))).toEqual({
    kind: "done",
  });
  jarl.unwrap(await harness.closeStep());
  jarl.unwrap(await harness.finish(job, { status: "succeeded" }));

  expect(calls).toEqual([
    ["start", { iso: "https://iso.example/test.iso", resume: true }],
    ["intentStart", "Type the password"],
    ["run", "send_keys", { keys: "prime<ENTER>" }],
    ["intentEnd"],
    ["stop", { status: "succeeded" }],
  ]);

  // Every guest tool asks for its step and reason beside its own arguments, and Done ends the loop.
  const tools = requests[0]?.tools ?? [];
  expect(tools.map((tool) => tool.function.name)).toEqual(["send_keys", "Done"]);
  expect(tools[0]?.function.parameters).toMatchObject({
    properties: { keys: { type: "string", minLength: 1 }, step: {}, reason: {} },
    required: ["keys", "step", "reason"],
  });
  expect(tools[1]?.function.parameters).toEqual({
    type: "object",
    properties: {},
    additionalProperties: false,
  });
  expect(
    requests.map(({ model, reasoning, deadline }) => ({ model, reasoning, deadline })),
  ).toEqual([ASK, ASK]);

  // The system prompt is the job's, with the same tools; inserted text is never filled again.
  const system = (index: number) => {
    const message = requests[index]?.messages[0];
    return message?.role === "system" ? message.content : "";
  };
  for (const prompt of [system(0), system(1)]) {
    expect(prompt).toContain(JOB);
    expect(prompt).toContain(RUN);
    expect(prompt).toContain("Type {{MODEL}}");
    expect(prompt).toContain("The desktop is visible");
    expect(JSON.parse(/<tools>([\s\S]*)<\/tools>/.exec(prompt)?.[1] ?? "")).toEqual(tools);
  }
  expect(system(0)).not.toContain("<last-response>");
  expect(system(0)).not.toContain("<previous-move>");
  expect(system(1)).toContain("{{REASONS}}");
  expect(system(1)).toContain('"keys":"prime<ENTER>"');

  // A screenshot goes to the model beside the ask; without one the ask is text alone.
  expect(requests[0]?.messages[1]).toEqual({ role: "user", content: expect.any(String) });
  expect(requests[1]?.messages[1]).toEqual({
    role: "user",
    content: [
      { type: "text", text: expect.any(String) },
      { type: "image_url", image_url: { url: "data:image/png;base64,AQI=" } },
    ],
  });
});

it("loads the job's harness data and derives its boot mode from its action and definition", async () => {
  for (const [action, resumes, expected] of [
    ["drive", true, true],
    ["drive", false, false],
    ["setup", true, false],
  ] as const) {
    const getJobDetails = vi.fn(async () => jarl.ok(details(action, resumes)));
    const { harness } = world({ getJobDetails });
    expect(jarl.unwrap(await harness.loadJobHarnessData(JOB))).toEqual({
      ...data(action, resumes),
      resume: expected,
    });
    expect(getJobDetails).toHaveBeenCalledExactlyOnceWith(JOB);
  }
});

it.each([
  ["a missing job", new Stores.Tests.NotFound("getJobDetails: no job")],
  ["a database failure", new Db.DatabaseError("database refused the lookup")],
])("returns %s without harness data", async (_, error) => {
  const { harness } = world({ getJobDetails: async () => jarl.err(error) });
  const result = await harness.loadJobHarnessData(JOB);
  expect(jarl.is_err(result)).toBe(true);
  if (jarl.is_err(result)) expect(result.error).toBe(error);
});

it("refuses a template placeholder that has no value", async () => {
  const { harness } = world({ readFile: async () => "{{JOB_ID}} {{TYPO}}" });
  const result = await harness.prompt(data(), { reasons: "none" });
  expect(jarl.error.is(result, DriveHarness.PromptError)).toBe(true);
  if (jarl.is_err(result)) {
    expect(result.error.message).toBe(
      "prompt: driving-agent.html uses {{TYPO}}, which has no value",
    );
  }
});

it("returns a PromptError naming the template it could not read", async () => {
  const cause = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
  const { harness } = world({
    readFile: async () => {
      throw cause;
    },
  });
  const result = await harness.prompt(data(), { reasons: "none" });
  expect(jarl.error.is(result, DriveHarness.PromptError)).toBe(true);
  if (jarl.is_err(result)) {
    const path = new URL("../../../prompts/driving-agent.html", import.meta.url).pathname;
    expect(result.error.message).toBe(`prompt: ${path}: ENOENT: no such file or directory`);
    expect(result.error.cause).toBe(cause);
  }
});

it.each([
  [
    "no tool call",
    jarl.ok({ content: "I am finished", toolCalls: [] }),
    "reply: expected one tool call, got 0",
  ],
  [
    "two tool calls",
    jarl.ok({
      content: null,
      toolCalls: [
        { id: "a", name: "Done", arguments: "{}" },
        { id: "b", name: "Done", arguments: "{}" },
      ],
    }),
    "reply: expected one tool call, got 2",
  ],
  [
    "arguments that are not JSON",
    said("send_keys", "{"),
    "reply: send_keys: arguments are not a JSON object",
  ],
  [
    "no step",
    said("send_keys", { reason: "Type", keys: "x" }),
    "reply: send_keys: step is the ActionList line, a whole number from 1",
  ],
  [
    "a step of 0",
    said("send_keys", { step: 0, reason: "Type", keys: "x" }),
    "reply: send_keys: step is the ActionList line, a whole number from 1",
  ],
  [
    "an empty reason",
    said("send_keys", { step: 1, reason: " ", keys: "x" }),
    "reply: send_keys: reason is that ActionList line",
  ],
  ["Done with arguments", said("Done", { step: 1 }), "reply: Done takes no arguments"],
] as const)("refuses a reply with %s", async (_, turn, message) => {
  const { harness, calls } = world({ turns: [turn] });
  const result = await harness.ask({ ...ASK, prompt: "drive" });
  expect(jarl.error.is(result, DriveHarness.ReplyInvalid)).toBe(true);
  if (jarl.is_err(result)) expect(result.error.message).toBe(message);
  expect(calls).toEqual([]);
});

it("reads a tool call with no arguments as an empty object", async () => {
  const { harness } = world({ turns: [said("Done", "")] });
  expect(jarl.unwrap(await harness.ask({ ...ASK, prompt: "drive" }))).toEqual({ kind: "done" });
});

it("ends a stale intent and opens the step again", async () => {
  const opens = [jarl.err(new Qemu.IntentOpen("intent/start: 409")), jarl.ok(undefined)];
  const { harness, calls } = world({
    guest: { intentStart: async () => opens.shift() ?? jarl.ok(undefined) },
  });
  jarl.unwrap(await harness.openStep("Unlock"));
  expect(calls).toEqual([["intentStart", "Unlock"], ["intentEnd"], ["intentStart", "Unlock"]]);
});

it("returns the step's intent failure when ending the stale one does not free it", async () => {
  const open = new Qemu.IntentOpen("intent/start: 409");
  const { harness, calls } = world({ guest: { intentStart: async () => jarl.err(open) } });
  const result = await harness.openStep("Unlock");
  expect(jarl.is_err(result)).toBe(true);
  if (jarl.is_err(result)) expect(result.error).toBe(open);
  expect(calls).toEqual([["intentStart", "Unlock"], ["intentEnd"], ["intentStart", "Unlock"]]);
});

it("returns the stale intent's end failure without opening again", async () => {
  const ended = new Http.HttpInvalid("intent/end: refused", asked);
  const { harness, calls } = world({
    guest: {
      intentStart: async () => jarl.err(new Qemu.IntentOpen("intent/start: 409")),
      intentEnd: async () => jarl.err(ended),
    },
  });
  const result = await harness.openStep("Unlock");
  expect(jarl.is_err(result)).toBe(true);
  if (jarl.is_err(result)) expect(result.error).toBe(ended);
  expect(calls).toEqual([["intentStart", "Unlock"], ["intentEnd"]]);
});

it.each([
  ["a setup that succeeded is saved", "setup", { status: "succeeded" }, [["save"]]],
  [
    "a setup that failed is stopped",
    "setup",
    { status: "failed", reason: "step limit" },
    [["stop", { status: "failed", reason: "step limit" }]],
  ],
  [
    "a drive that failed is stopped",
    "drive",
    { status: "failed", reason: "step limit" },
    [["stop", { status: "failed", reason: "step limit" }]],
  ],
] as const)("finishes the guest: %s", async (_, action, end, expected) => {
  const { harness, calls } = world();
  jarl.unwrap(await harness.finish(data(action), end));
  expect(calls).toEqual(expected);
});

it("returns a setup's save that the guest refused by staying up", async () => {
  const refused = new Qemu.NotPoweredOff("save: 409");
  const { harness } = world({ guest: { save: async () => jarl.err(refused) } });
  const result = await harness.finish(data("setup"), { status: "succeeded" });
  expect(jarl.error.is(result, Qemu.NotPoweredOff)).toBe(true);
  if (jarl.is_err(result)) expect(result.error).toBe(refused);
});

it("returns each step's own failure as it came", async () => {
  const down = new Http.HttpInvalid("proxy: down", asked);
  const invalid = new Qemu.ToolInvalid('no tool named "fly"');
  const unreachable = new OpenRouter.OpenRouterUnreachable("openrouter: down");
  const failing = world({
    guest: {
      start: async () => jarl.err(down),
      intentEnd: async () => jarl.err(down),
      run: async () => jarl.err(invalid),
    },
    turns: [jarl.err(unreachable)],
  });
  const { harness } = failing;
  const results = [
    [await harness.start(data()), down],
    [await harness.closeStep(), down],
    [
      await harness.act({ kind: "guest", step: 1, reason: "Fly", name: "fly", arguments: {} }),
      invalid,
    ],
    [await harness.ask({ ...ASK, prompt: "drive" }), unreachable],
  ] as const;
  for (const [result, error] of results) {
    expect(jarl.is_err(result)).toBe(true);
    if (jarl.is_err(result)) expect(result.error).toBe(error);
  }
});
