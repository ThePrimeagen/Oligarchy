import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import * as Read from "../../src/viz/read.ts";

const counted = (mode: Read.Mode, calls: { count: number }) => ({
  mode,
  read: Effect.sync(() => {
    calls.count += 1;
    return calls.count;
  }),
});

describe("read", () => {
  it.effect("reads a once-need at the open and keeps it, and a cycle-need every time", () =>
    Effect.gen(function* () {
      const once = { count: 0 };
      const cycle = { count: 0 };
      const needs = {
        machines: counted("once", once),
        series: counted("cycle", cycle),
        queue: { mode: "cycle" as const, read: Effect.succeed("queue") },
      };
      const opened = yield* Read.collect(needs, Option.none(), 1);
      expect(opened).toEqual({ machines: 1, series: 1, queue: "queue", readAt: 1 });
      const again = yield* Read.collect(needs, Option.some(opened), 2);
      expect(again).toEqual({ machines: 1, series: 2, queue: "queue", readAt: 2 });
      expect(once.count).toBe(1);
      expect(cycle.count).toBe(2);
    }),
  );

  it.effect("a need that fails is the failure, with nothing kept", () =>
    Effect.gen(function* () {
      const needs = {
        machines: { mode: "cycle" as const, read: Effect.fail("down") },
        series: { mode: "cycle" as const, read: Effect.succeed(1) },
        queue: { mode: "once" as const, read: Effect.succeed(1) },
      };
      const error = yield* Effect.flip(Read.collect(needs, Option.none(), 1));
      expect(error).toBe("down");
    }),
  );
});
