import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as Log from "@oligarchy/log/log";
import * as TestingLog from "../src/log.ts";

describe("fakeLog happy path", () => {
  it.effect("keeps every line with its level, attribution, Sentry choice and cause, in order", () =>
    Effect.gen(function* () {
      const fake = TestingLog.fakeLog();
      const boom = new Error("boom");
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.info("listening", { location: "server" });
        yield* log.error("POST /reserve failed", { agentId: "OLI-1", skipSentry: true });
        yield* log.fatal("qemu server: boom", { cause: boom });
      }).pipe(Effect.provide(fake.layer));
      expect(fake.lines).toEqual([
        {
          level: "info",
          text: "listening",
          location: "server",
          agentId: undefined,
          skipSentry: false,
          cause: undefined,
        },
        {
          level: "error",
          text: "POST /reserve failed",
          location: undefined,
          agentId: "OLI-1",
          skipSentry: true,
          cause: undefined,
        },
        {
          level: "fatal",
          text: "qemu server: boom",
          location: undefined,
          agentId: undefined,
          skipSentry: false,
          cause: boom,
        },
      ]);
      expect(TestingLog.texts(fake)).toEqual([
        "listening",
        "POST /reserve failed",
        "qemu server: boom",
      ]);
    }),
  );
});

describe("fakeLog unhappy path", () => {
  it.effect("two fakes share nothing, and a fake nobody wrote to has no lines", () =>
    Effect.gen(function* () {
      const written = TestingLog.fakeLog();
      const quiet = TestingLog.fakeLog();
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.warning("only here");
      }).pipe(Effect.provide(written.layer));
      expect(TestingLog.texts(written)).toEqual(["only here"]);
      expect(quiet.lines).toEqual([]);
    }),
  );
});
