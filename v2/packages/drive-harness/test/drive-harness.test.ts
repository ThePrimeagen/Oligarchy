import * as Db from "@oligarchy/db";
import * as Http from "@oligarchy/http";
import * as OpenRouter from "@oligarchy/openrouter";
import * as Qemu from "@oligarchy/qemu-http-tools";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as DriveHarness from "../src/main.ts";
import { details, INSTRUCTION, JOB, RUN, SCREEN, said, shown, turn, world } from "./support.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ASK = { model: "test-model", reasoning: "low", deadline: 60_000 } as const;
const PLACEHOLDER = /\{\{[A-Z_]+\}\}/;
const IMAGE = [
  { type: "text", text: expect.any(String) },
  { type: "image_url", image_url: { url: "data:image/png;base64,AQI=" } },
];

const asked = { asked: { method: "POST", url: "http://proxy:42069/start" } };

const ran = async (name: string) =>
  jarl.ok(
    name === "get_image" ? { text: "took a screenshot", image: SCREEN } : { text: "sent the keys" },
  );

it("drives a job step by step, keeping and recording each step's actions and what the model is shown", async () => {
  const { harness, calls, requests, moved } = world({
    guest: { run: ran },
    turns: [
      said(
        "send_keys",
        { step: 1, reason: "Type the password", keys: "prime<ENTER>" },
        "{{PROGRESS}}",
      ),
      said("get_image", { step: 2, reason: "Look at the desktop" }),
      said("Done", {}),
    ],
  });

  expect(jarl.unwrap(await harness.loadJobHarnessData(JOB))).toBe(true);
  jarl.unwrap(await harness.start());
  jarl.unwrap(await harness.getImage());
  const typed = jarl.unwrap(await harness.act(jarl.unwrap(await harness.ask(ASK))));
  expect(typed).toEqual({
    kind: "guest",
    step: 1,
    reason: "Type the password",
    name: "send_keys",
    arguments: { keys: "prime<ENTER>" },
  });
  jarl.unwrap(await harness.act(jarl.unwrap(await harness.ask(ASK))));
  expect(jarl.unwrap(await harness.act(jarl.unwrap(await harness.ask(ASK))))).toEqual({
    kind: "done",
  });
  jarl.unwrap(await harness.finish({ status: "succeeded" }));

  // A move for a step that is not open ends the open intent and starts that step's.
  expect(calls).toEqual([
    ["start", { iso: "https://iso.example/test.iso", resume: true }],
    ["image"],
    ["intentStart", "Type {{MODEL}}"],
    ["run", "send_keys", { keys: "prime<ENTER>" }],
    ["intentEnd"],
    ["intentStart", "Look at the desktop"],
    ["run", "get_image", {}],
    ["stop", { status: "succeeded" }],
  ]);
  expect(harness.steps).toEqual([
    {
      step: 1,
      intent: "Type {{MODEL}}",
      actions: [
        {
          kind: "move",
          name: "send_keys",
          reason: "Type the password",
          arguments: { keys: "prime<ENTER>" },
          outcome: "sent the keys",
        },
      ],
    },
    {
      step: 2,
      intent: "Look at the desktop",
      actions: [
        {
          kind: "move",
          name: "get_image",
          reason: "Look at the desktop",
          arguments: {},
          outcome: "took a screenshot",
        },
      ],
    },
  ]);
  // Each move is recorded whole, under its job and step; Done is no move.
  expect(moved).toEqual([
    {
      jobId: JOB,
      kind: "move",
      step: 1,
      name: "send_keys",
      reason: "Type the password",
      arguments: { keys: "prime<ENTER>" },
      outcome: "sent the keys",
    },
    {
      jobId: JOB,
      kind: "move",
      step: 2,
      name: "get_image",
      reason: "Look at the desktop",
      arguments: {},
      outcome: "took a screenshot",
    },
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
    expect(prompt).toContain(INSTRUCTION);
    expect(prompt).toContain("The desktop is visible");
    expect(JSON.parse(/<tools>([\s\S]*)<\/tools>/.exec(prompt)?.[1] ?? "")).toEqual(tools);
  }
  // The first turn has no past: every placeholder has its value, and only inserted text reads as one.
  expect(first.prompt).toContain("No step has started yet.");
  expect(first.prompt).not.toContain("<last-response>");
  expect(first.prompt).not.toContain("<previous-move>");
  expect(first.prompt.replaceAll("{{MODEL}}", "")).not.toMatch(PLACEHOLDER);
  // Then the open step's intent and its actions, the model's last words as written, and its last
  // move.
  expect(second.prompt).toContain(
    'Step 1: Type {{MODEL}}\n- send_keys {"keys":"prime<ENTER>"}: sent the keys',
  );
  expect(second.prompt).toContain("Your last response was: {{PROGRESS}}");
  expect(second.prompt).toContain('send_keys with values {"keys":"prime<ENTER>"}');
  // A new step shows only its own actions; the earlier step's stay in the harness.
  expect(third.prompt).toContain("Step 2: Look at the desktop\n- get_image {}: took a screenshot");
  expect(third.prompt).not.toContain("sent the keys");
  expect(third.prompt).not.toContain("<last-response>");
  // A screenshot shows the result of the move before it, so that move stays the previous one.
  expect(third.prompt).toContain('send_keys with values {"keys":"prime<ENTER>"}');
  // The screen goes with the next ask until a move that may have changed it.
  expect(first.user).toEqual(IMAGE);
  expect(second.user).toEqual(expect.any(String));
  expect(third.user).toEqual(IMAGE);
});

it("shows the open step's intent and only its newest actions, newest first", async () => {
  const keys = ["a", "b", "c", "d"];
  const { harness, requests } = world({
    recentActions: 3,
    turns: [
      ...keys.map((key) => said("send_keys", { step: 1, reason: "Type", keys: key })),
      said("Done", {}),
    ],
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  for (const _ of keys) {
    jarl.unwrap(await harness.act(jarl.unwrap(await harness.ask(ASK))));
  }
  jarl.unwrap(await harness.ask(ASK));
  const { prompt } = shown(requests[4]);
  expect(prompt).toContain(
    [
      "Step 1: Type {{MODEL}}",
      '- send_keys {"keys":"d"}: sent the keys',
      '- send_keys {"keys":"c"}: sent the keys',
      "</progress>",
    ].join("\n"),
  );
  expect(prompt).not.toContain('{"keys":"b"}');
  expect(harness.steps[0]?.actions).toHaveLength(4);
});

it("names each step after its ActionList line, and a step past the list by its number", async () => {
  const { harness, calls } = world();
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.nextStep(2));
  jarl.unwrap(await harness.nextStep(3));
  expect(calls).toEqual([
    ["intentStart", "Look at the desktop"],
    ["intentEnd"],
    ["intentStart", "step 3"],
  ]);
  expect(harness.steps.map(({ step, intent }) => ({ step, intent }))).toEqual([
    { step: 2, intent: "Look at the desktop" },
    { step: 3, intent: "step 3" },
  ]);
});

it("returns a step whose intent would not start, and runs nothing outside it", async () => {
  const down = new Http.HttpInvalid("intent/start: down", asked);
  const { harness, calls } = world({ guest: { intentStart: async () => jarl.err(down) } });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  const result = await harness.act(turn("send_keys", { step: 1, reason: "Type", keys: "x" }));
  expect(jarl.is_err(result)).toBe(true);
  if (jarl.is_err(result)) {
    expect(result.error).toBe(down);
  }
  expect(calls).toEqual([["intentStart", "Type {{MODEL}}"]]);
  expect(harness.steps).toEqual([]);
});

it("starts a step again after its intent would not start, without ending a closed one", async () => {
  const down = new Http.HttpInvalid("intent/start: down", asked);
  const starts = [jarl.ok(undefined), jarl.err(down), jarl.ok(undefined)];
  const { harness, calls } = world({
    guest: { intentStart: async () => starts.shift() ?? jarl.ok(undefined) },
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.nextStep(1));
  expect(jarl.is_err(await harness.nextStep(2))).toBe(true);
  jarl.unwrap(await harness.nextStep(2));
  expect(calls).toEqual([
    ["intentStart", "Type {{MODEL}}"],
    ["intentEnd"],
    ["intentStart", "Look at the desktop"],
    ["intentStart", "Look at the desktop"],
  ]);
  expect(harness.steps.map(({ step }) => step)).toEqual([1, 2]);
});

it("returns an intent that would not end, and keeps the step open", async () => {
  const down = new Http.HttpInvalid("intent/end: down", asked);
  const { harness, calls } = world({ guest: { intentEnd: async () => jarl.err(down) } });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.nextStep(1));
  const result = await harness.nextStep(2);
  expect(jarl.is_err(result)).toBe(true);
  if (jarl.is_err(result)) {
    expect(result.error).toBe(down);
  }
  expect(calls).toEqual([["intentStart", "Type {{MODEL}}"], ["intentEnd"]]);
  expect(harness.steps.map(({ step }) => step)).toEqual([1]);
});

it("returns an image the guest refused, and asks without the old screenshot", async () => {
  const off = new Qemu.GuestOff("image: 409");
  const images = [jarl.ok(SCREEN), jarl.err(off)];
  const { harness, requests } = world({
    guest: { image: async () => images.shift() ?? jarl.err(off) },
    turns: [said("Done", {})],
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.getImage());
  const result = await harness.getImage();
  expect(jarl.error.is(result, Qemu.GuestOff)).toBe(true);
  if (jarl.is_err(result)) {
    expect(result.error).toBe(off);
  }
  jarl.unwrap(await harness.ask(ASK));
  expect(shown(requests[0]).user).toEqual(expect.any(String));
});

it.each([
  [
    "no tool call",
    { content: "I am finished", toolCalls: [] },
    "reply: expected one tool call, got 0",
  ],
  [
    "two tool calls",
    {
      content: null,
      toolCalls: [
        { id: "a", name: "Done", arguments: "{}" },
        { id: "b", name: "Done", arguments: "{}" },
      ],
    },
    "reply: expected one tool call, got 2",
  ],
  [
    "arguments that are not JSON",
    turn("send_keys", "{"),
    "reply: send_keys: arguments are not a JSON object",
  ],
  [
    "no step",
    turn("send_keys", { reason: "Type", keys: "x" }),
    "reply: send_keys: step is the ActionList line, a whole number from 1",
  ],
  [
    "a step of 0",
    turn("send_keys", { step: 0, reason: "Type", keys: "x" }),
    "reply: send_keys: step is the ActionList line, a whole number from 1",
  ],
  [
    "an empty reason",
    turn("send_keys", { step: 1, reason: " ", keys: "x" }),
    "reply: send_keys: reason is that ActionList line",
  ],
  ["Done with arguments", turn("Done", { step: 1 }), "reply: Done takes no arguments"],
] as const)("refuses a reply with %s", async (_, reply, message) => {
  const { harness, calls } = world();
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  const result = await harness.act(reply);
  expect(jarl.error.is(result, DriveHarness.ReplyInvalid)).toBe(true);
  if (jarl.is_err(result)) {
    expect(result.error.message).toBe(message);
  }
  expect(calls).toEqual([]);
});

it("keeps and records a refused reply under the open step, and reads no arguments as an empty object", async () => {
  const { harness, requests, moved } = world({
    turns: [jarl.ok({ content: "I am finished", toolCalls: [] }), said("Done", "")],
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.act(turn("send_keys", { step: 1, reason: "Type", keys: "x" })));
  const refused = await harness.act(jarl.unwrap(await harness.ask(ASK)));
  expect(jarl.error.is(refused, DriveHarness.ReplyInvalid)).toBe(true);
  expect(jarl.unwrap(await harness.act(jarl.unwrap(await harness.ask(ASK))))).toEqual({
    kind: "done",
  });
  const { prompt } = shown(requests[1]);
  expect(prompt).toContain(
    [
      "Step 1: Type {{MODEL}}",
      "- refused: reply: expected one tool call, got 0",
      '- send_keys {"keys":"x"}: sent the keys',
    ].join("\n"),
  );
  expect(prompt).toContain("Your last response was: I am finished");
  expect(moved[1]).toEqual({
    jobId: JOB,
    kind: "refused",
    step: 1,
    outcome: "reply: expected one tool call, got 0",
  });
});

it("returns a move the guest refused, keeps and records why under its step, and drops the screenshot", async () => {
  const off = new Qemu.GuestOff("send-keys: 409");
  const { harness, requests, moved } = world({
    guest: { run: async () => jarl.err(off) },
    turns: [said("Done", {})],
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.getImage());
  const result = await harness.act(turn("send_keys", { step: 1, reason: "Type", keys: "x" }));
  expect(jarl.error.is(result, Qemu.GuestOff)).toBe(true);
  if (jarl.is_err(result)) {
    expect(result.error).toBe(off);
  }
  jarl.unwrap(await harness.ask(ASK));
  const { prompt, user } = shown(requests[0]);
  expect(prompt).toContain('Step 1: Type {{MODEL}}\n- send_keys {"keys":"x"}: send-keys: 409');
  expect(user).toEqual(expect.any(String));
  expect(moved).toEqual([
    {
      jobId: JOB,
      kind: "move",
      step: 1,
      name: "send_keys",
      reason: "Type",
      arguments: { keys: "x" },
      outcome: "send-keys: 409",
    },
  ]);
});

it("returns a move whose record failed as the database's error, after the move ran and is kept under its step", async () => {
  const error = new Db.DatabaseError("connection refused");
  const { harness, calls } = world({ recordMove: async () => jarl.err(error) });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));

  const result = await harness.act(turn("send_keys", { step: 1, reason: "Type", keys: "x" }));

  if (!jarl.error.is(result, Db.DatabaseError)) {
    throw new Error("expected DatabaseError");
  }
  expect(result.error).toBe(error);
  expect(calls).toContainEqual(["run", "send_keys", { keys: "x" }]);
  expect(harness.steps[0]?.actions).toEqual([
    {
      kind: "move",
      name: "send_keys",
      reason: "Type",
      arguments: { keys: "x" },
      outcome: "sent the keys",
    },
  ]);
});

it("returns a refused reply whose record failed as the database's error, recorded under no step when none is open", async () => {
  const error = new Db.DatabaseError("connection refused");
  const { harness, calls, moved } = world({ recordMove: async () => jarl.err(error) });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));

  const result = await harness.act({ content: "I am finished", toolCalls: [] });

  if (!jarl.error.is(result, Db.DatabaseError)) {
    throw new Error("expected DatabaseError");
  }
  expect(result.error).toBe(error);
  expect(calls).toEqual([]);
  expect(moved).toEqual([
    { jobId: JOB, kind: "refused", step: null, outcome: "reply: expected one tool call, got 0" },
  ]);
});

it("loads the job's harness data and derives its boot mode from its action and definition", async () => {
  for (const [action, resumes, expected] of [
    ["drive", true, true],
    ["drive", false, false],
    ["setup", true, false],
  ] as const) {
    const getJobDetails = vi.fn(async () => jarl.ok(details(action, resumes)));
    const { harness } = world({ getJobDetails });
    expect(jarl.unwrap(await harness.loadJobHarnessData(JOB))).toBe(true);
    expect(harness.data).toEqual({
      jobId: JOB,
      runId: RUN,
      action,
      name: "install",
      description: "Install and boot",
      instruction: INSTRUCTION,
      proof: "The desktop is visible",
      iso: "https://iso.example/test.iso",
      serverUrl: "http://proxy:42069",
      resume: expected,
    });
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
