import { Effect, Path, type PlatformError, Ref, Stream } from "effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as State from "./state.ts";

export type ChildResult = {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
};

// As the wrappers pass it: Bun's own loader would read `.env.local` too and expand `$` in values,
// where the config provider reads `.env` alone, as written, for what the environment lacks.
const BUN_FLAGS = ["--no-env-file"];

const clientEntry: Effect.Effect<string, never, Path.Path> = Effect.map(Path.Path, (path) =>
  path.resolve(import.meta.dirname, "..", "client", "main.ts"),
);

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
    const main = yield* clientEntry;
    return ChildProcess.make(
      host.execPath,
      [...BUN_FLAGS, main, ...args, "--agent-id", agentId, "--server-url", session.serverUrl],
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
