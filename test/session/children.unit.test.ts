import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { type Cause, Effect, Fiber, Layer, Path, Queue, Ref, Stream } from "effect";
import * as Children from "../../src/session/children.ts";
import * as State from "../../src/session/state.ts";
import * as FakeChildren from "../support/fake-children.ts";
import { fakeTty } from "../support/fake-tty.ts";

const SESSION_ID = "6f1c0000-0000-4000-8000-00000000e2a9";
const SERVER_URL = "http://127.0.0.1:1";
const encoder = new TextEncoder();

const settle: Effect.Effect<void> = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) {
    yield* Effect.yieldNow;
  }
});

const hostLayer = Layer.succeed(State.Host)(
  State.Host.of({
    execPath: "/opt/node/bin/node",
    imageProtocol: "ansi",
    input: fakeTty().input,
    output: fakeTty().output,
    termination: Effect.never,
  }),
);

const provide = (spawner: FakeChildren.FakeSpawner) =>
  Layer.mergeAll(hostLayer, spawner.layer, Path.layer);

const session = Effect.gen(function* () {
  const made = yield* State.make(SERVER_URL);
  yield* Ref.set(made.agentId, "session-agent-1");
  return made;
});

describe("runClient", () => {
  it.effect(
    "spawns node with strip-types, the client entry, the args, the agent id and the server url",
    () =>
      Effect.gen(function* () {
        const spawner = FakeChildren.fakeSpawner(() => ({ code: 0, stdout: `${SESSION_ID}\n` }));
        const result = yield* Children.runClient(yield* session, [
          "start",
          "--iso",
          "omarchy.iso",
        ]).pipe(Effect.provide(provide(spawner)));
        expect(result.code).toBe(0);
        expect(new TextDecoder().decode(result.stdout)).toBe(`${SESSION_ID}\n`);
        expect(result.stderr).toBe("");
        const [child] = spawner.spawned;
        expect(child?.command.command).toBe("/opt/node/bin/node");
        const args = child?.command.args ?? [];
        expect(args.slice(0, 2)).toEqual([
          "--experimental-strip-types",
          "--disable-warning=ExperimentalWarning",
        ]);
        expect(args[2]).toMatch(/^\/.*\/src\/client\/main\.ts$/);
        expect(args[2]).not.toContain("..");
        expect(args.slice(3)).toEqual([
          "start",
          "--iso",
          "omarchy.iso",
          "--agent-id",
          "session-agent-1",
          "--server-url",
          SERVER_URL,
        ]);
        expect(child?.command.options).toMatchObject({
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          detached: true,
          extendEnv: true,
        });
        expect(child?.released()).toBe(true);
        expect(child?.killed()).toBe(false);
      }),
  );

  it.effect("returns a non-zero exit with the trimmed stderr instead of failing", () =>
    Effect.gen(function* () {
      const spawner = FakeChildren.fakeSpawner(() => ({
        code: 1,
        stderr: 'unknown session "x"\n    at somewhere\n',
      }));
      const result = yield* Children.runClient(yield* session, [
        "get-image",
        "--session-id",
        "x",
      ]).pipe(Effect.provide(provide(spawner)));
      expect(result.code).toBe(1);
      expect(result.stdout).toHaveLength(0);
      expect(result.stderr).toBe('unknown session "x"\n    at somewhere');
    }),
  );

  it.effect("reads the agent id at spawn time so a fresh start uses the new id", () =>
    Effect.gen(function* () {
      const spawner = FakeChildren.fakeSpawner(() => ({ code: 0 }));
      const made = yield* session;
      yield* Ref.set(made.agentId, "session-agent-2");
      yield* Children.runClient(made, ["get-serial"]).pipe(Effect.provide(provide(spawner)));
      expect(spawner.spawned[0]?.command.args).toContain("session-agent-2");
    }),
  );

  it.effect("collects binary stdout across chunks", () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 128]);
      const spawner = FakeChildren.fakeSpawner(() => ({
        code: 0,
        stdout: Stream.make(bytes.subarray(0, 3), bytes.subarray(3)),
      }));
      const result = yield* Children.runClient(yield* session, ["get-image"]).pipe(
        Effect.provide(provide(spawner)),
      );
      expect(Array.from(result.stdout)).toEqual(Array.from(bytes));
    }),
  );
});

