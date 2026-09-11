import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as ExternalFailure from "./external-failure.ts";
import * as Render from "./observability/render.ts";
import * as Errors from "./shared/errors.ts";

export const FORCE_KILL_AFTER = "5 seconds";

// The failure message is the end of stderr, as the qemu tail is: the last lines say why. It lands
// in a job's reason and a logs row, and Postgres text refuses NUL, so a binary blob a tool dumped
// on stderr must not cost the run its verdict.
export const STDERR_TAIL = 4_096;

const detail = (error: unknown): string =>
  ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), Render.errorDetail(error));

const failed = (command: string, message: string, cause?: unknown): Errors.CliFailed =>
  cause === undefined
    ? Errors.CliFailed.make({ command, message })
    : Errors.CliFailed.make({ command, message, cause });

// `env` joins the inherited environment for this one child; nothing secret goes on argv.
export const run = Effect.fn("Cli.run")(function* (
  command: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>> = {},
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const handle = yield* spawner
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
      const [stderr, code] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stderr)).pipe(
            Effect.mapError((error) => failed(command, detail(error), error)),
          ),
          handle.exitCode.pipe(Effect.mapError((error) => failed(command, detail(error), error))),
        ],
        { concurrency: "unbounded" },
      );
      const trimmed = stderr.replaceAll("\u0000", "").trim().slice(-STDERR_TAIL);
      if (code !== 0) {
        return yield* failed(
          command,
          trimmed === "" ? `${command} exited ${String(code)}` : trimmed,
        );
      }
      return yield* Effect.void;
    }),
  );
});
