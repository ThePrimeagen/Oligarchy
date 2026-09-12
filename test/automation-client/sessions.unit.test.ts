import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as OpenCode from "../../src/automation-client/opencode.ts";
import * as Sessions from "../../src/automation-client/sessions.ts";
import * as Cli from "../../src/cli.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";

const TICKET = "OLI-42";
const OTHER = "OLI-99";
// Room for the two runs the tests above capacity start at once; the capacity tests pass 1.
const MAX_JOBS = 2;

const qemuOk = (): Sessions.ReserveQemu => () => Effect.void;

const layer = (
  spawner: FakeSpawner.FakeSpawner,
  maxJobs = MAX_JOBS,
  reserveQemu: Sessions.ReserveQemu = qemuOk(),
) => Sessions.Sessions.layer(maxJobs, reserveQemu).pipe(Layer.provide(spawner.layer));

const reservedRun = (ticket: string, prompt: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions.Sessions;
    yield* sessions.reserve(ticket);
    return yield* sessions.run(ticket, prompt);
  });

describe("Sessions.run happy path", () => {
  it.effect("launches opencode with the prompt and succeeds when it exits 0", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({
      exitCode: 0,
      stdout: "the written result",
    }));
    return Effect.gen(function* () {
      yield* reservedRun(TICKET, "do the work");
      expect(spawner.spawned).toMatchObject([
        { command: OpenCode.BIN, args: ["run", "--", "do the work"] },
      ]);
    }).pipe(Effect.provide(layer(spawner)));
  });
});

describe("Sessions.run unhappy path", () => {
  it.effect("forwards a spawn failure as RunFailed", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({
      spawnError: "spawn opencode ENOENT",
    }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET);
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
      yield* sessions.reserve(TICKET);
      const error = yield* Effect.flip(sessions.run(TICKET, "do the work"));
      expect(error._tag).toBe("RunFailed");
      expect(error.message).toBe("out of token credits");
    }).pipe(Effect.provide(layer(spawner)));
  });
});

describe("Sessions.abort happy path", () => {
  it.effect("kills the CLI registered under that ticket", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({}));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET);
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
      yield* sessions.reserve(TICKET);
      yield* sessions.reserve(OTHER);
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
      yield* sessions.reserve(TICKET);
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
      yield* sessions.reserve(TICKET);
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
      yield* reservedRun(TICKET, "do the work");
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
      yield* sessions.reserve(TICKET);
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
      yield* sessions.reserve(TICKET);
      const first = yield* Effect.forkChild(sessions.run(TICKET, "first"));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      yield* sessions.reserve(TICKET);
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

describe("capacity", () => {
  it.effect("a reserve past --max-jobs is AtCapacity and spawns nothing", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET);
      const error = yield* Effect.flip(sessions.reserve(OTHER));
      expect(error).toMatchObject({
        _tag: "AtCapacity",
        message: "at capacity: max-jobs is 1",
        agentId: OTHER,
      });
      expect(spawner.spawned).toHaveLength(0);
    }).pipe(Effect.provide(layer(spawner, 1)));
  });

  it.effect("a second reserve for the same ticket is the same slot", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET);
      yield* sessions.reserve(TICKET);
      expect((yield* Effect.flip(sessions.reserve(OTHER)))._tag).toBe("AtCapacity");
    }).pipe(Effect.provide(layer(spawner, 1)));
  });

  it.effect("run after reserve does not take a second slot", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({}));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET);
      const running = yield* Effect.forkChild(sessions.run(TICKET, "first"));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      expect(spawner.spawned).toHaveLength(1);
      expect((yield* Effect.flip(sessions.reserve(OTHER)))._tag).toBe("AtCapacity");
      expect((yield* Effect.flip(sessions.run(OTHER, "second")))._tag).toBe("BadRequest");
      yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
      yield* Fiber.join(running);
    }).pipe(Effect.provide(layer(spawner, 1)));
  });

  it.effect("a run without a reservation is BadRequest and spawns nothing", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const error = yield* Effect.flip(sessions.run(TICKET, "first"));
      expect(error).toMatchObject({
        _tag: "BadRequest",
        message: "no reservation",
        agentId: TICKET,
      });
      expect(spawner.spawned).toHaveLength(0);
      expect((yield* Effect.flip(sessions.abort(TICKET)))._tag).toBe("UnknownSession");
    }).pipe(Effect.provide(layer(spawner, 1)));
  });

  it.effect("a run that exited, zero or not, frees its slot", () => {
    const exits = [0, 1];
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: exits.shift() ?? 0 }));
    return Effect.gen(function* () {
      yield* reservedRun(TICKET, "first");
      expect((yield* Effect.flip(reservedRun(OTHER, "second")))._tag).toBe("RunFailed");
      yield* reservedRun("OLI-7", "third");
      expect(spawner.spawned.map((spawned) => spawned.args[2])).toEqual([
        "first",
        "second",
        "third",
      ]);
    }).pipe(Effect.provide(layer(spawner, 1)));
  });

  it.effect("an aborted run frees its slot", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({}));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET);
      const running = yield* Effect.forkChild(sessions.run(TICKET, "first"));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      expect((yield* Effect.flip(sessions.reserve(OTHER)))._tag).toBe("AtCapacity");
      yield* sessions.abort(TICKET);
      expect((yield* Effect.flip(Fiber.join(running)))._tag).toBe("RunFailed");
      yield* sessions.reserve(OTHER);
      const next = yield* Effect.forkChild(sessions.run(OTHER, "second"));
      for (let i = 0; i < 100 && spawner.spawned.length < 2; i++) {
        yield* Effect.yieldNow;
      }
      expect(spawner.spawned).toHaveLength(2);
      yield* spawner.spawned[1]?.exit(0) ?? Effect.void;
      yield* Fiber.join(next);
    }).pipe(Effect.provide(layer(spawner, 1)));
  });

  it.effect("an interrupted run frees its slot once its child is gone", () => {
    // The first child runs until killed; the one admitted afterwards exits at once.
    let spawns = 0;
    const spawner = FakeSpawner.fakeSpawner(() => (++spawns === 1 ? {} : { exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET);
      const running = yield* Effect.forkChild(sessions.run(TICKET, "first"));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      expect((yield* Effect.flip(sessions.reserve(OTHER)))._tag).toBe("AtCapacity");
      yield* Fiber.interrupt(running);
      const exit = yield* Fiber.await(running);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      // Leaving the scope killed the child before the slot came back.
      expect(spawner.spawned[0]?.kills).toEqual(["SIGTERM"]);
      expect(yield* spawner.spawned[0]?.isRunning ?? Effect.succeed(true)).toBe(false);
      yield* reservedRun(OTHER, "second");
      expect(spawner.spawned.map((spawned) => spawned.args[2])).toEqual(["first", "second"]);
    }).pipe(Effect.provide(layer(spawner, 1)));
  });

  it.effect("a run whose spawn failed frees its slot", () => {
    let spawns = 0;
    const spawner = FakeSpawner.fakeSpawner(() =>
      ++spawns === 1 ? { spawnError: "spawn opencode ENOENT" } : { exitCode: 0 },
    );
    return Effect.gen(function* () {
      const error = yield* Effect.flip(reservedRun(TICKET, "first"));
      expect(error).toMatchObject({ _tag: "RunFailed", message: "spawn opencode ENOENT" });
      yield* reservedRun(OTHER, "second");
      // A spawn that failed is no process; only the second run's is recorded.
      expect(spawner.spawned.map((spawned) => spawned.args[2])).toEqual(["second"]);
    }).pipe(Effect.provide(layer(spawner, 1)));
  });
});

