import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { HttpServerError } from "effect/unstable/http";
import * as Runs from "../../src/automation-client/runs.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as Contract from "../../src/shared/contract.ts";
import * as FakeRunner from "../support/fake-runner.ts";
import * as FakeStats from "../support/fake-stats.ts";
import * as FakeLog from "../support/log.ts";

const KEY = "OLI-45";
const PROMPT = "drive the guest to the lock screen";
const BODY = Contract.RunBody.make({ key: KEY, prompt: PROMPT });
const ATTR = { location: "automation-OLI-45", agentId: KEY } as const;

const env = (runner: FakeRunner.FakeRunner, log: FakeLog.FakeLog) =>
  Runs.Runs.layer.pipe(
    Layer.provide(runner.layer),
    Layer.provide(FakeStats.fakeStats),
    Layer.provide(log.layer),
  );

describe("Runs happy path", () => {
  it.effect("stats.agents is 0, 1 while a run is held open, 0 after", () =>
    Effect.gen(function* () {
      const runner = FakeRunner.fakeRunner({ hold: true, name: "opencode" });
      const log = FakeLog.fakeLog();
      const runs = yield* Runs.Runs.pipe(Effect.provide(env(runner, log)));
      expect((yield* runs.stats).agents).toBe(0);
      const fiber = yield* Effect.forkChild(runs.run(BODY));
      yield* Effect.yieldNow;
      expect((yield* runs.stats).agents).toBe(1);
      yield* runner.release;
      const response = yield* Fiber.join(fiber);
      expect(response.session).toBe("ses_fake");
      expect((yield* runs.stats).agents).toBe(0);
    }),
  );

  it.effect("two runs held open count 2", () =>
    Effect.gen(function* () {
      const runner = FakeRunner.fakeRunner({ hold: true });
      const log = FakeLog.fakeLog();
      const runs = yield* Runs.Runs.pipe(Effect.provide(env(runner, log)));
      const first = yield* Effect.forkChild(runs.run(BODY));
      const second = yield* Effect.forkChild(
        runs.run(Contract.RunBody.make({ key: "OLI-46", prompt: "other" })),
      );
      yield* Effect.yieldNow;
      expect((yield* runs.stats).agents).toBe(2);
      yield* runner.release;
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      expect((yield* runs.stats).agents).toBe(0);
    }),
  );

  it.effect(
    "the runner receives the key and prompt; the response uses the clock and the runner",
    () =>
      Effect.gen(function* () {
        const runner = FakeRunner.fakeRunner({
          hold: true,
          name: "opencode",
          model: "opencode/muse-spark-1.3-contributor-free",
          script: () => ({ _tag: "succeed", outcome: { session: "ses_1", text: "done" } }),
        });
        const log = FakeLog.fakeLog();
        const runs = yield* Runs.Runs.pipe(Effect.provide(env(runner, log)));
        const fiber = yield* Effect.forkChild(runs.run(BODY));
        yield* Effect.yieldNow;
        yield* TestClock.adjust("5 seconds");
        yield* runner.release;
        const response = yield* Fiber.join(fiber);
        expect(runner.inputs).toEqual([{ key: KEY, prompt: PROMPT }]);
        expect(response).toEqual({
          model: "opencode/muse-spark-1.3-contributor-free",
          session: "ses_1",
          text: "done",
          elapsedMs: 5_000,
        });
        expect(log.lines).toEqual([
          {
            level: "info",
            text: `run started; opencode; ${String(PROMPT.length)} chars`,
            location: ATTR.location,
            agentId: ATTR.agentId,
            skipSentry: false,
            cause: undefined,
          },
          {
            level: "info",
            text: "run finished; 4 chars in 5000ms",
            location: ATTR.location,
            agentId: ATTR.agentId,
            skipSentry: false,
            cause: undefined,
          },
        ]);
        expect(log.acquired).toEqual([KEY]);
        expect(log.released).toEqual([KEY]);
      }),
  );
});

