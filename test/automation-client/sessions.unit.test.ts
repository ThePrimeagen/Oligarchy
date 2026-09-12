import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as OpenCode from "../../src/automation-client/opencode.ts";
import * as Sessions from "../../src/automation-client/sessions.ts";
import * as Cli from "../../src/cli.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeLog from "../support/log.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";

const TICKET = "OLI-42";
const OTHER = "OLI-99";
const MODEL = "opencode/muse-spark-1.3-contributor-free";
// Room for the two runs the tests above capacity start at once; the capacity tests pass 1.
const MAX_JOBS = 2;
// How long a run waits for stderr to end after opencode exited; then the tail so far is the tail.
const STDERR_GRACE = "2 seconds";

const qemuOk = (): Sessions.ReserveQemu => () => Effect.void;

const qemuRelinquishOk = (): Sessions.RelinquishQemu => () => Effect.void;

const layer = (
  spawner: FakeSpawner.FakeSpawner,
  maxJobs = MAX_JOBS,
  reserveQemu: Sessions.ReserveQemu = qemuOk(),
  relinquishQemu: Sessions.RelinquishQemu = qemuRelinquishOk(),
  log: FakeLog.FakeLog = FakeLog.fakeLog(),
) =>
  Sessions.Sessions.layer(maxJobs, reserveQemu, relinquishQemu).pipe(
    Layer.provide(Layer.mergeAll(spawner.layer, log.layer)),
  );

// A reservation nobody runs is gone after this long; the sweep that notices runs every ten
// seconds from the start, so advancing by exactly this much lands on a sweep.
const RESERVATION_TIMEOUT = "10 minutes";

const reservedRun = (ticket: string, prompt: string, model = MODEL) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions.Sessions;
    yield* sessions.reserve(ticket, "drive");
    return yield* sessions.run(ticket, prompt, model);
  });

describe("Sessions.run happy path", () => {
  it.effect(
    "launches opencode run --auto with the model and the prompt and succeeds when it exits 0",
    () => {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        exitCode: 0,
        stdout: "the written result",
      }));
      return Effect.gen(function* () {
        yield* reservedRun(TICKET, "do the work");
        expect(spawner.spawned).toMatchObject([
          { command: OpenCode.BIN, args: ["run", "--auto", "--model", MODEL, "--", "do the work"] },
        ]);
      }).pipe(Effect.provide(layer(spawner)));
    },
  );

  // --auto answers only the root session's asks; a subagent the driver spawns asks into the void
  // (anomalyco/opencode#36868). The two permissions that default to ask are allowed outright.
  it.effect(
    "hands opencode a config that allows the ask-class permissions for every session",
    () => {
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
      return Effect.gen(function* () {
        yield* reservedRun(TICKET, "do the work");
        const content = spawner.spawned[0]?.options.env?.OPENCODE_CONFIG_CONTENT;
        expect(content).toBeDefined();
        expect(JSON.parse(content ?? "")).toEqual({
          permission: { external_directory: "allow", doom_loop: "allow" },
          // A model stream that goes silent aborts instead of holding the run to its ceiling.
          provider: { openrouter: { options: { headerTimeout: 180_000, chunkTimeout: 180_000 } } },
        });
        expect(spawner.spawned[0]?.options.extendEnv).toBe(true);
      }).pipe(Effect.provide(layer(spawner)));
    },
  );

  it.effect("passes a dashed prompt after -- so opencode does not treat it as a flag", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      yield* reservedRun(TICKET, "--help");
      expect(spawner.spawned).toMatchObject([
        { command: OpenCode.BIN, args: ["run", "--auto", "--model", MODEL, "--", "--help"] },
      ]);
    }).pipe(Effect.provide(layer(spawner)));
  });

  it.effect("the model given is the model passed, whichever provider it names", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    const deepseek = "openrouter/deepseek/deepseek-v4.1-flash";
    return Effect.gen(function* () {
      yield* reservedRun(TICKET, "do the work", deepseek);
      expect(spawner.spawned[0]?.args).toEqual([
        "run",
        "--auto",
        "--model",
        deepseek,
        "--",
        "do the work",
      ]);
    }).pipe(Effect.provide(layer(spawner)));
  });
});

