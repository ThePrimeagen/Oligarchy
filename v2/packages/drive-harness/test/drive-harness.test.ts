import * as Async from "@oligarchy/async";
import * as Db from "@oligarchy/db";
import * as Http from "@oligarchy/http";
import * as Fake from "@oligarchy/http/testing";
import * as OpenRouter from "@oligarchy/openrouter";
import * as Qemu from "@oligarchy/qemu-http-tools";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as DriveHarness from "../src/main.ts";
import {
  details,
  INSTRUCTION,
  JOB,
  RUN,
  SERVER_URL,
  TOKEN,
  said,
  screen,
  shown,
  turn,
  world,
} from "../src/testing.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ASK = { model: "test-model", reasoning: "low", deadline: 60_000 } as const;
const PLACEHOLDER = /\{\{[A-Z_]+\}\}/;
const IMAGE = [
  { type: "text", text: expect.any(String) },
  { type: "image_url", image_url: { url: "data:image/png;base64,AQI=" } },
];

const down = () => Fake.status(500, "down");

it("drives a job step by step, keeping each step's actions and what the model is shown", async () => {
  const {
    driveHarness: harness,
    calls,
    requests,
  } = world({
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
    ["start", { iso: "https://iso.example/test.iso", mode: "resume" }],
    ["image"],
    ["intent/start", { message: "Type {{MODEL}}" }],
    ["send-keys", { keys: "prime<ENTER>" }],
    ["intent/end"],
    ["intent/start", { message: "Look at the desktop" }],
    ["image"],
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

  // Every guest tool asks for its step and reason beside its own arguments, and Done ends the loop.
  const tools = requests[0]?.tools ?? [];
  expect(tools.at(-1)?.function).toMatchObject({
    name: "Done",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  });
  expect(
    tools.find((tool) => tool.function.name === "send_keys")?.function.parameters,
  ).toMatchObject({
    properties: { keys: { type: "string", minLength: 1 }, step: {}, reason: {} },
    required: ["keys", "step", "reason"],
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

it("sends every guest call to the server url, naming the job and carrying the token", async () => {
  const { driveHarness: harness, asked } = world();
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.start());
  jarl.unwrap(await harness.getImage());
  expect(asked).toEqual([
    {
      url: `${SERVER_URL}/start`,
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: { job: JOB, iso: "https://iso.example/test.iso", mode: "resume" },
    },
    {
      url: `${SERVER_URL}/image?job=${JOB}`,
      method: "GET",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: undefined,
    },
  ]);
});

it("ends every guest call and the ask on its signal, and still stops the guest", async () => {
  const aborter = new AbortController();
  const {
    driveHarness: harness,
    calls,
    requests,
  } = world({
    signal: aborter.signal,
    turns: [said("Done", {})],
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  aborter.abort(new Async.Aborted("SIGTERM received"));

  const image = await harness.getImage();
  expect(Fake.failure(image, Async.Aborted).message).toBe("SIGTERM received");
  jarl.unwrap(await harness.ask(ASK));
  expect(requests[0]?.signal).toBe(aborter.signal);
  jarl.unwrap(await harness.finish({ status: "aborted", reason: "SIGTERM received" }));

  expect(calls).toEqual([["stop", { status: "aborted", reason: "SIGTERM received" }]]);
});

it("shows the open step's intent and only its newest actions, newest first", async () => {
  const keys = ["a", "b", "c", "d"];
  const { driveHarness: harness, requests } = world({
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
  const { driveHarness: harness, calls } = world();
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.nextStep(2));
  jarl.unwrap(await harness.nextStep(3));
  expect(calls).toEqual([
    ["intent/start", { message: "Look at the desktop" }],
    ["intent/end"],
    ["intent/start", { message: "step 3" }],
  ]);
  expect(harness.steps.map(({ step, intent }) => ({ step, intent }))).toEqual([
    { step: 2, intent: "Look at the desktop" },
    { step: 3, intent: "step 3" },
  ]);
});

it("returns a step whose intent would not start, and runs nothing outside it", async () => {
  const { driveHarness: harness, calls } = world({ guest: { "intent/start": down() } });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  const result = await harness.act(turn("send_keys", { step: 1, reason: "Type", keys: "x" }));
  expect(Fake.failure(result, Http.HttpServerError).status).toBe(500);
  expect(calls).toEqual([["intent/start", { message: "Type {{MODEL}}" }]]);
  expect(harness.steps).toEqual([]);
});

it("starts a step again after its intent would not start, without ending a closed one", async () => {
  const { driveHarness: harness, calls } = world({
    guest: { "intent/start": [Fake.json({}), down(), Fake.json({})] },
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.nextStep(1));
  expect(jarl.is_err(await harness.nextStep(2))).toBe(true);
  jarl.unwrap(await harness.nextStep(2));
  expect(calls).toEqual([
    ["intent/start", { message: "Type {{MODEL}}" }],
    ["intent/end"],
    ["intent/start", { message: "Look at the desktop" }],
    ["intent/start", { message: "Look at the desktop" }],
  ]);
  expect(harness.steps.map(({ step }) => step)).toEqual([1, 2]);
});

it("returns an intent that would not end, and keeps the step open", async () => {
  const { driveHarness: harness, calls } = world({ guest: { "intent/end": down() } });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.nextStep(1));
  const result = await harness.nextStep(2);
  expect(Fake.failure(result, Http.HttpServerError).status).toBe(500);
  expect(calls).toEqual([["intent/start", { message: "Type {{MODEL}}" }], ["intent/end"]]);
  expect(harness.steps.map(({ step }) => step)).toEqual([1]);
});

it("returns an image the guest refused, and asks without the old screenshot", async () => {
  const { driveHarness: harness, requests } = world({
    guest: { image: [screen(), Fake.status(409)] },
    turns: [said("Done", {})],
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.getImage());
  const result = await harness.getImage();
  expect(Fake.failure(result, Qemu.GuestOff).message).toBe("image: 409");
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
  const { driveHarness: harness, calls } = world();
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  const result = await harness.act(reply);
  expect(Fake.failure(result, DriveHarness.ReplyInvalid).message).toBe(message);
  expect(calls).toEqual([]);
});

it("keeps a refused reply under the open step, and reads no arguments as an empty object", async () => {
  const { driveHarness: harness, requests } = world({
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
});

it("returns a move the guest refused, keeps why under its step, and drops the screenshot", async () => {
  const { driveHarness: harness, requests } = world({
    guest: { "send-keys": Fake.status(409) },
    turns: [said("Done", {})],
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.getImage());
  const result = await harness.act(turn("send_keys", { step: 1, reason: "Type", keys: "x" }));
  expect(Fake.failure(result, Qemu.GuestOff).message).toBe("send-keys: 409");
  jarl.unwrap(await harness.ask(ASK));
  const { prompt, user } = shown(requests[0]);
  expect(prompt).toContain('Step 1: Type {{MODEL}}\n- send_keys {"keys":"x"}: send-keys: 409');
  expect(user).toEqual(expect.any(String));
});

it("loads the job's harness data and derives its boot mode from its action and definition", async () => {
  for (const [action, resumes, expected] of [
    ["drive", true, true],
    ["drive", false, false],
    ["setup", true, false],
  ] as const) {
    const getJobDetails = vi.fn(async () => jarl.ok(details(action, resumes)));
    const { driveHarness: harness } = world({ getJobDetails });
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
      serverUrl: SERVER_URL,
      resume: expected,
    });
    expect(getJobDetails).toHaveBeenCalledExactlyOnceWith(JOB);
  }
});

it.each([
  ["a missing job", new Stores.Tests.NotFound("getJobDetails: no job")],
  ["a database failure", new Db.DatabaseError("database refused the lookup")],
])("returns %s and loads nothing", async (_, error) => {
  const { driveHarness: harness } = world({ getJobDetails: async () => jarl.err(error) });
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
  const { driveHarness: harness, calls } = world({
    getJobDetails: async () => jarl.ok(details(action, true)),
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  jarl.unwrap(await harness.finish(end));
  expect(calls).toEqual(expected);
});

it("returns a setup's save that the guest refused by staying up", async () => {
  const { driveHarness: harness } = world({
    getJobDetails: async () => jarl.ok(details("setup", true)),
    guest: { save: Fake.status(409) },
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  const result = await harness.finish({ status: "succeeded" });
  expect(Fake.failure(result, Qemu.NotPoweredOff).message).toBe("save: 409");
});

it("returns a failed start or ask as it came", async () => {
  const unreachable = new OpenRouter.OpenRouterUnreachable("openrouter: down");
  const { driveHarness: harness } = world({
    guest: { start: down() },
    turns: [jarl.err(unreachable)],
  });
  jarl.unwrap(await harness.loadJobHarnessData(JOB));
  expect(Fake.failure(await harness.start(), Http.HttpServerError).status).toBe(500);
  const asked = await harness.ask(ASK);
  expect(jarl.is_err(asked)).toBe(true);
  if (jarl.is_err(asked)) {
    expect(asked.error).toBe(unreachable);
  }
});
