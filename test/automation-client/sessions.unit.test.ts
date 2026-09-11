import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import * as OpenCode from "../../src/automation-client/opencode.ts";
import * as Sessions from "../../src/automation-client/sessions.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";

const TICKET = "OLI-42";
const OTHER = "OLI-99";

const layer = (spawner: FakeSpawner.FakeSpawner) =>
  Sessions.Sessions.layer.pipe(Layer.provide(spawner.layer));

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
});
