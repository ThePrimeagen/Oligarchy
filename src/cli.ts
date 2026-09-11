import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as ExternalFailure from "./external-failure.ts";
import * as Render from "./observability/render.ts";
import * as Errors from "./shared/errors.ts";

export const FORCE_KILL_AFTER = "5 seconds";

const detail = (error: unknown): string =>
  ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), Render.errorDetail(error));

const failed = (command: string, message: string, cause?: unknown): Errors.CliFailed =>
  cause === undefined
    ? Errors.CliFailed.make({ command, message })
    : Errors.CliFailed.make({ command, message, cause });

export const spawn = Effect.fn("Cli.spawn")(function* (
  command: string,
  args: ReadonlyArray<string>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner
    .spawn(
      ChildProcess.make(command, args, {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
        extendEnv: true,
        detached: false,
        killSignal: "SIGTERM",
        forceKillAfter: FORCE_KILL_AFTER,
      }),
    )
    .pipe(Effect.mapError((error) => failed(command, detail(error), error)));
});

export const awaitExit = Effect.fn("Cli.awaitExit")(function* (
  command: string,
  handle: ChildProcessSpawner.ChildProcessHandle,
) {
  const [stderr, code] = yield* Effect.all(
    [
      Stream.mkString(Stream.decodeText(handle.stderr)).pipe(
        Effect.mapError((error) => failed(command, detail(error), error)),
      ),
      handle.exitCode.pipe(Effect.mapError((error) => failed(command, detail(error), error))),
    ],
    { concurrency: "unbounded" },
  );
  const trimmed = stderr.trim();
  if (code !== 0) {
    return yield* failed(command, trimmed === "" ? `${command} exited ${String(code)}` : trimmed);
  }
  return yield* Effect.void;
});

export const run = Effect.fn("Cli.run")(function* (command: string, args: ReadonlyArray<string>) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawn(command, args);
      return yield* awaitExit(command, handle);
    }),
  );
});
