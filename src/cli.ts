import { Effect, Fiber, Ref, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as ExternalFailure from "./external-failure.ts";
import * as Render from "./observability/render.ts";
import * as Errors from "./shared/errors.ts";

export const FORCE_KILL_AFTER = "5 seconds";

// The failure message is the end of stderr, as the qemu tail is: the last lines say why. It lands
// in a job's reason and a logs row, and Postgres text refuses NUL, so a binary blob a tool dumped
// on stderr must not cost the run its verdict.
export const STDERR_TAIL = 4_096;

// What the drain keeps, NUL bytes already dropped: twice the tail, so the trailing whitespace the
// message loses comes out of the excess, and a tool that floods stderr for half an hour costs the
// process no more than this.
const STDERR_KEPT = 2 * STDERR_TAIL;

// The command's stderr is a pipe it shares with every process it starts (a tool the agent ran, an
// MCP server), and the pipe ends only when the last of them closes it; Node's `exit` fires long
// before that `close`. The exit is the end of the run: after it the drain gets this long to
// deliver what the command itself wrote, then the tail so far is the tail. Without the bound a
// straggler held every run to its ceiling.
const STDERR_GRACE = "2 seconds";

const detail = (error: unknown): string =>
  ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), Render.errorDetail(error));

const failed = (command: string, message: string, cause?: unknown): Errors.CliFailed =>
  cause === undefined
    ? Errors.CliFailed.make({ command, message })
    : Errors.CliFailed.make({ command, message, cause });

// `env` joins the inherited environment for this one child; nothing secret goes on argv.
export const spawn = Effect.fn("Cli.spawn")(function* (
  command: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>> = {},
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner
    .spawn(
      // stdout is the command's own story (an agent's transcript) and passes through to
      // whoever is watching this process; stderr is the diagnostic this process keeps.
      ChildProcess.make(command, args, {
        stdin: "ignore",
        stdout: "inherit",
        stderr: "pipe",
        env,
        extendEnv: true,
        detached: false,
        killSignal: "SIGTERM",
        forceKillAfter: FORCE_KILL_AFTER,
      }),
    )
    .pipe(Effect.mapError((error) => failed(command, detail(error), error)));
});

// Drained while the command runs, so a full pipe never blocks it; the exit is awaited on its own.
export const awaitExit = Effect.fn("Cli.awaitExit")(function* (
  command: string,
  handle: ChildProcessSpawner.ChildProcessHandle,
) {
  const stderr = yield* Ref.make("");
  const drain = yield* Effect.forkScoped(
    handle.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((text) =>
        Ref.update(stderr, (kept) => `${kept}${text.replaceAll("\u0000", "")}`.slice(-STDERR_KEPT)),
      ),
    ),
    { startImmediately: true },
  );
  const code = yield* handle.exitCode.pipe(
    Effect.mapError((error) => failed(command, detail(error), error)),
  );
  // A drain that ended with the pipe joins at once; one a straggler holds is left to the scope.
  yield* Fiber.join(drain).pipe(
    Effect.mapError((error) => failed(command, detail(error), error)),
    Effect.timeoutOrElse({ duration: STDERR_GRACE, orElse: () => Effect.void }),
  );
  const trimmed = (yield* Ref.get(stderr)).trim().slice(-STDERR_TAIL);
  if (code !== 0) {
    return yield* failed(command, trimmed === "" ? `${command} exited ${String(code)}` : trimmed);
  }
  return yield* Effect.void;
});

export const run = Effect.fn("Cli.run")(function* (
  command: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>> = {},
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawn(command, args, env);
      return yield* awaitExit(command, handle);
    }),
  );
});
