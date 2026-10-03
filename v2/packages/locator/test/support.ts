import * as DecisionApi from "@oligarchy/decision-api";
import * as Fake from "@oligarchy/decision-api/testing";
import * as jarl from "jarl";
import sharp from "sharp";
import { vi } from "vitest";
import * as Locator from "../src/main.ts";

export const CALL_TIMEOUT_MS = 4_321;
export const RETRY_WAIT_MS = 1_234;
export const RETRIES = 2;
export const OPTIONS: Locator.Options = {
  grid: 4,
  rounds: 3,
  power: 4,
  boxScale: 1.5,
  threshold: 0.45,
  overviewScale: 0.25,
  gridImageScale: 0.5,
  quality: 70,
  callTimeoutMs: CALL_TIMEOUT_MS,
  retries: RETRIES,
  retryWaitMs: RETRY_WAIT_MS,
};
export const TARGET = "the word 'Lock'";
export const HINT =
  "'Lock' is the label of the second entry of the System menu, written just right of a padlock icon.";
export const TASK = "Lock the session using the mouse.";

export const screen = () =>
  sharp({ create: { width: 1280, height: 800, channels: 3, background: "#203040" } })
    .png()
    .toBuffer()
    .then((buffer) => new Uint8Array(buffer));

type Reply = jarl.Result<DecisionApi.Response, DecisionApi.Failure>;

// One noul per question: p for the cell `best` names in that round, `rest` for every other cell.
export const answering =
  (best: ReadonlyArray<string>, p = 1, rest = 0) =>
  (request: DecisionApi.Request, round: number): Reply =>
    jarl.ok({
      model: "clef",
      answers: Object.fromEntries(
        Object.keys(request.questions).map((id) => [
          id,
          { type: "noul" as const, noul: id === best[round] ? p : rest },
        ]),
      ),
      usage: { inputTokens: 100, outputTokens: 0 },
    });

// A decision-api fake whose replies are taken in turn; a function reply is told its round.
export const decisions = (
  replies: ReadonlyArray<Reply | ((request: DecisionApi.Request, round: number) => Reply)>,
) => {
  let call = 0;
  let round = 0;
  const fake = Fake.decisionApi({
    reply: (request) => {
      const reply = replies[Math.min(call, replies.length - 1)]!;
      call += 1;
      if (typeof reply !== "function") {
        return reply;
      }
      const answered = reply(request, round);
      round += 1;
      return answered;
    },
  });
  return { ...fake, locator: Locator.create(fake, OPTIONS) };
};

// The event loop's own setImmediate, taken before a test fakes the timers: sharp finishes on its
// own threads, so a test yields to the loop while it advances the fake clock.
const realImmediate = setImmediate;
const yieldToLoop = () => new Promise<void>((resolve) => realImmediate(resolve));

const SETTLED = Symbol("settled");

// Advances the fake clock until the promise settles, yielding to the loop between steps.
export const settle = async <T>(promise: Promise<T>): Promise<T> => {
  for (;;) {
    const raced = await Promise.race([
      promise.then(() => SETTLED),
      yieldToLoop().then(() => undefined),
    ]);
    if (raced === SETTLED) {
      return promise;
    }
    await vi.advanceTimersByTimeAsync(RETRY_WAIT_MS);
  }
};