describe("Sessions.run ceiling", () => {
  it.effect(
    "a run that outlives the ceiling is killed, fails as RunFailed naming it, and frees its slot",
    () => {
      const spawner = FakeSpawner.fakeSpawner(() => ({}));
      return Effect.gen(function* () {
        const sessions = yield* Sessions.Sessions;
        yield* sessions.reserve(TICKET, "drive");
        const running = yield* Effect.forkChild(
          Effect.flip(sessions.run(TICKET, "do the work", MODEL)),
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
        expect((yield* Effect.flip(sessions.abort(TICKET)))._tag).toBe("UnknownSession");
        yield* sessions.reserve(OTHER, "drive");
      }).pipe(Effect.provide(layer(spawner, 1)));
    },
  );

  it.effect("a run that exits a second before the ceiling succeeds", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({}));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET, "drive");
      const running = yield* Effect.forkChild(sessions.run(TICKET, "do the work", MODEL));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      yield* TestClock.adjust("1799 seconds");
      yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
      yield* Fiber.join(running);
      expect(spawner.spawned[0]?.kills).toEqual([]);
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
      yield* sessions.reserve(TICKET, "drive");
      const error = yield* Effect.flip(sessions.run(TICKET, "do the work", MODEL));
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
      yield* sessions.reserve(TICKET, "drive");
      const error = yield* Effect.flip(sessions.run(TICKET, "do the work", MODEL));
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
      yield* sessions.reserve(TICKET, "drive");
      const running = yield* Effect.forkChild(sessions.run(TICKET, "do the work", MODEL));
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
      yield* sessions.reserve(TICKET, "drive");
      yield* sessions.reserve(OTHER, "drive");
      const first = yield* Effect.forkChild(sessions.run(TICKET, "first", MODEL));
      const second = yield* Effect.forkChild(sessions.run(OTHER, "second", MODEL));
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
      yield* sessions.reserve(TICKET, "drive");
      const running = yield* Effect.forkChild(sessions.run(TICKET, "do the work", MODEL));
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
      yield* sessions.reserve(TICKET, "drive");
      const running = yield* Effect.forkChild(sessions.run(TICKET, "do the work", MODEL));
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
      yield* sessions.reserve(TICKET, "drive");
      const running = yield* Effect.forkChild(sessions.run(TICKET, "do the work", MODEL));
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
      yield* sessions.reserve(TICKET, "drive");
      const first = yield* Effect.forkChild(sessions.run(TICKET, "first", MODEL));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      yield* sessions.reserve(TICKET, "drive");
      const second = yield* Effect.forkChild(sessions.run(TICKET, "second", MODEL));
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
      yield* sessions.reserve(TICKET, "drive");
      const error = yield* Effect.flip(sessions.reserve(OTHER, "drive"));
      expect(error).toMatchObject({
        _tag: "AtCapacity",
        message: "at capacity: max-jobs is 1",
        agentId: OTHER,
      });
      expect(spawner.spawned).toHaveLength(0);
    }).pipe(Effect.provide(layer(spawner, 1)));
  });

  it.effect("a second reserve for the same ticket is already reserved", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET, "drive");
      const error = yield* Effect.flip(sessions.reserve(TICKET, "drive"));
      expect(error).toMatchObject({
        _tag: "BadRequest",
        message: "already reserved",
        agentId: TICKET,
      });
      expect((yield* Effect.flip(sessions.reserve(OTHER, "drive")))._tag).toBe("AtCapacity");
    }).pipe(Effect.provide(layer(spawner, 1)));
  });

  it.effect("run after reserve does not take a second slot", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({}));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET, "drive");
      const running = yield* Effect.forkChild(sessions.run(TICKET, "first", MODEL));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      expect(spawner.spawned).toHaveLength(1);
      expect((yield* Effect.flip(sessions.reserve(OTHER, "drive")))._tag).toBe("AtCapacity");
      expect((yield* Effect.flip(sessions.run(OTHER, "second", MODEL)))._tag).toBe("BadRequest");
      yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
      yield* Fiber.join(running);
    }).pipe(Effect.provide(layer(spawner, 1)));
  });

  it.effect("a run without a reservation is BadRequest and spawns nothing", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const error = yield* Effect.flip(sessions.run(TICKET, "first", MODEL));
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
      expect(spawner.spawned.map((spawned) => spawned.args[5])).toEqual([
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
      yield* sessions.reserve(TICKET, "drive");
      const running = yield* Effect.forkChild(sessions.run(TICKET, "first", MODEL));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      expect((yield* Effect.flip(sessions.reserve(OTHER, "drive")))._tag).toBe("AtCapacity");
      yield* sessions.abort(TICKET);
      expect((yield* Effect.flip(Fiber.join(running)))._tag).toBe("RunFailed");
      yield* sessions.reserve(OTHER, "drive");
      const next = yield* Effect.forkChild(sessions.run(OTHER, "second", MODEL));
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
      yield* sessions.reserve(TICKET, "drive");
      const running = yield* Effect.forkChild(sessions.run(TICKET, "first", MODEL));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      expect((yield* Effect.flip(sessions.reserve(OTHER, "drive")))._tag).toBe("AtCapacity");
      yield* Fiber.interrupt(running);
      const exit = yield* Fiber.await(running);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      // Leaving the scope killed the child before the slot came back.
      expect(spawner.spawned[0]?.kills).toEqual(["SIGTERM"]);
      expect(yield* spawner.spawned[0]?.isRunning ?? Effect.succeed(true)).toBe(false);
      yield* reservedRun(OTHER, "second");
      expect(spawner.spawned.map((spawned) => spawned.args[5])).toEqual(["first", "second"]);
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
      expect(spawner.spawned.map((spawned) => spawned.args[5])).toEqual(["second"]);
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
      yield* sessions.reserve(TICKET, "drive");
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
      const error = yield* Effect.flip(sessions.reserve(TICKET, "drive"));
      expect(error).toMatchObject({
        _tag: "AtCapacity",
        message: "qemu full",
        agentId: TICKET,
      });
      expect(qemu).toEqual([TICKET]);
      expect((yield* Effect.flip(sessions.run(TICKET, "first", MODEL)))._tag).toBe("BadRequest");
      expect(spawner.spawned).toHaveLength(0);
    }).pipe(Effect.provide(layer(spawner, 1, reserveQemu)));
  });

  it.effect("a QEMU reservation the client cannot take is relinquished and is AtCapacity", () => {
    const qemu: Array<string> = [];
    const givenBack: Array<string> = [];
    const reserveQemu: Sessions.ReserveQemu = (agent) =>
      Effect.sync(() => {
        qemu.push(`reserve ${agent}`);
      });
    const relinquishQemu: Sessions.RelinquishQemu = (agent) =>
      Effect.sync(() => {
        givenBack.push(agent);
      });
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET, "drive");
      const error = yield* Effect.flip(sessions.reserve(OTHER, "drive"));
      expect(error).toMatchObject({
        _tag: "AtCapacity",
        message: "at capacity: max-jobs is 1",
        agentId: OTHER,
      });
      expect(qemu).toEqual([`reserve ${TICKET}`, `reserve ${OTHER}`]);
      expect(givenBack).toEqual([OTHER]);
      expect((yield* Effect.flip(sessions.run(OTHER, "second", MODEL)))._tag).toBe("BadRequest");
      expect(spawner.spawned).toHaveLength(0);
      // The first ticket still holds the only slot.
      expect((yield* Effect.flip(sessions.reserve("OLI-7", "drive")))._tag).toBe("AtCapacity");
      expect(givenBack).toEqual([OTHER, "OLI-7"]);
    }).pipe(Effect.provide(layer(spawner, 1, reserveQemu, relinquishQemu)));
  });

  it.effect("a successful reserve does not relinquish", () => {
    let givenBack = 0;
    const relinquishQemu: Sessions.RelinquishQemu = () =>
      Effect.sync(() => {
        givenBack += 1;
      });
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET, "drive");
      expect(givenBack).toBe(0);
    }).pipe(Effect.provide(layer(spawner, 1, qemuOk(), relinquishQemu)));
  });

  it.effect("a relinquish that fails after a full local reserve is Internal", () => {
    const givenBack: Array<string> = [];
    const relinquishQemu: Sessions.RelinquishQemu = (agent) =>
      Effect.gen(function* () {
        givenBack.push(agent);
        return yield* Errors.Internal.make({
          cause: new Error("qemu unreachable"),
          agentId: agent,
        });
      });
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET, "drive");
      const error = yield* Effect.flip(sessions.reserve(OTHER, "drive"));
      expect(error).toMatchObject({
        _tag: "Internal",
        message: "internal error",
        agentId: OTHER,
      });
      expect(givenBack).toEqual([OTHER]);
      expect((yield* Effect.flip(sessions.run(OTHER, "second", MODEL)))._tag).toBe("BadRequest");
      expect(spawner.spawned).toHaveLength(0);
    }).pipe(Effect.provide(layer(spawner, 1, qemuOk(), relinquishQemu)));
  });

  it.effect("a QEMU failure that is not 503 takes no local slot and is Internal", () => {
    const qemu: Array<string> = [];
    const reserveQemu: Sessions.ReserveQemu = (agent) =>
      Effect.gen(function* () {
        qemu.push(agent);
        return yield* Errors.Internal.make({
          cause: new Error("qemu unreachable"),
          agentId: agent,
        });
      });
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      const error = yield* Effect.flip(sessions.reserve(TICKET, "drive"));
      expect(error).toMatchObject({
        _tag: "Internal",
        message: "internal error",
        agentId: TICKET,
      });
      expect(qemu).toEqual([TICKET]);
      expect((yield* Effect.flip(sessions.run(TICKET, "first", MODEL)))._tag).toBe("BadRequest");
      expect(spawner.spawned).toHaveLength(0);
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
      yield* sessions.reserve(TICKET, "drive");
      expect((yield* Effect.flip(sessions.reserve(TICKET, "drive")))._tag).toBe("BadRequest");
      expect(qemu).toBe(1);
    }).pipe(Effect.provide(layer(spawner, 1, reserveQemu)));
  });
});

