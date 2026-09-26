import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, ErrorReporter } from "effect";
import * as TestingReporter from "../src/reporter.ts";

describe("collect happy path", () => {
  it.effect("keeps what is reported, with the fiber's log annotations", () =>
    Effect.gen(function* () {
      const collector = TestingReporter.collect();
      const boom = new Error("boom");
      yield* ErrorReporter.report(Cause.fail(boom)).pipe(
        Effect.annotateLogs({ location: "server" }),
        Effect.provide(collector.layer),
      );
      expect(collector.reported).toMatchObject([
        { error: boom, annotations: { location: "server" } },
      ]);
    }),
  );
});

describe("collect unhappy path", () => {
  it.effect("an error that asks to be ignored is never collected", () =>
    Effect.gen(function* () {
      const collector = TestingReporter.collect();
      const quiet = Object.assign(new Error("expected"), { [ErrorReporter.ignore]: true });
      yield* ErrorReporter.report(Cause.fail(quiet)).pipe(Effect.provide(collector.layer));
      expect(collector.reported).toEqual([]);
    }),
  );
});
