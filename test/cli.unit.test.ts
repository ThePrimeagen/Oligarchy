import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber, Layer, PlatformError, Sink, Stream } from "effect";
import { TestClock } from "effect/testing";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as Cli from "../src/cli.ts";
import * as FakeSpawner from "./support/fake-spawner.ts";

// How long a run waits for stderr to end after the command exited; then the tail so far is the tail.
const STDERR_GRACE = "2 seconds";

// Enough turns for a forked run to spawn, see the exit and register its grace timer.
const settle = Effect.gen(function* () {
  for (let i = 0; i < 100; i++) {
    yield* Effect.yieldNow;
  }
});

describe("Cli.run happy path", () => {
  it.effect(
    "spawns the command with its args, its stdout inherited, and succeeds when it exits 0",
    () =>
      Effect.gen(function* () {
        const spawner = FakeSpawner.fakeSpawner(() => ({
          exitCode: 0,
          stdout: "printed result",
          stderr: "noise",
        }));
        yield* Cli.run("tool", ["--flag", "value"]).pipe(Effect.provide(spawner.layer));
        expect(spawner.spawned).toHaveLength(1);
        expect(spawner.spawned[0]).toMatchObject({
          command: "tool",
          args: ["--flag", "value"],
          options: {
            stdin: "ignore",
            stdout: "inherit",
            stderr: "pipe",
            extendEnv: true,
            detached: false,
            killSignal: "SIGTERM",
            forceKillAfter: Cli.FORCE_KILL_AFTER,
          },
        });
      }),
  );

  it.effect("runs with no variables of its own when none are given", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
      yield* Cli.run("tool", []).pipe(Effect.provide(spawner.layer));
      expect(spawner.spawned[0]?.options).toMatchObject({ env: {}, extendEnv: true });
    }),
  );

  it.effect("waits until the command exits before succeeding", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({}));
      const running = yield* Effect.forkChild(
        Cli.run("tool", ["wait"]).pipe(Effect.provide(spawner.layer)),
      );
      yield* Effect.yieldNow;
      expect(running.pollUnsafe()).toBeUndefined();
      yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
      yield* Fiber.join(running);
    }),
  );

  // The stderr pipe is shared with every process the command started; one that outlives it
  // keeps the pipe open, and Node's `exit` fires long before its `close`. The exit is the end
  // of the run: the wait for stderr is bounded after it.
  it.effect(
    "succeeds once the command exits 0 while a process it started still holds stderr, after the grace",
    () =>
      Effect.gen(function* () {
        const spawner = FakeSpawner.fakeSpawner(() => ({
          exitCode: 0,
          stderr: "noise\n",
          stderrStaysOpen: true,
        }));
        const running = yield* Effect.forkChild(
          Cli.run("tool", ["run"]).pipe(Effect.provide(spawner.layer)),
        );
        yield* settle;
        expect(running.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust(STDERR_GRACE);
        yield* Fiber.join(running);
        // Leaving the scope released the process; nothing was killed, it had already exited.
        expect(spawner.spawned[0]?.isReleased()).toBe(true);
        expect(spawner.spawned[0]?.kills).toEqual([]);
      }),
  );

  it.effect("does not wait out the grace when stderr ends with the exit", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({}));
      const running = yield* Effect.forkChild(
        Cli.run("tool", ["run"]).pipe(Effect.provide(spawner.layer)),
      );
      yield* Effect.yieldNow;
      yield* spawner.spawned[0]?.exit(0, "last words\n") ?? Effect.void;
      // No clock adjustment: the exit and the pipe's end are all the run waits for.
      yield* Fiber.join(running);
    }),
  );
});