// A diagnose reads the database and boots nothing: it takes a slot on this client only. A
// drive takes QEMU first, as above.
describe("reserve by action", () => {
  it.effect("a diagnose reserve takes a slot without asking QEMU, and its run spawns", () => {
    const qemu: Array<string> = [];
    const reserveQemu: Sessions.ReserveQemu = (agent) =>
      Effect.sync(() => {
        qemu.push(agent);
      });
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET, "diagnose");
      expect(qemu).toEqual([]);
      expect(yield* sessions.jobs).toBe(1);
      yield* sessions.run(TICKET, "diagnose the session", MODEL);
      expect(spawner.spawned.map((spawned) => spawned.args[5])).toEqual(["diagnose the session"]);
      expect(yield* sessions.jobs).toBe(0);
    }).pipe(Effect.provide(layer(spawner, 1, reserveQemu)));
  });

  it.effect(
    "a diagnose reserve past --max-jobs is AtCapacity and neither asks nor relinquishes QEMU",
    () => {
      const qemu: Array<string> = [];
      const givenBack: Array<string> = [];
      const reserveQemu: Sessions.ReserveQemu = (agent) =>
        Effect.sync(() => {
          qemu.push(agent);
        });
      const relinquishQemu: Sessions.RelinquishQemu = (agent) =>
        Effect.sync(() => {
          givenBack.push(agent);
        });
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
      return Effect.gen(function* () {
        const sessions = yield* Sessions.Sessions;
        yield* sessions.reserve(TICKET, "drive");
        const error = yield* Effect.flip(sessions.reserve(OTHER, "diagnose"));
        expect(error).toMatchObject({
          _tag: "AtCapacity",
          message: "at capacity: max-jobs is 1",
          agentId: OTHER,
        });
        // The drive asked once; the diagnose never did, so there was nothing to give back.
        expect(qemu).toEqual([TICKET]);
        expect(givenBack).toEqual([]);
        expect((yield* Effect.flip(sessions.run(OTHER, "second", MODEL)))._tag).toBe("BadRequest");
        expect(spawner.spawned).toHaveLength(0);
      }).pipe(Effect.provide(layer(spawner, 1, reserveQemu, relinquishQemu)));
    },
  );

  it.effect(
    "a second reserve of the same ticket under the other action is already reserved",
    () => {
      const qemu: Array<string> = [];
      const reserveQemu: Sessions.ReserveQemu = (agent) =>
        Effect.sync(() => {
          qemu.push(agent);
        });
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
      return Effect.gen(function* () {
        const sessions = yield* Sessions.Sessions;
        yield* sessions.reserve(TICKET, "diagnose");
        const error = yield* Effect.flip(sessions.reserve(TICKET, "drive"));
        expect(error).toMatchObject({
          _tag: "BadRequest",
          message: "already reserved",
          agentId: TICKET,
        });
        // Refused before QEMU was asked: a held ticket costs the guest host nothing.
        expect(qemu).toEqual([]);
        expect(yield* sessions.jobs).toBe(1);
      }).pipe(Effect.provide(layer(spawner, 2, reserveQemu)));
    },
  );
});

