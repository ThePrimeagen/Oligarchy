import { Effect, Fiber, Ref, Stream } from "effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as ExternalFailure from "@oligarchy/log/external-failure";
import * as Render from "@oligarchy/log/render";
import * as Errors from "./errors.ts";

export const FORCE_KILL_AFTER = "5 seconds";

// The failure message is the end of stderr, as the qemu tail is: the last lines say why. It lands
// in a job's reason and a logs row, and Postgres text refuses NUL, so a binary blob a tool dumped
// on stderr must not cost the run its verdict. When the tail lost the first line, that line leads.
export const STDERR_TAIL = 4_096;
const STDERR_HEADLINE = 512;

// The first `length` UTF-16 units, one fewer when the last would be half of a surrogate pair.
const cut = (text: string, length: number): string => {
  const last = text.charCodeAt(length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, length - 1) : text.slice(0, length);
};

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

// What a caller knows about the command's stderr. `headline`: its first line says why it failed
// (the driver's failure report), so a tail that lost it gets it back in front.
export type ExitOptions = { readonly headline?: boolean };

// Drained while the command runs, so a full pipe never blocks it; the exit is awaited on its own.
export const awaitExit = Effect.fn("Cli.awaitExit")(function* (
  command: string,
  handle: ChildProcessSpawner.ChildProcessHandle,
  options: ExitOptions = {},
) {
  const stderr = yield* Ref.make("");
  // The first line, kept apart from the tail: a driver's failure opens with its headline, and the
  // stack traces after it can push that line out of the tail.
  const head = yield* Ref.make({ line: "", done: false });
  const drain = yield* Effect.forkScoped(
    handle.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((text) => {
        const clean = text.replaceAll("\u0000", "");
        return Ref.update(stderr, (kept) => `${kept}${clean}`.slice(-STDERR_KEPT)).pipe(
          Effect.andThen(
            Ref.update(head, (first) => {
              if (first.done) {
                return first;
              }
              const line = `${first.line}${clean}`;
              const end = line.indexOf("\n");
              return end === -1 && line.length < STDERR_HEADLINE
                ? { line, done: false }
                : {
                    line: cut(line, Math.min(end === -1 ? line.length : end, STDERR_HEADLINE)),
                    done: true,
                  };
            }),
          ),
        );
      }),
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
  const tail = (yield* Ref.get(stderr)).trim().slice(-STDERR_TAIL);
  const headline = options.headline === true ? (yield* Ref.get(head)).line.trim() : "";
  const trimmed =
    headline === "" || tail.startsWith(headline)
      ? tail
      : `${headline}\n${tail.slice(-(STDERR_TAIL - headline.length - 1))}`;
  if (code !== 0) {
    return yield* failed(command, trimmed === "" ? `${command} exited ${String(code)}` : trimmed);
  }
  return yield* Effect.void;
});

export const run = Effect.fn("Cli.run")(function* (
  command: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>> = {},
  options: ExitOptions = {},
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawn(command, args, env);
      return yield* awaitExit(command, handle, options);
    }),
  );
});
