import * as Db from "@oligarchy/db";
import * as Http from "@oligarchy/http";
import * as OpenRouter from "@oligarchy/openrouter";
import * as Qemu from "@oligarchy/qemu-http-tools";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as DriveHarness from "../src/main.ts";
import { details, JOB, RUN, said, shown, world } from "./support.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ASK = { model: "test-model", reasoning: "low", deadline: 60_000 } as const;
const SCREEN = new Uint8Array([1, 2]);
const PLACEHOLDER = /\{\{[A-Z_]+\}\}/;

const asked = { asked: { method: "POST", url: "http://proxy:42069/start" } };

const guestMove = (move: DriveHarness.Move): DriveHarness.GuestMove => {
  if (move.kind !== "guest") {
    throw new Error("expected a guest move");
  }
  return move;
};

it("drives a job from its harness data to its end, keeping what the model is shown", async () => {
  const { harness, calls, requests } = world({
    guest: {
      run: async (name) =>
        jarl.ok(
          name === "get_image"
            ? { text: "took a screenshot", image: SCREEN }
            : { text: "sent the keys" },
        ),
    },
    turns: [
      said(
        "send_keys",
        { step: 1, reason: "Type the password", keys: "prime<ENTER>" },
        "{{REASONS}}",
      ),
      said("get_image", { step: 1, reason: "Type the password" }),
      said("Done", {}),
    ],
  });

  const job = jarl.unwrap(await harness.loadJobHarnessData(JOB));
  expect(job.resume).toBe(true);
  jarl.unwrap(await harness.start());
  const typed = guestMove(jarl.unwrap(await harness.ask(ASK)));
  expect(typed).toEqual({
    kind: "guest",
    step: 1,
    reason: "Type the password",
    name: "send_keys",
    arguments: { keys: "prime<ENTER>" },
  });
  expect(jarl.unwrap(await harness.act(typed))).toEqual({ text: "sent the keys" });
  const looked = guestMove(jarl.unwrap(await harness.ask(ASK)));
  jarl.unwrap(await harness.act(looked));
  expect(jarl.unwrap(await harness.ask(ASK))).toEqual({ kind: "done" });
  jarl.unwrap(await harness.finish({ status: "succeeded" }));

  expect(calls).toEqual([
    ["start", { iso: "https://iso.example/test.iso", resume: true }],
    ["run", "send_keys", { keys: "prime<ENTER>" }],
    ["run", "get_image", {}],
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
  ).toEqual([ASK, ASK, ASK]);

  expect(requests).toHaveLength(3);
  const first = shown(requests[0]);
  const second = shown(requests[1]);
  const third = shown(requests[2]);
  for (const { prompt } of [first, second, third]) {
    expect(prompt).toContain(JOB);
    expect(prompt).toContain(RUN);
    expect(prompt).toContain("Type {{MODEL}}");
    expect(prompt).toContain("The desktop is visible");
    expect(JSON.parse(/<tools>([\s\S]*)<\/tools>/.exec(prompt)?.[1] ?? "")).toEqual(tools);
  }
  // The first turn has no past: every placeholder has its value, and only inserted text reads as one.
  expect(first.prompt).toContain("Past steps: none");
  expect(first.prompt).not.toContain("<last-response>");
  expect(first.prompt).not.toContain("<previous-move>");
  expect(first.prompt.replace("Type {{MODEL}}", "")).not.toMatch(PLACEHOLDER);
  // Then each step's outcome, the model's last words as written, and the last move it made.
  expect(second.prompt).toContain("step 1: Type the password: sent the keys");
  expect(second.prompt).toContain("Your last response was: {{REASONS}}");
  expect(second.prompt).toContain('send_keys with values {"keys":"prime<ENTER>"}');
  expect(third.prompt).toContain(
    "step 1: Type the password: sent the keys\nstep 1: Type the password: took a screenshot",
  );
  expect(third.prompt).not.toContain("<last-response>");
  // A screenshot shows the result of the move before it, so that move stays the previous one.
  expect(third.prompt).toContain('send_keys with values {"keys":"prime<ENTER>"}');
  // Only the turn after a screenshot carries it.
  expect(first.user).toEqual(expect.any(String));
  expect(second.user).toEqual(expect.any(String));
  expect(third.user).toEqual([
    { type: "text", text: expect.any(String) },
    { type: "image_url", image_url: { url: "data:image/png;base64,AQI=" } },
  ]);
});

it("derives the boot mode from the job's action and definition", async () => {
  for (const [action, resumes, expected] of [
    ["drive", true, true],
    ["drive", false, false],
    ["setup", true, false],
  ] as const) {
    const getJobDetails = vi.fn(async () => jarl.ok(details(action, resumes)));
    const { harness } = world({ getJobDetails });
    const data = jarl.unwrap(await harness.loadJobHarnessData(JOB));
    expect(data).toMatchObject({ action, resume: expected });
    expect(harness.data).toBe(data);
    expect(getJobDetails).toHaveBeenCalledExactlyOnceWith(JOB);
  }
});

it.each([
  ["a missing job", new Stores.Tests.NotFound("getJobDetails: no job")],
  ["a database failure", new Db.DatabaseError("database refused the lookup")],
])("returns %s and loads nothing", async (_, error) => {
  const { harness } = world({ getJobDetails: async () => jarl.err(error) });
  const result = await harness.loadJobHarnessData(JOB);
  expect(jarl.is_err(result)).toBe(true);
  if (jarl.is_err(result)) {
    expect(result.error).toBe(error);
  }
  expect(harness.data).toBeUndefined();
});

it("refuses to start, ask or finish before a job is loaded", async () => {
  const { harness, calls, requests } = world();
  for (const result of [
    await harness.start(),
    await harness.ask(ASK),
    await harness.finish({ status: "failed" }),
  ]) {
    expect(jarl.error.is(result, DriveHarness.NotLoaded)).toBe(true);
  }
  expect(calls).toEqual([]);
  expect(requests).toEqual([]);
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
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  const result = await harness.ask(ASK);
  expect(jarl.error.is(result, DriveHarness.ReplyInvalid)).toBe(true);
  if (jarl.is_err(result)) {
    expect(result.error.message).toBe(message);
  }
  expect(calls).toEqual([]);
});

it("shows the model its refused reply on the next turn", async () => {
  const { harness, requests } = world({
    turns: [jarl.ok({ content: "I am finished", toolCalls: [] }), said("Done", "")],
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  expect(jarl.error.is(await harness.ask(ASK), DriveHarness.ReplyInvalid)).toBe(true);
  // A call with no arguments at all reads as an empty object.
  expect(jarl.unwrap(await harness.ask(ASK))).toEqual({ kind: "done" });
  const { prompt } = shown(requests[1]);
  expect(prompt).toContain("Past steps: reply: expected one tool call, got 0");
  expect(prompt).toContain("Your last response was: I am finished");
});

it("returns a move the guest refused, and shows the model why without the old screenshot", async () => {
  const off = new Qemu.GuestOff("send-keys: 409");
  const { harness, requests } = world({
    guest: {
      run: async (name) =>
        name === "get_image"
          ? jarl.ok({ text: "took a screenshot", image: SCREEN })
          : jarl.err(off),
    },
    turns: [said("Done", {})],
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(
    await harness.act({ kind: "guest", step: 1, reason: "Look", name: "get_image", arguments: {} }),
  );
  const result = await harness.act({
    kind: "guest",
    step: 2,
    reason: "Type",
    name: "send_keys",
    arguments: { keys: "x" },
  });
  expect(jarl.is_err(result)).toBe(true);
  if (jarl.is_err(result)) {
    expect(result.error).toBe(off);
  }
  jarl.unwrap(await harness.ask(ASK));
  const { prompt, user } = shown(requests[0]);
  expect(prompt).toContain("step 1: Look: took a screenshot\nstep 2: Type: send-keys: 409");
  expect(user).toEqual(expect.any(String));
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
  const { harness, calls } = world({ getJobDetails: async () => jarl.ok(details(action, true)) });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.finish(end));
  expect(calls).toEqual(expected);
});

it("returns a setup's save that the guest refused by staying up", async () => {
  const refused = new Qemu.NotPoweredOff("save: 409");
  const { harness } = world({
    getJobDetails: async () => jarl.ok(details("setup", true)),
    guest: { save: async () => jarl.err(refused) },
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  const result = await harness.finish({ status: "succeeded" });
  expect(jarl.error.is(result, Qemu.NotPoweredOff)).toBe(true);
  if (jarl.is_err(result)) {
    expect(result.error).toBe(refused);
  }
});

it("returns a failed start or ask as it came", async () => {
  const down = new Http.HttpInvalid("proxy: down", asked);
  const unreachable = new OpenRouter.OpenRouterUnreachable("openrouter: down");
  const { harness } = world({
    guest: { start: async () => jarl.err(down) },
    turns: [jarl.err(unreachable)],
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  for (const [result, error] of [
    [await harness.start(), down],
    [await harness.ask(ASK), unreachable],
  ] as const) {
    expect(jarl.is_err(result)).toBe(true);
    if (jarl.is_err(result)) {
      expect(result.error).toBe(error);
    }
  }
});
