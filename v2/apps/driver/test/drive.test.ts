import * as Async from "@oligarchy/async";
import * as Testing from "@oligarchy/drive-harness/testing";
import * as Http from "@oligarchy/http";
import * as Fake from "@oligarchy/http/testing";
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

const { JOB } = Testing;

const CONFIG: Drive.Limits = {
  models: { drive: "meta/drive", setup: "meta/setup", diagnose: "meta/diagnose" },
  reasoning: { drive: "minimal", setup: "low", diagnose: "xhigh" },
  stepLimit: 200,
  runCeiling: 60_000,
  harness: { defaultRetry: 1_000, recentActions: 10 },
};

const move = () => Testing.said("send_keys", { step: 1, reason: "Type", keys: "x" });
const done = () => Testing.said("Done", {});
const prose = () => jarl.ok({ content: "I am thinking", toolCalls: [] });
const REFUSED = "reply: expected one tool call, got 0";

const setup = async () => jarl.ok(Testing.details("setup", true));
const down = () => Fake.status(500, "down");

const drive = (
  world: Testing.World,
  options: { readonly config?: Drive.Limits; readonly signal?: AbortSignal } = {},
) => {
  const log = LoggerTesting.logger();
  const result = Drive.drive(
    { logger: log.logger, ...world.services },
    options.signal ?? new AbortController().signal,
    {
      jobId: JOB,
      serverUrl: Testing.SERVER_URL,
      token: { reveal: () => Testing.TOKEN },
      config: options.config ?? CONFIG,
    },
  );
  return { result, said: log.said };
};

const paths = (calls: ReadonlyArray<Testing.Call>) => calls.map(([path]) => path);

it("drives the job turn by turn until the model is done, then stops its guest succeeded", async () => {
  const signal = new AbortController().signal;
  const world = Testing.world({ turns: [move(), done()] });
  const { result } = drive(world, { signal });
  expect(jarl.unwrap(await result)).toEqual({ status: "succeeded" });
  expect(paths(world.calls)).toEqual([
    "start",
    "image",
    "intent/start",
    "send-keys",
    "image",
    "stop",
  ]);
  expect(world.calls.at(-1)).toEqual(["stop", { status: "succeeded" }]);
  // The action's model and reasoning, with the run's ceiling as the deadline of every ask.
  expect(world.requests).toHaveLength(2);
  for (const request of world.requests) {
    expect(request).toMatchObject({
      model: "meta/drive",
      reasoning: "minimal",
      deadline: 1_060_000,
    });
    expect(request.signal).toBe(signal);
  }
});

it("saves a setup once its guest has powered off, since nothing is left to drive", async () => {
  const world = Testing.world({
    getJobDetails: setup,
    guest: { image: [Testing.screen(), Fake.status(409)] },
    turns: [move()],
  });
  const { result } = drive(world);
  expect(jarl.unwrap(await result)).toEqual({ status: "succeeded" });
  expect(world.requests[0]).toMatchObject({ model: "meta/setup", reasoning: "low" });
  expect(world.calls.at(-1)).toEqual(["save"]);
});

it("fails a drive whose guest is off", async () => {
  const world = Testing.world({ guest: { image: Fake.status(409) } });
  const { result } = drive(world);
  const ended = { status: "failed", reason: "the guest is off: image: 409" };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(world.calls.at(-1)).toEqual(["stop", ended]);
});

it("fails the drive at the step limit, counting the moves that reached the guest", async () => {
  const world = Testing.world({
    guest: { "send-keys": [Fake.json({}), Fake.status(409)] },
    turns: [move(), prose(), move()],
  });
  const { result } = drive(world, { config: { ...CONFIG, stepLimit: 2 } });
  const ended = { status: "failed", reason: "step limit of 2 reached" };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(paths(world.calls).filter((path) => path === "send-keys")).toHaveLength(2);
  expect(world.calls.at(-1)).toEqual(["stop", ended]);
});

it("fails the drive once its run ceiling has passed", async () => {
  const world = Testing.world({
    turns: [
      () => {
        vi.setSystemTime(1_000_000 + 60_000);
        return move();
      },
    ],
  });
  const { result } = drive(world);
  const ended = { status: "failed", reason: "run ceiling of 60000 ms passed" };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(world.calls.at(-1)).toEqual(["stop", ended]);
});

it("fails the drive when the model runs out of time before it answers", async () => {
  const late = new OpenRouter.OpenRouterOutOfTime("openrouter: no time left to ask again");
  const world = Testing.world({ turns: [jarl.err(late)] });
  const { result } = drive(world);
  const ended = { status: "failed", reason: "openrouter: no time left to ask again" };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(world.calls.at(-1)).toEqual(["stop", ended]);
});

