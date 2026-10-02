import * as Async from "@oligarchy/async";
import * as DriveHarness from "@oligarchy/drive-harness";
import * as Http from "@oligarchy/http";
import * as LoggerTesting from "@oligarchy/logger/testing";
import * as OpenRouter from "@oligarchy/openrouter";
import * as Qemu from "@oligarchy/qemu-http-tools";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Drive from "../src/drive.ts";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

const JOB = "00000000-0000-4000-8000-000000000001";

const CONFIG: Drive.Limits = {
  models: { drive: "meta/drive", setup: "meta/setup", diagnose: "meta/diagnose" },
  reasoning: { drive: "minimal", setup: "low", diagnose: "xhigh" },
  stepLimit: 200,
  runCeiling: 60_000,
};

const MOVE: DriveHarness.Move = {
  kind: "guest",
  step: 1,
  reason: "Type",
  name: "send_keys",
  arguments: { keys: "x" },
};
const DONE: DriveHarness.Move = { kind: "done" };
const TURN: OpenRouter.Turn = { content: null, toolCalls: [] };

type Acted = Awaited<ReturnType<Drive.Harness["act"]>>;
type Asked = Awaited<ReturnType<Drive.Harness["ask"]>>;
type Imaged = Awaited<ReturnType<Drive.Harness["getImage"]>>;
type Finished = Awaited<ReturnType<Drive.Harness["finish"]>>;

// A harness whose steps answer what the script says, in order; each call is kept as it was made.
// A step asked once more than scripted answers ok, or done for act.
const harness = (
  script: {
    readonly action?: Stores.Tests.JobAction;
    readonly load?: Awaited<ReturnType<Drive.Harness["loadJobHarnessData"]>>;
    readonly start?: Awaited<ReturnType<Drive.Harness["start"]>>;
    readonly images?: ReadonlyArray<Imaged>;
    readonly asks?: ReadonlyArray<Asked | (() => Asked)>;
    readonly acts?: ReadonlyArray<Acted>;
    readonly finishes?: ReadonlyArray<Finished>;
  } = {},
) => {
  const images = [...(script.images ?? [])];
  const asks = [...(script.asks ?? [])];
  const acts = [...(script.acts ?? [])];
  const finishes = [...(script.finishes ?? [])];
  const calls: Array<readonly [string, ...ReadonlyArray<unknown>]> = [];
  const fake: Drive.Harness = {
    data: {
      jobId: JOB,
      runId: "run-1",
      action: script.action ?? "drive",
      name: "install",
      description: "Install",
      instruction: "<ActionList>\n* Type\n</ActionList>",
      proof: "Desktop",
      iso: "https://iso.example/test.iso",
      serverUrl: "http://proxy:42069",
      resume: false,
    },
    loadJobHarnessData: async (jobId) => {
      calls.push(["load", jobId]);
      return script.load ?? jarl.ok(true);
    },
    start: async () => {
      calls.push(["start"]);
      return script.start ?? jarl.ok(undefined);
    },
    getImage: async () => {
      calls.push(["image"]);
      return images.shift() ?? jarl.ok(undefined);
    },
    ask: async (request) => {
      calls.push(["ask", request]);
      const next = asks.shift();
      return typeof next === "function" ? next() : (next ?? jarl.ok(TURN));
    },
    act: async (turn) => {
      calls.push(["act", turn]);
      return acts.shift() ?? jarl.ok(DONE);
    },
    finish: async (end) => {
      calls.push(["finish", end]);
      return finishes.shift() ?? jarl.ok(undefined);
    },
  };
  return { harness: fake, calls };
};

const run = (
  fake: Drive.Harness,
  options: { readonly config?: Drive.Limits; readonly signal?: AbortSignal } = {},
) => {
  const log = LoggerTesting.logger();
  const result = Drive.drive({ logger: log.logger }, fake, {
    jobId: JOB,
    config: options.config ?? CONFIG,
    signal: options.signal ?? new AbortController().signal,
  });
  return { result, said: log.said };
};