describe("QEMU-first reserve", () => {
  it.effect("asks QEMU before taking a local slot", () => {
    const order: Array<string> = [];
    const reserveQemu: Sessions.ReserveQemu = (agent) =>
      Effect.sync(() => {
        order.push(`qemu ${agent}`);
      });
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET);
      order.push("returned");
      expect(order).toEqual([`qemu ${TICKET}`, "returned"]);
    }).pipe(Effect.provide(layer(spawner, 1, reserveQemu)));
  });

  it.effect("a QEMU 503 takes no local slot and is AtCapacity", () => {
    const qemu: Array<string> = [];
    const reserveQemu: Sessions.ReserveQemu = (agent) =>
      Effect.gen(function* () {
        qemu.push(agent);
        return yield* Errors.AtCapacity.make({ message: "qemu full", agentId: agent });
      });
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const error = yield* Effect.flip(sessions.reserve(TICKET));
      expect(error).toMatchObject({
        _tag: "AtCapacity",
        message: "qemu full",
        agentId: TICKET,
      });
      expect(qemu).toEqual([TICKET]);
      expect((yield* Effect.flip(sessions.run(TICKET, "first")))._tag).toBe("BadRequest");
      expect(spawner.spawned).toHaveLength(0);
    }).pipe(Effect.provide(layer(spawner, 1, reserveQemu)));
  });

  it.effect("a full client does not ask QEMU", () => {
    let qemu = 0;
    const reserveQemu: Sessions.ReserveQemu = () =>
      Effect.sync(() => {
        qemu += 1;
      });
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET);
      expect((yield* Effect.flip(sessions.reserve(OTHER)))._tag).toBe("AtCapacity");
      expect(qemu).toBe(1);
    }).pipe(Effect.provide(layer(spawner, 1, reserveQemu)));
  });

  it.effect("a second reserve for the same ticket does not ask QEMU again", () => {
    let qemu = 0;
    const reserveQemu: Sessions.ReserveQemu = () =>
      Effect.sync(() => {
        qemu += 1;
      });
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET);
      yield* sessions.reserve(TICKET);
      expect(qemu).toBe(1);
    }).pipe(Effect.provide(layer(spawner, 1, reserveQemu)));
  });
});
