import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as OpenCode from "../../src/automation-client/opencode.ts";
import * as Sessions from "../../src/automation-client/sessions.ts";
import * as Cli from "../../src/cli.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";

const TICKET = "OLI-42";
const OTHER = "OLI-99";

const layer = (spawner: FakeSpawner.FakeSpawner, maxJobs = 8) =>
  Sessions.Sessions.layer.pipe(
    Layer.provide(spawner.layer),
    Layer.provide(Layer.succeed(Sessions.MaxJobs)(maxJobs)),
  );

describe("Sessions.jobs happy path", () => {
  it.effect(
    "is 0 when nothing is running, 1 while a run is in flight, and 0 after it finishes",
    () => {
      const spawner = FakeSpawner.fakeSpawner(() => ({}));
      return Effect.gen(function* () {
        const sessions = yield* Sessions.Sessions;
        expect(yield* sessions.jobs).toBe(0);
        const running = yield* Effect.forkChild(sessions.run(TICKET, "do the work"));
        for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
          yield* Effect.yieldNow;
        }
        expect(yield* sessions.jobs).toBe(1);
        yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
        yield* Fiber.join(running);
        expect(yield* sessions.jobs).toBe(0);
      }).pipe(Effect.provide(layer(spawner)));
    },
  );
});

describe("Sessions.jobs unhappy path", () => {
  it.effect("is 0 after a run that fails", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({
      exitCode: 1,
      stderr: "out of token credits\n",
    }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* Effect.flip(sessions.run(TICKET, "do the work"));
      expect(yield* sessions.jobs).toBe(0);
    }).pipe(Effect.provide(layer(spawner)));
  });
});

describe("Sessions.run happy path", () => {
  it.effect("launches opencode with the prompt and succeeds when it exits 0", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({
      exitCode: 0,
      stdout: "the written result",
    }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.run(TICKET, "do the work");
      expect(spawner.spawned).toMatchObject([
        { command: OpenCode.BIN, args: ["run", "--", "do the work"] },
      ]);
    }).pipe(Effect.provide(layer(spawner)));
  });

  it.effect("runs as many tickets as max-jobs allows", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({}));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const first = yield* Effect.forkChild(sessions.run(TICKET, "first"));
      const second = yield* Effect.forkChild(sessions.run(OTHER, "second"));
      for (let i = 0; i < 100 && spawner.spawned.length < 2; i++) {
        yield* Effect.yieldNow;
      }
      expect(spawner.spawned).toHaveLength(2);
      expect(yield* sessions.jobs).toBe(2);
      yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
      yield* spawner.spawned[1]?.exit(0) ?? Effect.void;
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      expect(yield* sessions.jobs).toBe(0);
    }).pipe(Effect.provide(layer(spawner, 2)));
  });

  it.effect("a finished run frees the slot for the next ticket", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.run(TICKET, "first");
      yield* sessions.run(OTHER, "second");
      expect(spawner.spawned).toHaveLength(2);
    }).pipe(Effect.provide(layer(spawner, 1)));
  });
});

describe("Sessions.run unhappy path", () => {
  it.effect("forwards a spawn failure as RunFailed", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({
      spawnError: "spawn opencode ENOENT",
    }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const error = yield* Effect.flip(sessions.run(TICKET, "do the work"));
      expect(error._tag).toBe("RunFailed");
      expect(error.message).toBe("spawn opencode ENOENT");
    }).pipe(Effect.provide(layer(spawner)));
  });

  it.effect("forwards the command's error when it exits non-zero", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({
      exitCode: 1,
      stderr: "out of token credits\n",
    }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const error = yield* Effect.flip(sessions.run(TICKET, "do the work"));
      expect(error._tag).toBe("RunFailed");
      expect(error.message).toBe("out of token credits");
    }).pipe(Effect.provide(layer(spawner)));
  });

  it.effect("a run at capacity is AtCapacity and never spawns another opencode", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({}));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const running = yield* Effect.forkChild(sessions.run(TICKET, "first"));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      expect(spawner.spawned).toHaveLength(1);
      const error = yield* Effect.flip(sessions.run(OTHER, "second"));
      expect(error).toMatchObject({
        _tag: "AtCapacity",
        message: "at capacity; try later",
      });
      expect(spawner.spawned).toHaveLength(1);
      expect(yield* sessions.jobs).toBe(1);
      yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
      yield* Fiber.join(running);
    }).pipe(Effect.provide(layer(spawner, 1)));
  });

  it.effect("two concurrent runs at max-jobs 1: one AtCapacity and only one spawn", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({}));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const first = yield* Effect.forkChild(sessions.run(TICKET, "first"));
      const second = yield* Effect.forkChild(sessions.run(OTHER, "second"));
      for (let i = 0; i < 100 && spawner.spawned.length === 0; i++) {
        yield* Effect.yieldNow;
      }
      expect(spawner.spawned).toHaveLength(1);
      yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
      const exits = [yield* Fiber.await(first), yield* Fiber.await(second)];
      const tags = exits.map((exit) => {
        if (Exit.isSuccess(exit)) {
          return "ok";
        }
        const error = Cause.squash(exit.cause);
        return typeof error === "object" && error !== null && "_tag" in error
          ? String(error._tag)
          : "other";
      });
      expect(tags.sort()).toEqual(["AtCapacity", "ok"]);
      expect(yield* sessions.jobs).toBe(0);
    }).pipe(Effect.provide(layer(spawner, 1)));
  });

  it.effect("a spawn failure frees the reserved slot for the next ticket", () => {
    let attempts = 0;
    const spawner = FakeSpawner.fakeSpawner(() =>
      ++attempts === 1 ? { spawnError: "spawn opencode ENOENT" } : { exitCode: 0 },
    );
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      expect(yield* Effect.flip(sessions.run(TICKET, "first"))).toMatchObject({
        _tag: "RunFailed",
        message: "spawn opencode ENOENT",
      });
      expect(yield* sessions.jobs).toBe(0);
      yield* sessions.run(OTHER, "second");
      expect(yield* sessions.jobs).toBe(0);
    }).pipe(Effect.provide(layer(spawner, 1)));
  });
});