const names = (calls: ReadonlyArray<readonly [string, ...ReadonlyArray<unknown>]>) =>
  calls.map(([name]) => name);

it("drives the job turn by turn until the model is done, then stops its guest succeeded", async () => {
  const signal = new AbortController().signal;
  const { harness: fake, calls } = harness({ acts: [jarl.ok(MOVE), jarl.ok(DONE)] });
  const { result } = run(fake, { signal });
  expect(jarl.unwrap(await result)).toEqual({ status: "succeeded" });
  expect(names(calls)).toEqual([
    "load",
    "start",
    "image",
    "ask",
    "act",
    "image",
    "ask",
    "act",
    "finish",
  ]);
  expect(calls[0]).toEqual(["load", JOB]);
  // The action's model and reasoning, with the run's ceiling as the deadline of every ask.
  expect(calls[3]).toEqual([
    "ask",
    { model: "meta/drive", reasoning: "minimal", deadline: 1_060_000, signal },
  ]);
  expect(calls.at(-1)).toEqual(["finish", { status: "succeeded" }]);
});

it("saves a setup once its guest has powered off, since nothing is left to drive", async () => {
  const off = new Qemu.GuestOff("image: 409");
  const { harness: fake, calls } = harness({
    action: "setup",
    images: [jarl.ok(undefined), jarl.err(off)],
    acts: [jarl.ok(MOVE)],
  });
  const { result } = run(fake);
  expect(jarl.unwrap(await result)).toEqual({ status: "succeeded" });
  expect(calls[3]).toMatchObject(["ask", { model: "meta/setup", reasoning: "low" }]);
  expect(calls.at(-1)).toEqual(["finish", { status: "succeeded" }]);
});

it("fails a drive whose guest is off", async () => {
  const { harness: fake, calls } = harness({ images: [jarl.err(new Qemu.GuestOff("image: 409"))] });
  const { result } = run(fake);
  const ended = { status: "failed", reason: "the guest is off: image: 409" };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(calls.at(-1)).toEqual(["finish", ended]);
});

it("fails the drive at the step limit, counting the moves that reached the guest", async () => {
  const off = new Qemu.GuestOff("send-keys: 409");
  const { harness: fake, calls } = harness({
    acts: [jarl.ok(MOVE), jarl.err(new DriveHarness.ReplyInvalid("reply: bad")), jarl.err(off)],
  });
  const { result } = run(fake, { config: { ...CONFIG, stepLimit: 2 } });
  const ended = { status: "failed", reason: "step limit of 2 reached" };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(names(calls).filter((name) => name === "act")).toHaveLength(3);
  expect(calls.at(-1)).toEqual(["finish", ended]);
});

it("fails the drive once its run ceiling has passed", async () => {
  const { harness: fake, calls } = harness({
    asks: [
      () => {
        vi.setSystemTime(1_000_000 + 60_000);
        return jarl.ok(TURN);
      },
    ],
    acts: [jarl.ok(MOVE)],
  });
  const { result } = run(fake);
  const ended = { status: "failed", reason: "run ceiling of 60000 ms passed" };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(calls.at(-1)).toEqual(["finish", ended]);
});

it("fails the drive when the model runs out of time before it answers", async () => {
  const late = new OpenRouter.OpenRouterOutOfTime("openrouter: no time left to ask again");
  const { harness: fake, calls } = harness({ asks: [jarl.err(late)] });
  const { result } = run(fake);
  const ended = { status: "failed", reason: "openrouter: no time left to ask again" };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(calls.at(-1)).toEqual(["finish", ended]);
});

it("fails the drive after three replies in a row that were not a move it could make", async () => {
  const bad = (message: string) => jarl.err(new DriveHarness.ReplyInvalid(message));
  const { harness: fake, calls } = harness({
    acts: [
      bad("a"),
      jarl.err(new Qemu.ToolInvalid("b")),
      jarl.ok(MOVE),
      bad("c"),
      jarl.err(new Qemu.NoPointer("d")),
      bad("e"),
    ],
  });
  const { result } = run(fake);
  const ended = {
    status: "failed",
    reason: "model could not respond correctly: 3 bad replies in a row: c; d; e",
  };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(calls.at(-1)).toEqual(["finish", ended]);
});

