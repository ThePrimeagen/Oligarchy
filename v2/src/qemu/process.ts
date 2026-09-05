import { Deferred, Effect, Fiber, Ref, Stream } from "effect";
import type { PlatformError } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as ExternalFailure from "../external-failure.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as Args from "./args.ts";

export const STDERR_TAIL_BYTES = 4096;

export type QemuProcess = {
  readonly pid: number;
  readonly stderrTail: Effect.Effect<string>;
  // The exit code, or null for a signal death; resolves only once stderr is drained.
  readonly exited: Effect.Effect<number | null>;
  readonly exitedBeforeConnect: Effect.Effect<never, Errors.QemuStartError>;
  readonly withStderr: (message: string) => Effect.Effect<string>;
};

// The thrown value's own message behind a platform failure (Node's `spawn x ENOENT`), else the
// platform message.
export const detail = (error: unknown): string =>
  ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), Render.errorDetail(error));

const startError = (prefix: string, error: unknown): Errors.QemuStartError =>
  Errors.QemuStartError.make({ message: `${prefix}: ${detail(error)}`, cause: error });

const quiet = { stdin: "ignore", stdout: "ignore", stderr: "ignore" } as const;

export const spawn = Effect.fn("Process.spawn")(function* (
  executable: string,
  args: ReadonlyArray<string>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner
    .spawn(
      // Not detached: the child shares the proxy's process group, as it always has.
      ChildProcess.make(executable, args, {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
        extendEnv: true,
        detached: false,
      }),
    )
    .pipe(Effect.mapError((error) => startError("qemu", error)));
  const tail = yield* Ref.make("");
  const exit = yield* Deferred.make<number | null>();
  // QEMU's stdio is otherwise discarded, so a boot failure (bad KVM, a rejected arg) would reach
  // us as a bare timeout. Keep the tail of stderr to name it.
  const drain = yield* Effect.forkScoped(
    handle.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((text) =>
        Ref.update(tail, (current) => `${current}${text}`.slice(-STDERR_TAIL_BYTES)),
      ),
      Effect.ignore,
    ),
    { startImmediately: true },
  );
  // Exit can fire before the piped stderr is fully drained: publish only after the drain ends.
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      const code = yield* handle.exitCode.pipe(
        Effect.map((exitCode): number | null => exitCode),
        Effect.orElseSucceed((): number | null => null),
      );
      yield* Fiber.join(drain);
      yield* Deferred.succeed(exit, code);
    }),
    { startImmediately: true },
  );
  const stderrTail = Ref.get(tail);
  const withStderr = (message: string): Effect.Effect<string> =>
    Effect.map(stderrTail, (stderr) => (stderr === "" ? message : `${message}: ${stderr.trim()}`));
  const exited = Deferred.await(exit);
  const exitedBeforeConnect: Effect.Effect<never, Errors.QemuStartError> = Effect.gen(function* () {
    const code = yield* exited;
    const message = yield* withStderr(`qemu: exited ${String(code)} before QMP connect`);
    return yield* Errors.QemuStartError.make({ message });
  });
  return {
    pid: handle.pid,
    stderrTail,
    exited,
    exitedBeforeConnect,
    withStderr,
  } satisfies QemuProcess;
});

export const spawnQemu = (args: ReadonlyArray<string>) => spawn(Args.QEMU_BIN, args);

export const createDisk = Effect.fn("Process.createDisk")(function* (path: string, size: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* spawner
    .exitCode(ChildProcess.make(Args.QEMU_IMG, ["create", "-f", "qcow2", path, size], quiet))
    .pipe(
      Effect.mapError((error) => startError("qemu-img", error)),
      Effect.filterOrFail(
        (code) => code === 0,
        (code) => Errors.QemuStartError.make({ message: `qemu-img create exited ${String(code)}` }),
      ),
    );
});

export const commandExists = Effect.fn("Process.commandExists")(function* (bin: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner
    .exitCode(ChildProcess.make("/bin/sh", ["-c", `command -v ${bin}`], quiet))
    .pipe(
      Effect.map((code) => code === 0),
      Effect.orElseSucceed(() => false),
    );
});

export const displayHelp: Effect.Effect<
  string,
  PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner.string(
    ChildProcess.make(Args.QEMU_BIN, ["-display", "help"], { stdin: "ignore" }),
    { includeStderr: true },
  );
});
