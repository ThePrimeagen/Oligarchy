import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import * as LinearErrors from "@oligarchy/linear/errors";
import * as Retry from "../src/retry.ts";

describe("Retry.linearRead", () => {
  const busy = LinearErrors.LinearError.make({
    operation: "listNeedsReview",
    message: "linear: request failed (503): busy",
    status: 503,
    retryable: true,
  });
  const reads = (answers: ReadonlyArray<"busy" | "refused" | "ok">) => {
    let calls = 0;
    const refused = LinearErrors.LinearError.make({
      operation: "listNeedsReview",
      message: "linear: request failed (401): unauthorized",
      status: 401,
    });
    const list = Effect.suspend(() => {
      const answer = answers[Math.min(calls, answers.length - 1)];
      calls += 1;
      return answer === "ok" ? Effect.succeed([]) : Effect.fail(answer === "busy" ? busy : refused);
    });
    return { list, calls: () => calls };
  };

  it.effect("a retryable failure is read again two seconds later", () =>
    Effect.gen(function* () {
      const column = reads(["busy", "ok"]);
      const fiber = yield* Effect.forkChild(Retry.linearRead(column.list));
      yield* TestClock.adjust("1 second");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 second");
      expect(yield* Fiber.join(fiber)).toEqual([]);
      expect(column.calls()).toBe(2);
    }),
  );

  it.effect("a second retryable failure is the failure (unhappy)", () =>
    Effect.gen(function* () {
      const column = reads(["busy"]);
      const fiber = yield* Effect.forkChild(Effect.flip(Retry.linearRead(column.list)));
      yield* TestClock.adjust("2 seconds");
      expect(yield* Fiber.join(fiber)).toBe(busy);
      expect(column.calls()).toBe(2);
    }),
  );

  it.effect("a failure that is not retryable is not read again (unhappy)", () =>
    Effect.gen(function* () {
      const column = reads(["refused", "ok"]);
      const error = yield* Effect.flip(Retry.linearRead(column.list));
      expect(error.status).toBe(401);
      expect(column.calls()).toBe(1);
    }),
  );
});
