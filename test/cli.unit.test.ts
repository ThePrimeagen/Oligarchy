import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import * as Cli from "../src/cli.ts";
import * as FakeSpawner from "./support/fake-spawner.ts";

describe("Cli.run happy path", () => {
  it.effect("spawns the command with its args and succeeds when it exits 0", () =>
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
          stdout: "ignore",
          stderr: "pipe",
          extendEnv: true,
          detached: false,
        },
      });
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

  it.effect("names the exit when the command exits non-zero with empty stderr", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 2 }));
      const error = yield* Effect.flip(Cli.run("tool", []).pipe(Effect.provide(spawner.layer)));
      expect(error.message).toBe("tool exited 2");
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
});