describe("Cli.run unhappy path", () => {
  it.effect("fails with the spawn error when the binary cannot be opened", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        spawnError: "spawn tool ENOENT",
      }));
      const error = yield* Effect.flip(
        Cli.run("tool", ["run"]).pipe(Effect.provide(spawner.layer)),
      );
      expect(error._tag).toBe("CliFailed");
      expect(error.command).toBe("tool");
      expect(error.message).toBe("spawn tool ENOENT");
    }),
  );

  it.effect("forwards stderr when the command exits non-zero", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        exitCode: 1,
        stderr: "out of token credits\n",
      }));
      const error = yield* Effect.flip(
        Cli.run("tool", ["run"]).pipe(Effect.provide(spawner.layer)),
      );
      expect(error._tag).toBe("CliFailed");
      expect(error.message).toBe("out of token credits");
    }),
  );

  it.effect(
    "keeps the last 4 KiB of stderr, NUL bytes dropped, so the message is storable text",
    () =>
      Effect.gen(function* () {
        const head = "x".repeat(5_000);
        const spawner = FakeSpawner.fakeSpawner(() => ({
          exitCode: 1,
          stderr: `${head}\nbinary \u0000junk\u0000 then\nError: Invalid upload request.\n`,
        }));
        const error = yield* Effect.flip(
          Cli.run("tool", ["run"]).pipe(Effect.provide(spawner.layer)),
        );
        expect(error._tag).toBe("CliFailed");
        expect(error.message.includes("\u0000")).toBe(false);
        expect(error.message.length).toBeLessThanOrEqual(Cli.STDERR_TAIL);
        expect(error.message.endsWith("Error: Invalid upload request.")).toBe(true);
        expect(error.message).toContain("binary junk then");
        expect(error.message.startsWith("x")).toBe(true);
        expect(error.message.length).toBe(Cli.STDERR_TAIL);
      }),
  );

  // The drain keeps a bounded buffer; NUL bytes are dropped as they arrive, so a binary blob after
  // the message cannot push it out of the buffer.
  it.effect("keeps the message when a NUL blob larger than the buffer follows it", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        exitCode: 1,
        stderr: `Error: Invalid upload request.\n${"\u0000".repeat(20_000)}`,
      }));
      const error = yield* Effect.flip(
        Cli.run("tool", ["run"]).pipe(Effect.provide(spawner.layer)),
      );
      expect(error.message).toBe("Error: Invalid upload request.");
    }),
  );

  it.effect("names the exit when the command exits non-zero with empty stderr", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 2 }));
      const error = yield* Effect.flip(Cli.run("tool", []).pipe(Effect.provide(spawner.layer)));
      expect(error.message).toBe("tool exited 2");
    }),
  );

  it.effect(
    "fails with what the command wrote when it exits non-zero while a process it started still holds stderr",
    () =>
      Effect.gen(function* () {
        const spawner = FakeSpawner.fakeSpawner(() => ({
          exitCode: 1,
          stderr: "out of token credits\n",
          stderrStaysOpen: true,
        }));
        const running = yield* Effect.forkChild(
          Effect.flip(Cli.run("tool", ["run"]).pipe(Effect.provide(spawner.layer))),
        );
        yield* settle;
        expect(running.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust(STDERR_GRACE);
        const error = yield* Fiber.join(running);
        expect(error._tag).toBe("CliFailed");
        expect(error.message).toBe("out of token credits");
      }),
  );

  it.effect("fails with the signal when the command dies before exiting", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({}));
      const running = yield* Effect.forkChild(
        Effect.flip(Cli.run("tool", ["run"]).pipe(Effect.provide(spawner.layer))),
      );
      yield* Effect.yieldNow;
      yield* spawner.spawned[0]?.die("SIGKILL") ?? Effect.void;
      const error = yield* Fiber.join(running);
      expect(error._tag).toBe("CliFailed");
      expect(error.message).toContain("SIGKILL");
    }),
  );

  it.effect("forwards a stderr stream failure as CliFailed, not a defect", () =>
    Effect.gen(function* () {
      const cause = PlatformError.systemError({
        _tag: "Unknown",
        module: "ChildProcess",
        method: "stderr",
        description: "stderr pipe broken",
        cause: new Error("stderr pipe broken"),
      });
      const layer = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(
        ChildProcessSpawner.make(() =>
          Effect.succeed(
            ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(1),
              exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              stdin: Sink.drain,
              stdout: Stream.empty,
              stderr: Stream.fail(cause),
              all: Stream.fail(cause),
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void),
            }),
          ),
        ),
      );
      const error = yield* Effect.flip(Cli.run("tool", []).pipe(Effect.provide(layer)));
      expect(error._tag).toBe("CliFailed");
      expect(error.message).toBe("stderr pipe broken");
    }),
  );
});
