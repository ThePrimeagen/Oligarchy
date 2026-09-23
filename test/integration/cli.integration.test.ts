import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Schedule } from "effect";
import { TestClock } from "effect/testing";
import * as Cli from "../../src/cli.ts";

// The real spawner and a real stand-in on the test clock: the signals are real, the force-kill
// deadline is TestClock's. That Sessions.abort kills with these options is its unit test's.
const ABORT_KILL = { killSignal: "SIGTERM", forceKillAfter: Cli.FORCE_KILL_AFTER } as const;

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oligarchy-cli-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Touches `ready` once `prelude` has run, then becomes the sleep, so the process signalled is the
// process that exits.
const standIn = (prelude: string): string => {
  const file = join(dir, "opencode");
  writeFileSync(file, `#!/bin/sh\n${prelude}\ntouch "${join(dir, "ready")}"\nexec sleep 60\n`);
  chmodSync(file, 0o755);
  return file;
};

// A real process starting, so a wait on the live clock.
const ready = () =>
  TestClock.withLive(
    Effect.sync(() => existsSync(join(dir, "ready"))).pipe(
      Effect.repeat({ until: (found) => found, schedule: Schedule.spaced("5 millis") }),
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => Effect.die("the stand-in never started"),
      }),
    ),
  );

// Released before the spawner's own release, whose SIGTERM deadline would sit on a test clock
// nothing advances by then. Best effort: a child that already exited cannot be killed.
const spawn = (file: string) =>
  Effect.acquireRelease(Cli.spawn(file, []), (handle) =>
    Effect.ignore(handle.kill({ killSignal: "SIGKILL" })),
  );

describe("Cli.spawn killed the way Sessions.abort kills opencode", () => {
  it.effect("SIGTERM ends a child that exits on it without the clock moving", () =>
    Effect.gen(function* () {
      const handle = yield* spawn(standIn(""));
      yield* handle.kill(ABORT_KILL);
      const error = yield* Effect.flip(Cli.awaitExit("opencode", handle));
      expect(error).toMatchObject({
        _tag: "CliFailed",
        message: expect.stringContaining("'SIGTERM'"),
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "a child that ignores SIGTERM is SIGKILLed once the test clock reaches the deadline",
    () =>
      Effect.gen(function* () {
        const handle = yield* spawn(standIn('trap "" TERM'));
        // SIGTERM must not arrive before the trap.
        yield* ready();
        // Started at once, so SIGTERM is sent and the deadline is on the test clock before it moves.
        const killing = yield* Effect.forkChild(handle.kill(ABORT_KILL), {
          startImmediately: true,
        });
        yield* TestClock.adjust(Cli.FORCE_KILL_AFTER);
        yield* Fiber.join(killing);
        const error = yield* Effect.flip(Cli.awaitExit("opencode", handle));
        expect(error).toMatchObject({
          _tag: "CliFailed",
          message: expect.stringContaining("'SIGKILL'"),
        });
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
