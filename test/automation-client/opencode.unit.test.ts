import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import * as OpenCode from "../../src/automation-client/opencode.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";

const MODEL = "opencode/muse-spark-1.3-contributor-free";

describe("OpenCode.run happy path", () => {
  it.effect(
    "launches opencode run --auto with the model and the prompt and succeeds when it exits 0",
    () =>
      Effect.gen(function* () {
        const spawner = FakeSpawner.fakeSpawner(() => ({
          exitCode: 0,
          stdout: "the written result",
        }));
        yield* OpenCode.run("do the work", MODEL).pipe(Effect.provide(spawner.layer));
        expect(spawner.spawned).toMatchObject([
          { command: OpenCode.BIN, args: ["run", "--auto", "--model", MODEL, "--", "do the work"] },
        ]);
      }),
  );

  // --auto answers only the root session's asks; a subagent the driver spawns asks into the void
  // (anomalyco/opencode#36868). The two permissions that default to ask are allowed outright.
  it.effect("hands opencode a config that allows the ask-class permissions for every session", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
      yield* OpenCode.run("do the work", MODEL).pipe(Effect.provide(spawner.layer));
      const content = spawner.spawned[0]?.options.env?.OPENCODE_CONFIG_CONTENT;
      expect(content).toBeDefined();
      expect(JSON.parse(content ?? "")).toEqual({
        permission: { external_directory: "allow", doom_loop: "allow" },
        // A model stream that goes silent aborts instead of holding the run to its ceiling.
        provider: { openrouter: { options: { headerTimeout: 180_000, chunkTimeout: 180_000 } } },
      });
      expect(spawner.spawned[0]?.options.extendEnv).toBe(true);
    }),
  );

  it.effect("passes a dashed prompt after -- so opencode does not treat it as a flag", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
      yield* OpenCode.run("--help", MODEL).pipe(Effect.provide(spawner.layer));
      expect(spawner.spawned).toMatchObject([
        { command: OpenCode.BIN, args: ["run", "--auto", "--model", MODEL, "--", "--help"] },
      ]);
    }),
  );

  it.effect("the model given is the model passed, whichever provider it names", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
      const deepseek = "openrouter/deepseek/deepseek-v4.1-flash";
      yield* OpenCode.run("do the work", deepseek).pipe(Effect.provide(spawner.layer));
      expect(spawner.spawned[0]?.args).toEqual([
        "run",
        "--auto",
        "--model",
        deepseek,
        "--",
        "do the work",
      ]);
    }),
  );
});

describe("OpenCode.run ceiling", () => {
  it.effect("a run that outlives the ceiling is killed and fails as RunFailed naming it", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({}));
      const running = yield* Effect.forkChild(
        Effect.flip(OpenCode.run("do the work", MODEL).pipe(Effect.provide(spawner.layer))),
      );
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      yield* TestClock.adjust(OpenCode.CEILING);
      const error = yield* Fiber.join(running);
      expect(error).toMatchObject({
        _tag: "RunFailed",
        message: `opencode run exceeded ${OpenCode.CEILING}`,
      });
      expect(spawner.spawned[0]?.isReleased()).toBe(true);
      expect(spawner.spawned[0]?.kills).toEqual(["SIGTERM"]);
    }),
  );

  it.effect("a run that exits a second before the ceiling succeeds", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({}));
      const running = yield* Effect.forkChild(
        OpenCode.run("do the work", MODEL).pipe(Effect.provide(spawner.layer)),
      );
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      yield* TestClock.adjust("1799 seconds");
      yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
      yield* Fiber.join(running);
      expect(spawner.spawned[0]?.kills).toEqual([]);
    }),
  );
});

describe("OpenCode.run unhappy path", () => {
  it.effect("forwards a spawn failure as RunFailed", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        spawnError: "spawn opencode ENOENT",
      }));
      const error = yield* Effect.flip(
        OpenCode.run("do the work", MODEL).pipe(Effect.provide(spawner.layer)),
      );
      expect(error._tag).toBe("RunFailed");
      expect(error.message).toBe("spawn opencode ENOENT");
    }),
  );

  it.effect("forwards the command's error when it exits non-zero", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        exitCode: 1,
        stderr: "out of token credits\n",
      }));
      const error = yield* Effect.flip(
        OpenCode.run("do the work", MODEL).pipe(Effect.provide(spawner.layer)),
      );
      expect(error._tag).toBe("RunFailed");
      expect(error.message).toBe("out of token credits");
    }),
  );
});
