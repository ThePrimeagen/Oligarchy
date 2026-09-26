import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Sink, Stdio } from "effect";
import { TestClock } from "effect/testing";
import * as AbortWait from "../src/abort-wait.ts";

const URL = "http://127.0.0.1:54322";

const capture = (terminal: boolean) => {
  const chunks: Array<string> = [];
  const stdout = Sink.forEach((chunk: string | Uint8Array) =>
    Effect.sync(() => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    }),
  );
  return {
    chunks,
    layer: Stdio.layerTest({
      stdout: () => stdout,
      stdoutIsTerminal: Effect.succeed(terminal),
    }),
  };
};

const text = (chunks: ReadonlyArray<string>): string => chunks.join("");

describe("abort wait", () => {
  it.effect("a terminal rewrites one line, counting down until the client answers", () =>
    Effect.gen(function* () {
      const answered = yield* Deferred.make<void>();
      const out = capture(true);
      const fiber = yield* AbortWait.within(
        URL,
        Deferred.await(answered).pipe(Effect.as("ok")),
      ).pipe(Effect.provide(out.layer), Effect.forkChild({ startImmediately: true }));
      expect(text(out.chunks)).toContain(`⠋ Aborting ${URL} ... 10s`);
      yield* TestClock.adjust("80 millis");
      expect(text(out.chunks)).toContain(`⠙ Aborting ${URL} ... 10s`);
      yield* TestClock.adjust("1920 millis");
      expect(text(out.chunks)).toContain(`Aborting ${URL} ... 8s`);
      yield* Deferred.succeed(answered, undefined);
      expect(yield* Fiber.join(fiber)).toBe("ok");
      expect(out.chunks.at(-1)).toBe("\r\x1b[K");
    }),
  );

  it.effect(
    "a client that never answers counts down to the give-up, then the line is cleared",
    () =>
      Effect.gen(function* () {
        const out = capture(true);
        const fiber = yield* AbortWait.within(URL, Effect.never).pipe(
          Effect.provide(out.layer),
          Effect.forkChild({ startImmediately: true }),
        );
        expect(text(out.chunks)).toContain(`⠋ Aborting ${URL} ... 10s`);
        // The next frame after nine seconds is the first one with under a second left.
        yield* TestClock.adjust("9040 millis");
        expect(text(out.chunks)).toContain(`Aborting ${URL} ... 1s`);
        yield* TestClock.adjust("960 millis");
        const error = yield* Effect.flip(Fiber.join(fiber));
        expect(error).toMatchObject({
          _tag: "AutomationClientError",
          message: `automation client: POST ${URL}/abort failed: no answer within 10 seconds`,
        });
        expect(out.chunks.at(-1)).toBe("\r\x1b[K");
      }),
  );

  it.effect("a pipe prints a fresh line each second and keeps them", () =>
    Effect.gen(function* () {
      const out = capture(false);
      const fiber = yield* AbortWait.within(URL, Effect.never).pipe(
        Effect.provide(out.layer),
        Effect.forkChild({ startImmediately: true }),
      );
      expect(out.chunks).toEqual([`⠋ Aborting ${URL} ... 10s\n`]);
      yield* TestClock.adjust("1 second");
      expect(out.chunks).toEqual([`⠋ Aborting ${URL} ... 10s\n`, `⠙ Aborting ${URL} ... 9s\n`]);
      yield* Fiber.interrupt(fiber);
    }),
  );
});