it.each([
  [
    "a job it cannot load",
    { load: jarl.err(new Stores.Tests.NotFound("getJobDetails: no job")) },
    "load: getJobDetails: no job",
    ["load"],
  ],
  [
    "a diagnose job",
    { action: "diagnose" },
    `job ${JOB} is a diagnose; the driver runs a drive or a setup`,
    ["load"],
  ],
  [
    "a guest that would not start",
    { start: jarl.err(new Http.HttpInvalid("start: refused")) },
    "start: start: refused",
    ["load", "start"],
  ],
] as const)("fails on %s, and starts or stops nothing more", async (_, script, message, done) => {
  const { harness: fake, calls } = harness(script);
  const { result, said } = run(fake);
  const failed = await result;
  expect(jarl.error.is(failed, Drive.DriverFailed)).toBe(true);
  if (jarl.is_err(failed)) {
    expect(failed.error.message).toBe(message);
  }
  expect(names(calls)).toEqual(done);
  expect(said).toContainEqual(expect.objectContaining({ level: "error", text: message }));
});

it.each([
  [
    "an image the proxy failed",
    { images: [jarl.err(new Http.HttpInvalid("image: down"))] },
    "image: image: down",
  ],
  [
    "a model that could not be reached",
    { asks: [jarl.err(new OpenRouter.OpenRouterUnreachable("openrouter: down"))] },
    "model: openrouter: down",
  ],
  [
    "a move the proxy failed",
    { acts: [jarl.err(new Http.HttpInvalid("send-keys: down"))] },
    "guest: send-keys: down",
  ],
  [
    "an intent that would not open",
    { acts: [jarl.err(new Qemu.IntentOpen("intent/start: 409"))] },
    "guest: intent/start: 409",
  ],
] as const)("fails on %s, and stops the guest failed", async (_, script, message) => {
  const { harness: fake, calls } = harness(script);
  const { result, said } = run(fake);
  const failed = await result;
  expect(jarl.error.is(failed, Drive.DriverFailed)).toBe(true);
  if (jarl.is_err(failed)) {
    expect(failed.error.message).toBe(message);
  }
  expect(calls.at(-1)).toEqual(["finish", { status: "failed", reason: message }]);
  expect(said).toContainEqual(expect.objectContaining({ level: "error", text: message }));
});

it("fails when the guest could not be stopped at the end", async () => {
  const { harness: fake } = harness({
    finishes: [jarl.err(new Http.HttpInvalid("stop: down"))],
  });
  const { result } = run(fake);
  const failed = await result;
  expect(jarl.error.is(failed, Drive.DriverFailed)).toBe(true);
  if (jarl.is_err(failed)) {
    expect(failed.error.message).toBe("finish: stop: down");
  }
});

it("fails a setup whose guest stayed up through the save, and stops it", async () => {
  const { harness: fake, calls } = harness({
    action: "setup",
    finishes: [jarl.err(new Qemu.NotPoweredOff("save: 409")), jarl.ok(undefined)],
  });
  const { result } = run(fake);
  const ended = { status: "failed", reason: "save: 409" };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(calls.slice(-2)).toEqual([
    ["finish", { status: "succeeded" }],
    ["finish", ended],
  ]);
});

it("stops the guest aborted when the driver is told to stop", async () => {
  const aborter = new AbortController();
  const { harness: fake, calls } = harness({
    asks: [
      jarl.ok(TURN),
      () => {
        aborter.abort(new Async.Aborted("SIGTERM received"));
        return jarl.err(new Async.Aborted("SIGTERM received"));
      },
    ],
    acts: [jarl.ok(MOVE)],
  });
  const { result } = run(fake, { signal: aborter.signal });
  const ended = { status: "aborted", reason: "SIGTERM received" };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(calls.at(-1)).toEqual(["finish", ended]);
  expect(names(calls).filter((name) => name === "act")).toHaveLength(1);
});
