import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import * as LinearErrors from "@oligarchy/linear/errors";
import * as TestingLinear from "@oligarchy/testing/linear";
import * as Ready from "../src/ready.ts";
import * as H from "./harness.ts";

const refusal = (operation: string) =>
  LinearErrors.LinearError.make({ operation, message: `linear: ${operation} refused` });

describe("Ready.mark happy path", () => {
  it.effect("labels the ticket ready once and writes nothing", () =>
    Effect.gen(function* () {
      const h = H.harness();
      yield* Ready.mark(H.TICKET).pipe(Effect.provide(h.layer));
      expect(h.linear.calls).toEqual([{ method: "markReady", identifier: H.TICKET }]);
      expect(h.log.lines).toEqual([]);
    }),
  );
});

describe("Ready.mark unhappy path", () => {
  it.effect("a refused label is one attempt and one line, and does not fail", () =>
    Effect.gen(function* () {
      const refused = refusal("markReady");
      const label = H.failing(refused);
      const h = H.harness({
        linear: TestingLinear.fakeLinear({ overrides: { markReady: () => label.effect } }),
      });
      yield* Ready.mark(H.TICKET).pipe(Effect.provide(h.layer));
      expect(label.counter.attempts).toBe(1);
      expect(h.log.lines).toEqual([
        {
          level: "error",
          text: "ready label add failed: linear: markReady refused",
          location: "automation",
          agentId: H.TICKET,
          cause: refused,
        },
      ]);
    }),
  );

  it.effect(
    "a label Linear never answers gives up at three seconds, inside the webhook's five",
    () =>
      Effect.gen(function* () {
        const asked = yield* Deferred.make<void>();
        const h = H.harness({
          linear: TestingLinear.fakeLinear({
            overrides: {
              markReady: () =>
                Deferred.succeed(asked, undefined).pipe(Effect.andThen(Effect.never)),
            },
          }),
        });
        const marking = yield* Ready.mark(H.TICKET).pipe(Effect.provide(h.layer), Effect.forkChild);
        yield* Deferred.await(asked);
        yield* TestClock.adjust("2999 millis");
        expect(marking.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust("1 millis");
        yield* Fiber.join(marking);
        expect(h.log.lines).toEqual([
          {
            level: "error",
            text: `ready label add failed: linear: labeling ${H.TICKET} ready failed: no answer within 3 seconds`,
            location: "automation",
            agentId: H.TICKET,
            cause: expect.objectContaining({ _tag: "LinearError", operation: "markReady" }),
          },
        ]);
      }),
  );
});

describe("Ready.release happy path", () => {
  it.effect("clears the ready label once and writes nothing", () =>
    Effect.gen(function* () {
      const h = H.harness();
      yield* Ready.release(H.TICKET).pipe(Effect.provide(h.layer));
      expect(h.linear.calls).toEqual([{ method: "clearReady", identifier: H.TICKET }]);
      expect(h.log.lines).toEqual([]);
    }),
  );

  it.effect("a clear that fails twice lands on the third attempt with nothing written", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const h = H.harness({
        linear: TestingLinear.fakeLinear({
          overrides: {
            clearReady: () =>
              Effect.suspend(() => {
                attempts += 1;
                return attempts < 3 ? Effect.fail(refusal("clearReady")) : Effect.void;
              }),
          },
        }),
      });
      yield* Ready.release(H.TICKET).pipe(Effect.provide(h.layer));
      expect(attempts).toBe(3);
      expect(h.log.lines).toEqual([]);
    }),
  );
});

describe("Ready.release unhappy path", () => {
  it.effect("a clear that fails three times is one line, and does not fail", () =>
    Effect.gen(function* () {
      const refused = refusal("clearReady");
      const clear = H.failing(refused);
      const h = H.harness({
        linear: TestingLinear.fakeLinear({ overrides: { clearReady: () => clear.effect } }),
      });
      yield* Ready.release(H.TICKET).pipe(Effect.provide(h.layer));
      expect(clear.counter.attempts).toBe(3);
      expect(h.log.lines).toEqual([
        {
          level: "error",
          text: "ready label clear failed: linear: clearReady refused",
          location: "automation",
          agentId: H.TICKET,
          cause: refused,
        },
      ]);
    }),
  );
});