describe("Sessions.abort happy path", () => {
  it.effect("kills the CLI registered under that ticket", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({}));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const running = yield* Effect.forkChild(sessions.run(TICKET, "do the work"));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      expect(spawner.spawned[0]).toBeDefined();
      yield* sessions.abort(TICKET);
      expect(spawner.spawned[0]?.kills).toEqual(["SIGTERM"]);
      expect(spawner.spawned[0]?.killOptions).toEqual([
        { killSignal: "SIGTERM", forceKillAfter: Cli.FORCE_KILL_AFTER },
      ]);
      const error = yield* Effect.flip(Fiber.join(running));
      expect(error._tag).toBe("RunFailed");
      expect(error.message).toContain("SIGTERM");
    }).pipe(Effect.provide(layer(spawner)));
  });

  it.effect("kills only the matched ticket's CLI", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({}));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const first = yield* Effect.forkChild(sessions.run(TICKET, "first"));
      const second = yield* Effect.forkChild(sessions.run(OTHER, "second"));
      for (let i = 0; i < 100 && spawner.spawned.length < 2; i++) {
        yield* Effect.yieldNow;
      }
      expect(spawner.spawned).toHaveLength(2);
      yield* sessions.abort(TICKET);
      expect(spawner.spawned[0]?.kills).toEqual(["SIGTERM"]);
      expect(spawner.spawned[1]?.kills).toEqual([]);
      expect(yield* spawner.spawned[1]?.isRunning ?? Effect.succeed(false)).toBe(true);
      yield* Effect.flip(Fiber.join(first));
      yield* spawner.spawned[1]?.exit(0) ?? Effect.void;
      yield* Fiber.join(second);
    }).pipe(Effect.provide(layer(spawner)));
  });

  it.effect("escalates to SIGKILL when the CLI ignores SIGTERM", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ ignoreTerm: true }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const running = yield* Effect.forkChild(sessions.run(TICKET, "do the work"));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      const aborting = yield* Effect.forkChild(sessions.abort(TICKET));
      for (let i = 0; i < 100 && (spawner.spawned[0]?.kills.length ?? 0) === 0; i++) {
        yield* Effect.yieldNow;
      }
      expect(spawner.spawned[0]?.kills).toEqual(["SIGTERM"]);
      expect(aborting.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust(Cli.FORCE_KILL_AFTER);
      yield* Fiber.join(aborting);
      expect(spawner.spawned[0]?.kills).toEqual(["SIGTERM", "SIGKILL"]);
      const error = yield* Effect.flip(Fiber.join(running));
      expect(error._tag).toBe("RunFailed");
    }).pipe(Effect.provide(layer(spawner)));
  });

  it.effect("succeeds when kill fails because the child has already exited", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({
      killError: "Failed to kill child process",
      alreadyDeadOnKill: true,
    }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const running = yield* Effect.forkChild(sessions.run(TICKET, "do the work"));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      yield* sessions.abort(TICKET);
      const error = yield* Effect.flip(Fiber.join(running));
      expect(error._tag).toBe("RunFailed");
    }).pipe(Effect.provide(layer(spawner)));
  });
});

describe("Sessions.abort unhappy path", () => {
  it.effect("an unknown ticket is UnknownSession", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const error = yield* Effect.flip(sessions.abort(TICKET));
      expect(error).toMatchObject({
        _tag: "UnknownSession",
        id: TICKET,
        message: `unknown session "${TICKET}"`,
      });
    }).pipe(Effect.provide(layer(spawner)));
  });

  it.effect("a finished run is no longer abortable", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.run(TICKET, "do the work");
      const error = yield* Effect.flip(sessions.abort(TICKET));
      expect(error).toMatchObject({
        _tag: "UnknownSession",
        message: `unknown session "${TICKET}"`,
      });
    }).pipe(Effect.provide(layer(spawner)));
  });

  it.effect("a kill that fails while the child still runs is RunFailed and stays abortable", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({
      killError: "Failed to kill child process",
    }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const running = yield* Effect.forkChild(sessions.run(TICKET, "do the work"));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      const error = yield* Effect.flip(sessions.abort(TICKET));
      expect(error).toMatchObject({
        _tag: "RunFailed",
        message: "Unknown: ChildProcess.kill: Failed to kill child process",
      });
      expect(yield* spawner.spawned[0]?.isRunning ?? Effect.succeed(false)).toBe(true);
      const again = yield* Effect.flip(sessions.abort(TICKET));
      expect(again._tag).toBe("RunFailed");
      yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
      yield* Fiber.join(running);
    }).pipe(Effect.provide(layer(spawner)));
  });

  it.effect("a second run of the same ticket is a defect and leaves the first abortable", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({}));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const first = yield* Effect.forkChild(sessions.run(TICKET, "first"));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      const second = yield* Effect.forkChild(sessions.run(TICKET, "second"));
      for (let i = 0; i < 100 && spawner.spawned.length < 2; i++) {
        yield* Effect.yieldNow;
      }
      const exit = yield* Fiber.await(second);
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      yield* sessions.abort(TICKET);
      expect(spawner.spawned[0]?.kills).toEqual(["SIGTERM"]);
      yield* Effect.flip(Fiber.join(first));
    }).pipe(Effect.provide(layer(spawner)));
  });
});
