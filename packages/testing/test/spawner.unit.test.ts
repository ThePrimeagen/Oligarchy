import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as TestingSpawner from "../src/spawner.ts";

const run = (command: string, args: ReadonlyArray<string> = []) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(ChildProcess.make(command, args));
    const stdout = yield* Stream.mkString(Stream.decodeText(handle.stdout));
    return { stdout, code: yield* handle.exitCode };
  }).pipe(Effect.scoped);

describe("fakeSpawner happy path", () => {
  it.effect("answers each command as scripted and records what was spawned", () =>
    Effect.gen(function* () {
      const fake = TestingSpawner.fakeSpawner(
        TestingSpawner.byCommand({ "/bin/ps": { exitCode: 0, stdout: "  1  0  4\n" } }),
      );
      const [listed, other] = yield* Effect.all([run("/bin/ps", ["-A"]), run("true")]).pipe(
        Effect.provide(fake.layer),
      );
      expect(listed).toEqual({ stdout: "  1  0  4\n", code: 0 });
      expect(other).toEqual({ stdout: "", code: 0 });
      expect(fake.spawned.map((spawned) => [spawned.command, spawned.args])).toEqual([
        ["/bin/ps", ["-A"]],
        ["true", []],
      ]);
    }),
  );

  it.effect("a process left running is killed with its command's signal when its scope ends", () =>
    Effect.gen(function* () {
      const fake = TestingSpawner.fakeSpawner(
        TestingSpawner.byCommand({ sleep: { ignoreTerm: true } }),
      );
      yield* Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        yield* spawner.spawn(
          ChildProcess.make("sleep", ["60"], { killSignal: "SIGTERM", forceKillAfter: "1 second" }),
        );
      }).pipe(Effect.scoped, Effect.forkChild, Effect.provide(fake.layer));
      const spawned = yield* fake.nextSpawn;
      yield* TestClock.adjust("1 second");
      expect(spawned.kills).toEqual(["SIGTERM", "SIGKILL"]);
      expect(yield* spawned.isRunning).toBe(false);
    }),
  );
});

describe("fakeSpawner unhappy path", () => {
  it.effect("a command scripted not to start fails the spawn with the platform's reason", () =>
    Effect.gen(function* () {
      const fake = TestingSpawner.fakeSpawner(
        TestingSpawner.byCommand({ qemu: { spawnError: "spawn qemu ENOENT" } }),
      );
      const error = yield* Effect.flip(run("qemu")).pipe(Effect.provide(fake.layer));
      expect(error).toMatchObject({ _tag: "PlatformError", reason: { _tag: "NotFound" } });
      expect(fake.spawned).toEqual([]);
    }),
  );
});