// The stderr pipe is shared with every process opencode starts (an MCP server, a tool the agent
// ran); one that outlives opencode keeps the pipe open. The exit is the end of the run.
describe("Sessions.run when a process opencode started still holds stderr", () => {
  it.effect(
    "a run whose opencode exited 0 succeeds after the grace, not at the ceiling, and frees its slot",
    () => {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        exitCode: 0,
        stderr: "noise\n",
        stderrStaysOpen: true,
      }));
      return Effect.gen(function* () {
        const sessions = yield* Sessions.Sessions;
        yield* sessions.reserve(TICKET, "drive");
        const running = yield* Effect.forkChild(sessions.run(TICKET, "do the work", MODEL));
        for (let i = 0; i < 100; i++) {
          yield* Effect.yieldNow;
        }
        expect(spawner.spawned[0]).toBeDefined();
        expect(running.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust(STDERR_GRACE);
        yield* Fiber.join(running);
        expect(spawner.spawned[0]?.kills).toEqual([]);
        expect(yield* sessions.jobs).toBe(0);
        yield* sessions.reserve(OTHER, "drive");
      }).pipe(Effect.provide(layer(spawner, 1)));
    },
  );

  it.effect(
    "a run whose opencode exited 1 is RunFailed with what it wrote, after the grace",
    () => {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        exitCode: 1,
        stderr: "out of token credits\n",
        stderrStaysOpen: true,
      }));
      return Effect.gen(function* () {
        const sessions = yield* Sessions.Sessions;
        yield* sessions.reserve(TICKET, "drive");
        const running = yield* Effect.forkChild(
          Effect.flip(sessions.run(TICKET, "do the work", MODEL)),
        );
        for (let i = 0; i < 100; i++) {
          yield* Effect.yieldNow;
        }
        expect(running.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust(STDERR_GRACE);
        const error = yield* Fiber.join(running);
        expect(error).toMatchObject({ _tag: "RunFailed", message: "out of token credits" });
        expect(yield* sessions.jobs).toBe(0);
      }).pipe(Effect.provide(layer(spawner, 1)));
    },
  );
});