describe("Runs unhappy path", () => {
  it.effect(
    "a RunFailed from the runner propagates unchanged, the count is 0, and Runs writes no error line",
    () =>
      Effect.gen(function* () {
        const failure = Errors.RunFailed.make({
          message: "opencode: exited 1: boom",
          agentId: KEY,
          cause: new Error("boom"),
        });
        const runner = FakeRunner.fakeRunner({
          script: () => ({ _tag: "fail", error: failure }),
        });
        const log = FakeLog.fakeLog();
        const runs = yield* Runs.Runs.pipe(Effect.provide(env(runner, log)));
        const error = yield* Effect.flip(runs.run(BODY));
        expect(error).toBe(failure);
        expect((yield* runs.stats).agents).toBe(0);
        expect(log.lines.map((line) => line.level)).toEqual(["info"]);
        expect(log.lines[0]?.text).toMatch(/^run started;/);
        expect(log.released).toEqual([KEY]);
      }),
  );

  it.effect("the clock past RUN_TIMEOUT is RunTimedOut and the runner's scope was closed", () =>
    Effect.gen(function* () {
      const runner = FakeRunner.fakeRunner({ hold: true, name: "opencode" });
      const log = FakeLog.fakeLog();
      const runs = yield* Runs.Runs.pipe(Effect.provide(env(runner, log)));
      const fiber = yield* Effect.forkChild(runs.run(BODY));
      yield* Effect.yieldNow;
      yield* TestClock.adjust("2 hours");
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error).toMatchObject({
        _tag: "RunTimedOut",
        message: "opencode: no result within 2 hours",
        agentId: KEY,
      });
      expect(runner.finalized[0]).toBe(true);
      expect((yield* runs.stats).agents).toBe(0);
    }),
  );

  it.effect(
    "interrupting the run fiber logs client disconnected when the cause carries ClientAbort",
    () =>
      Effect.gen(function* () {
        const runner = FakeRunner.fakeRunner({ hold: true, name: "opencode" });
        const log = FakeLog.fakeLog();
        const runs = yield* Runs.Runs.pipe(Effect.provide(env(runner, log)));
        const fiber = yield* Effect.forkChild(runs.run(BODY));
        yield* Effect.yieldNow;
        yield* TestClock.adjust("120034 millis");
        fiber.interruptUnsafe(undefined, HttpServerError.ClientAbort.annotation);
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        expect(runner.finalized[0]).toBe(true);
        expect(log.lines.map((line) => line.text)).toEqual([
          `run started; opencode; ${String(PROMPT.length)} chars`,
          "run aborted; client disconnected after 120034ms",
        ]);
      }),
  );

  it.effect("interrupting the run fiber otherwise logs interrupted after Tms", () =>
    Effect.gen(function* () {
      const runner = FakeRunner.fakeRunner({ hold: true, name: "opencode" });
      const log = FakeLog.fakeLog();
      const runs = yield* Runs.Runs.pipe(Effect.provide(env(runner, log)));
      const fiber = yield* Effect.forkChild(runs.run(BODY));
      yield* Effect.yieldNow;
      yield* TestClock.adjust("3 seconds");
      yield* Fiber.interrupt(fiber);
      expect(runner.finalized[0]).toBe(true);
      expect(log.lines.map((line) => line.text)).toEqual([
        `run started; opencode; ${String(PROMPT.length)} chars`,
        "run aborted; interrupted after 3000ms",
      ]);
    }),
  );

  it.effect("a cleanup that dies is the run cleanup failed line, and the run is still over", () =>
    Effect.gen(function* () {
      const boom = new Error("rm: directory not empty");
      const runner = FakeRunner.fakeRunner({ name: "opencode", cleanupDies: boom });
      const log = FakeLog.fakeLog();
      const runs = yield* Runs.Runs.pipe(Effect.provide(env(runner, log)));
      const response = yield* runs.run(BODY);
      expect(response.session).toBe("ses_fake");
      expect((yield* runs.stats).agents).toBe(0);
      expect(log.lines.map((line) => [line.level, line.text])).toEqual([
        ["info", `run started; opencode; ${String(PROMPT.length)} chars`],
        ["error", "run cleanup failed: rm: directory not empty"],
        ["info", "run finished; 2 chars in 0ms"],
      ]);
      expect(log.lines[1]).toMatchObject({ ...ATTR, skipSentry: false, cause: boom });
      expect(log.released).toEqual([KEY]);
    }),
  );

  it.effect("a key's colour stays while another run of the same key is live", () =>
    Effect.gen(function* () {
      const runner = FakeRunner.fakeRunner({ hold: true });
      const log = FakeLog.fakeLog();
      const runs = yield* Runs.Runs.pipe(Effect.provide(env(runner, log)));
      const first = yield* Effect.forkChild(runs.run(BODY));
      yield* Effect.yieldNow;
      const second = yield* Effect.forkChild(runs.run(BODY));
      yield* Effect.yieldNow;
      yield* TestClock.adjust("1 second");
      yield* Fiber.interrupt(first);
      expect(log.released).toEqual([]);
      yield* runner.release;
      yield* Fiber.join(second);
      expect(log.released).toEqual([KEY]);
      expect((yield* runs.stats).agents).toBe(0);
    }),
  );

  it.effect("a runner defect propagates as a defect, the count is 0 and the scope closed", () =>
    Effect.gen(function* () {
      const defect = new Error("boom");
      const runner = FakeRunner.fakeRunner({
        script: () => ({ _tag: "die", defect }),
      });
      const log = FakeLog.fakeLog();
      const runs = yield* Runs.Runs.pipe(Effect.provide(env(runner, log)));
      const exit = yield* Effect.exit(runs.run(BODY));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
        expect(Cause.squash(exit.cause)).toBe(defect);
      }
      expect((yield* runs.stats).agents).toBe(0);
      expect(runner.finalized[0]).toBe(true);
    }),
  );
});
