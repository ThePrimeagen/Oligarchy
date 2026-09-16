import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Path, Ref, Stream } from "effect";
import * as Children from "../../src/session/children.ts";
import * as State from "../../src/session/state.ts";
import * as FakeChildren from "../support/fake-children.ts";
import { fakeTty } from "../support/fake-tty.ts";

const SESSION_ID = "6f1c0000-0000-4000-8000-00000000e2a9";
const SERVER_URL = "http://127.0.0.1:1";

const hostLayer = Layer.succeed(State.Host)(
  State.Host.of({
    execPath: "/opt/bun/bin/bun",
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
    "spawns this bun without its .env loader on the client entry with the args, the agent id and the server url",
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
        expect(child?.command.command).toBe("/opt/bun/bin/bun");
        const args = child?.command.args ?? [];
        expect(args[0]).toBe("--no-env-file");
        expect(args[1]).toMatch(/^\/.*\/src\/client\/main\.ts$/);
        expect(args[1]).not.toContain("..");
        expect(args.slice(2)).toEqual([
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