// A reservation is a promise that a run follows at once; one nobody runs (the dispatcher died
// between /reserve and /run) is given back after ten minutes, in memory only, so the slot and
// any guest slot taken for it are free again and a restarted dispatcher can place the job anew.
describe("reservation expiry", () => {
  it.effect(
    "a drive reservation unused for ten minutes expires: its slot is free, jobs drops, the guest slot is relinquished, one warning line",
    () => {
      const givenBack: Array<string> = [];
      const relinquishQemu: Sessions.RelinquishQemu = (agent) =>
        Effect.sync(() => {
          givenBack.push(agent);
        });
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
      const log = FakeLog.fakeLog();
      return Effect.gen(function* () {
        const sessions = yield* Sessions.Sessions;
        yield* sessions.reserve(TICKET, "drive");
        expect(yield* sessions.jobs).toBe(1);
        yield* TestClock.adjust(RESERVATION_TIMEOUT);
        expect(yield* sessions.jobs).toBe(0);
        expect(givenBack).toEqual([TICKET]);
        // Gone from the reserved set: a late run is refused, the slot goes to the next ticket.
        expect(yield* Effect.flip(sessions.run(TICKET, "late", MODEL))).toMatchObject({
          _tag: "BadRequest",
          message: "no reservation",
        });
        yield* sessions.reserve(OTHER, "drive");
        expect(spawner.spawned).toEqual([]);
        expect(log.lines).toEqual([
          {
            level: "warning",
            text: "reservation expired; unused for 10 minutes",
            location: "automation-client",
            agentId: TICKET,
            skipSentry: false,
            cause: undefined,
          },
        ]);
      }).pipe(Effect.provide(layer(spawner, 1, qemuOk(), relinquishQemu, log)));
    },
  );

  it.effect("a diagnose reservation unused for ten minutes expires without asking QEMU", () => {
    const qemu: Array<string> = [];
    const reserveQemu: Sessions.ReserveQemu = (agent) =>
      Effect.sync(() => {
        qemu.push(`reserve ${agent}`);
      });
    const relinquishQemu: Sessions.RelinquishQemu = (agent) =>
      Effect.sync(() => {
        qemu.push(`relinquish ${agent}`);
      });
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    const log = FakeLog.fakeLog();
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET, "diagnose");
      yield* TestClock.adjust(RESERVATION_TIMEOUT);
      expect(yield* sessions.jobs).toBe(0);
      expect(qemu).toEqual([]);
      expect(FakeLog.texts(log)).toEqual(["reservation expired; unused for 10 minutes"]);
    }).pipe(Effect.provide(layer(spawner, 1, reserveQemu, relinquishQemu, log)));
  });

  it.effect("a reservation consumed by a run in time never expires", () => {
    const givenBack: Array<string> = [];
    const relinquishQemu: Sessions.RelinquishQemu = (agent) =>
      Effect.sync(() => {
        givenBack.push(agent);
      });
    const spawner = FakeSpawner.fakeSpawner(() => ({}));
    const log = FakeLog.fakeLog();
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET, "drive");
      const running = yield* Effect.forkChild(sessions.run(TICKET, "do the work", MODEL));
      for (let i = 0; i < 100 && spawner.spawned[0] === undefined; i++) {
        yield* Effect.yieldNow;
      }
      // Ten minutes into the run: the slot is the run's now, not a reservation's.
      yield* TestClock.adjust(RESERVATION_TIMEOUT);
      expect(yield* sessions.jobs).toBe(1);
      expect(givenBack).toEqual([]);
      expect(log.lines).toEqual([]);
      expect((yield* Effect.flip(sessions.reserve(OTHER, "drive")))._tag).toBe("AtCapacity");
      yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
      yield* Fiber.join(running);
      expect(yield* sessions.jobs).toBe(0);
    }).pipe(Effect.provide(layer(spawner, 1, qemuOk(), relinquishQemu, log)));
  });

  it.effect(
    "a relinquish that fails at expiry is one error line and the slot is freed all the same",
    () => {
      const relinquishQemu: Sessions.RelinquishQemu = (agent) =>
        Errors.Internal.make({ cause: new Error("proxy unreachable"), agentId: agent });
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
      const log = FakeLog.fakeLog();
      return Effect.gen(function* () {
        const sessions = yield* Sessions.Sessions;
        yield* sessions.reserve(TICKET, "drive");
        yield* TestClock.adjust(RESERVATION_TIMEOUT);
        expect(yield* sessions.jobs).toBe(0);
        yield* sessions.reserve(OTHER, "drive");
        expect(log.lines.map((line) => [line.level, line.text, line.agentId])).toEqual([
          ["warning", "reservation expired; unused for 10 minutes", TICKET],
          ["error", "relinquish failed: internal error: proxy unreachable", TICKET],
        ]);
        expect(log.lines[1]?.cause).toBeDefined();
      }).pipe(Effect.provide(layer(spawner, 1, qemuOk(), relinquishQemu, log)));
    },
  );

  it.effect("expiry is per reservation: a younger one stays when an older one goes", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    const log = FakeLog.fakeLog();
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET, "drive");
      yield* TestClock.adjust("5 minutes");
      yield* sessions.reserve(OTHER, "diagnose");
      yield* TestClock.adjust("5 minutes");
      expect(yield* sessions.jobs).toBe(1);
      expect(log.lines.map((line) => line.agentId)).toEqual([TICKET]);
      // The younger one still runs.
      yield* sessions.run(OTHER, "still mine", MODEL);
      expect(spawner.spawned.map((spawned) => spawned.args[5])).toEqual(["still mine"]);
      // The ticket that expired may reserve again.
      yield* sessions.reserve(TICKET, "drive");
      expect(yield* sessions.jobs).toBe(1);
    }).pipe(Effect.provide(layer(spawner, 2, qemuOk(), qemuRelinquishOk(), log)));
  });
});

describe("jobs", () => {
  it.effect("reports the current admitted count, including a reservation that has not run", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      expect(yield* sessions.jobs).toBe(0);
      yield* sessions.reserve(TICKET, "drive");
      expect(yield* sessions.jobs).toBe(1);
      yield* sessions.run(TICKET, "do the work", MODEL);
      expect(yield* sessions.jobs).toBe(0);
    }).pipe(Effect.provide(layer(spawner)));
  });

  it.effect("a refused reserve does not count (unhappy)", () => {
    const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
    return Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      yield* sessions.reserve(TICKET, "drive");
      expect(yield* sessions.jobs).toBe(1);
      expect((yield* Effect.flip(sessions.reserve(OTHER, "drive")))._tag).toBe("AtCapacity");
      expect(yield* sessions.jobs).toBe(1);
    }).pipe(Effect.provide(layer(spawner, 1)));
  });
});
