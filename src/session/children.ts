import { Effect, Fiber, Path, type PlatformError, Ref, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as State from "./state.ts";

export type ChildResult = {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
};

export type FollowExit = {
  readonly code: number;
  readonly killed: boolean;
  readonly stderr: string;
};

export type FollowChild = {
  readonly lines: Stream.Stream<string>;
  readonly kill: Effect.Effect<void>;
  readonly exit: Effect.Effect<FollowExit>;
};

const NODE_FLAGS = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"];

const entry = (name: "client" | "ctrl"): Effect.Effect<string, never, Path.Path> =>
  Effect.map(Path.Path, (path) => path.resolve(import.meta.dirname, "..", name, "main.ts"));

const concat = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

const text = (
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
): Effect.Effect<string> => Stream.mkString(Stream.decodeText(stream)).pipe(Effect.orDie);

// A death by signal has no exit code; the caller only reads it when the child was not killed.
const exitCode = (handle: ChildProcessSpawner.ChildProcessHandle): Effect.Effect<number> =>
  handle.exitCode.pipe(Effect.orElseSucceed(() => 1));

// Own process group: a terminal hangup or Ctrl-C reaches the whole foreground group, and a
// start killed mid-boot still boots on the proxy. Detached, the child survives to hand back
// its session id so shutdown can stop it instead of orphaning the QEMU.
const clientCommand = (
  session: State.Session,
  args: ReadonlyArray<string>,
): Effect.Effect<ChildProcess.Command, never, Path.Path | State.Host> =>
  Effect.gen(function* () {
    const host = yield* State.Host;
    const agentId = yield* Ref.get(session.agentId);
    const main = yield* entry("client");
    return ChildProcess.make(
      host.execPath,
      [...NODE_FLAGS, main, ...args, "--agent-id", agentId, "--server-url", session.serverUrl],
      { stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true, extendEnv: true },
    );
  });

const collect = (
  command: ChildProcess.Command,
): Effect.Effect<ChildResult, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const handle = yield* spawner.spawn(command).pipe(Effect.orDie);
      const [stdout, stderr, code] = yield* Effect.all(
        [
          Stream.runCollect(handle.stdout).pipe(Effect.orDie, Effect.map(concat)),
          text(handle.stderr),
          exitCode(handle),
        ],
        { concurrency: "unbounded" },
      );
      return { code, stdout, stderr: stderr.trim() };
    }),
  );

export const runClient = Effect.fn("Children.runClient")(function* (
  session: State.Session,
  args: ReadonlyArray<string>,
) {
  return yield* collect(yield* clientCommand(session, args));
});

export const spawnFollow = Effect.fn("Children.spawnFollow")(function* (
  session: State.Session,
  id: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = yield* clientCommand(session, ["follow", "--session-id", id]);
  const handle = yield* spawner.spawn(command).pipe(Effect.orDie);
  const killed = yield* Ref.make(false);
  const stderr = yield* Effect.forkScoped(text(handle.stderr));
  const child: FollowChild = {
    lines: Stream.splitLines(Stream.decodeText(handle.stdout)).pipe(Stream.orDie),
    // Marked before the signal goes, as Node marks `child.killed`: the exit it causes can be
    // observed before this fiber resumes. A child already gone cannot be killed, so it is not.
    kill: Ref.set(killed, true).pipe(
      Effect.andThen(handle.kill()),
      Effect.catch(() => Ref.set(killed, false)),
    ),
    exit: Effect.all({
      code: exitCode(handle),
      killed: Ref.get(killed),
      stderr: Effect.map(Fiber.join(stderr), (collected) => collected.trim()),
    }),
  };
  return child;
});

// Attached to this process group, unlike the client: interrupting the fiber kills it.
export const runCtrl = Effect.fn("Children.runCtrl")(function* (
  serverUrl: string,
  args: ReadonlyArray<string>,
) {
  const host = yield* State.Host;
  const main = yield* entry("ctrl");
  return yield* collect(
    ChildProcess.make(host.execPath, [...NODE_FLAGS, main, ...args, "--server-url", serverUrl], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: false,
      extendEnv: true,
    }),
  );
});