it("fails the drive after three replies in a row that were not a move it could make", async () => {
  const empty = () => Testing.said("send_keys", { step: 1, reason: "Type", keys: "" });
  const click = () => Testing.said("mouse_click", { step: 1, reason: "Click", button: "left" });
  const world = Testing.world({
    turns: [prose(), empty(), move(), prose(), click(), prose()],
  });
  const { result } = drive(world);
  const ended = {
    status: "failed",
    reason: `model could not respond correctly: 3 bad replies in a row: ${REFUSED}; click: no mouse move yet; move the pointer first; ${REFUSED}`,
  };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(world.calls.at(-1)).toEqual(["stop", ended]);
});

// What the logger hands Sentry: the error itself, stack and all, as the line's cause.
const reported = (error: Error) =>
  expect.objectContaining({
    level: "error",
    text: error.message,
    report: expect.objectContaining({ cause: error }),
  });

it("returns a job it cannot load as it came, and starts nothing", async () => {
  const notFound = new Stores.Tests.NotFound("getJobDetails: no job");
  const world = Testing.world({ getJobDetails: async () => jarl.err(notFound) });
  const { result, said } = drive(world);
  const failed = await result;
  expect(jarl.is_err(failed)).toBe(true);
  if (jarl.is_err(failed)) {
    expect(failed.error).toBe(notFound);
  }
  expect(world.calls).toEqual([]);
  expect(said).toContainEqual(reported(notFound));
});

it("returns a guest that would not start, and stops nothing", async () => {
  const world = Testing.world({ guest: { start: down() } });
  const { result, said } = drive(world);
  const failed = Fake.failure(await result, Http.HttpServerError);
  expect(paths(world.calls)).toEqual(["start"]);
  expect(said).toContainEqual(reported(failed));
});

it("refuses a diagnose job, and starts nothing", async () => {
  const world = Testing.world({
    getJobDetails: async () => jarl.ok(Testing.details("diagnose", false)),
  });
  const { result, said } = drive(world);
  const failed = Fake.failure(await result, Drive.NotDrivable);
  expect(failed.message).toBe(`job ${JOB} is a diagnose; the driver runs a drive or a setup`);
  expect(said).toContainEqual(reported(failed));
  expect(world.calls).toEqual([]);
});

it.each<
  readonly [string, Parameters<typeof Testing.world>[0], abstract new (...args: never[]) => Error]
>([
  ["an image the proxy failed", { guest: { image: down() } }, Http.HttpServerError],
  [
    "a model that could not be reached",
    { turns: [jarl.err(new OpenRouter.OpenRouterUnreachable("openrouter: down"))] },
    OpenRouter.OpenRouterUnreachable,
  ],
  [
    "a move the proxy failed",
    { guest: { "send-keys": down() }, turns: [move()] },
    Http.HttpServerError,
  ],
  [
    "an intent that would not open",
    { guest: { "intent/start": Fake.status(409) }, turns: [move()] },
    Qemu.IntentOpen,
  ],
])("returns %s as it came, and stops the guest failed with it", async (_, script, error) => {
  const world = Testing.world(script);
  const { result, said } = drive(world);
  const failed = Fake.failure(await result, error);
  expect(world.calls.at(-1)).toEqual(["stop", { status: "failed", reason: failed.message }]);
  expect(said).toContainEqual(reported(failed));
});

it("returns a stop that failed at the end as it came", async () => {
  const world = Testing.world({ guest: { stop: down() }, turns: [done()] });
  const { result, said } = drive(world);
  const failed = Fake.failure(await result, Http.HttpServerError);
  expect(failed.message).toContain("stop");
  expect(said).toContainEqual(reported(failed));
});

it("keeps the drive's own failure when its guest then fails to stop too", async () => {
  const world = Testing.world({ guest: { image: down(), stop: down() } });
  const { result, said } = drive(world);
  const failed = Fake.failure(await result, Http.HttpServerError);
  expect(failed.message).toContain("image");
  expect(said).toContainEqual(reported(failed));
  expect(said).toContainEqual(
    expect.objectContaining({ level: "error", text: expect.stringContaining("stop") }),
  );
});

it("fails a setup whose guest stayed up through the save, and stops it", async () => {
  const world = Testing.world({
    getJobDetails: setup,
    guest: { save: Fake.status(409) },
    turns: [done()],
  });
  const { result } = drive(world);
  const ended = { status: "failed", reason: "save: 409" };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(world.calls.slice(-2)).toEqual([["save"], ["stop", ended]]);
});

it("stops the guest aborted when the driver is told to stop", async () => {
  const aborter = new AbortController();
  const world = Testing.world({
    turns: [
      move(),
      () => {
        aborter.abort(new Async.Aborted("SIGTERM received"));
        return jarl.err(new Async.Aborted("SIGTERM received"));
      },
    ],
  });
  const { result } = drive(world, { signal: aborter.signal });
  const ended = { status: "aborted", reason: "SIGTERM received" };
  expect(jarl.unwrap(await result)).toEqual(ended);
  expect(world.calls.at(-1)).toEqual(["stop", ended]);
  expect(paths(world.calls).filter((path) => path === "send-keys")).toHaveLength(1);
});