describe("runCtrl", () => {
  it.effect("spawns the ctrl entry attached to this process group with the server url last", () =>
    Effect.gen(function* () {
      const spawner = FakeChildren.fakeSpawner(() => ({ code: 0, stdout: "[]" }));
      const result = yield* Children.runCtrl(SERVER_URL, ["session", "list", "--json"]).pipe(
        Effect.provide(provide(spawner)),
      );
      expect(result.code).toBe(0);
      expect(new TextDecoder().decode(result.stdout)).toBe("[]");
      const [child] = spawner.spawned;
      expect(child?.command.args[2]).toMatch(/^\/.*\/src\/ctrl\/main\.ts$/);
      expect(child?.command.args.slice(3)).toEqual([
        "session",
        "list",
        "--json",
        "--server-url",
        SERVER_URL,
      ]);
      expect(child?.command.options.detached).toBe(false);
      expect(child?.command.options.extendEnv).toBe(true);
    }),
  );

  it.effect("is killed when the fiber running it is interrupted", () =>
    Effect.gen(function* () {
      const spawner = FakeChildren.fakeSpawner(() => ({ code: 0, stdout: Stream.never }));
      const fiber = yield* Effect.forkChild(
        Children.runCtrl(SERVER_URL, ["session", "list"]).pipe(Effect.provide(provide(spawner))),
        { startImmediately: true },
      );
      yield* settle;
      expect(spawner.spawned).toHaveLength(1);
      expect(spawner.spawned[0]?.killed()).toBe(false);
      yield* Fiber.interrupt(fiber);
      expect(spawner.spawned[0]?.killed()).toBe(true);
      expect(spawner.spawned[0]?.released()).toBe(true);
    }),
  );
});

describe("spawnFollow", () => {
  it.effect("streams stdout lines and reports the exit code and stderr when the child ends", () =>
    Effect.gen(function* () {
      const spawner = FakeChildren.fakeSpawner(() => ({
        code: 0,
        stdout: Stream.make(
          encoder.encode('{"type":"session","status":"run'),
          encoder.encode('ning"}\n{"type":"session","status":"succeeded"}\n'),
        ),
      }));
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* Children.spawnFollow(yield* session, SESSION_ID);
          const lines = yield* Stream.runCollect(child.lines);
          const exit = yield* child.exit;
          return { lines, exit };
        }),
      ).pipe(Effect.provide(provide(spawner)));
      expect(result.lines).toEqual([
        '{"type":"session","status":"running"}',
        '{"type":"session","status":"succeeded"}',
      ]);
      expect(result.exit).toEqual({ code: 0, killed: false, stderr: "" });
      const [child] = spawner.spawned;
      expect(child?.command.args.slice(3)).toEqual([
        "follow",
        "--session-id",
        SESSION_ID,
        "--agent-id",
        "session-agent-1",
        "--server-url",
        SERVER_URL,
      ]);
      expect(child?.command.options.detached).toBe(true);
    }),
  );

  it.effect("a refused follow ends with the child's stderr and a non-zero code", () =>
    Effect.gen(function* () {
      const spawner = FakeChildren.fakeSpawner(() => ({
        code: 1,
        stderr: 'session "x" has already completed (succeeded)\n',
      }));
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* Children.spawnFollow(yield* session, "x");
          const lines = yield* Stream.runCollect(child.lines);
          return { lines, exit: yield* child.exit };
        }),
      ).pipe(Effect.provide(provide(spawner)));
      expect(result.lines).toEqual([]);
      expect(result.exit).toEqual({
        code: 1,
        killed: false,
        stderr: 'session "x" has already completed (succeeded)',
      });
    }),
  );

  it.effect("kill ends the line stream and reports killed", () =>
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<Uint8Array, Cause.Done>();
      const spawner = FakeChildren.fakeSpawner(() => ({
        code: 0,
        stdout: Stream.fromQueue(queue),
      }));
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* Children.spawnFollow(yield* session, SESSION_ID);
          const collector = yield* Effect.forkChild(Stream.runCollect(child.lines), {
            startImmediately: true,
          });
          yield* Queue.offer(queue, encoder.encode('{"type":"session","status":"running"}\n'));
          yield* settle;
          yield* child.kill;
          const lines = yield* Fiber.join(collector);
          return { lines, exit: yield* child.exit };
        }),
      ).pipe(Effect.provide(provide(spawner)));
      expect(result.lines).toEqual(['{"type":"session","status":"running"}']);
      expect(result.exit.killed).toBe(true);
      expect(spawner.spawned[0]?.killed()).toBe(true);
    }),
  );
});
