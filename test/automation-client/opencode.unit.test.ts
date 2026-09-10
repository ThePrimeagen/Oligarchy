import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as OpenCode from "../../src/automation-client/opencode.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";

describe("OpenCode.run happy path", () => {
  it.effect("launches opencode run with the prompt and succeeds when it exits 0", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        exitCode: 0,
        stdout: "the written result",
      }));
      yield* OpenCode.run("do the work").pipe(Effect.provide(spawner.layer));
      expect(spawner.spawned).toMatchObject([
        { command: OpenCode.BIN, args: ["run", "--", "do the work"] },
      ]);
    }),
  );

  it.effect("passes a dashed prompt after -- so opencode does not treat it as a flag", () => {
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
      yield* OpenCode.run("--help").pipe(Effect.provide(spawner.layer));
      expect(spawner.spawned).toMatchObject([
        { command: OpenCode.BIN, args: ["run", "--", "--help"] },
      ]);
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
        OpenCode.run("do the work").pipe(Effect.provide(spawner.layer)),
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
        OpenCode.run("do the work").pipe(Effect.provide(spawner.layer)),
      );
      expect(error._tag).toBe("RunFailed");
      expect(error.message).toBe("out of token credits");
    }),
  );
});
