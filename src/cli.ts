import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as ExternalFailure from "./external-failure.ts";
import * as Render from "./observability/render.ts";
import * as Errors from "./shared/errors.ts";

const detail = (error: unknown): string =>
  ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), Render.errorDetail(error));

const failed = (command: string, message: string, cause?: unknown): Errors.CliFailed =>
  cause === undefined
    ? Errors.CliFailed.make({ command, message })
    : Errors.CliFailed.make({ command, message, cause });

export const run = Effect.fn("Cli.run")(function* (command: string, args: ReadonlyArray<string>) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(command, args, {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "pipe",
            extendEnv: true,
            detached: false,
          }),
        )
        .pipe(Effect.mapError((error) => failed(command, detail(error), error)));
      const [stderr, code] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stderr)).pipe(Effect.orDie),
          handle.exitCode.pipe(Effect.mapError((error) => failed(command, detail(error), error))),
        ],
        { concurrency: "unbounded" },
      );
      const trimmed = stderr.trim();
      yield* Effect.succeed(code).pipe(
        Effect.filterOrFail(
          (exit) => exit === 0,
          (exit) => failed(command, trimmed === "" ? `${command} exited ${String(exit)}` : trimmed),
        ),
      );
    }),
  );
});
