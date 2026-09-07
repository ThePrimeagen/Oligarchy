import { Deferred, Effect, Layer, PlatformError, Sink, Stream } from "effect";
import { type ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const encoder = new TextEncoder();

// What one scripted child does: it writes `stdout` (a string, bytes, or a stream the test drives),
// writes `stderr`, and exits with `code` once its stdout has been written in full.
export type Script = {
  readonly code?: number;
  readonly stdout?: string | Uint8Array | Stream.Stream<Uint8Array>;
  readonly stderr?: string;
};

export type Spawned = {
  readonly command: ChildProcess.StandardCommand;
  readonly pid: number;
  // `true` once `kill` was called on the handle, by the caller or by the scope's release.
  readonly killed: () => boolean;
  // `true` once the handle's scope closed.
  readonly released: () => boolean;
};

export type FakeSpawner = {
  readonly layer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>;
  readonly spawned: Array<Spawned>;
};

const bytesOf = (stdout: Script["stdout"]): Stream.Stream<Uint8Array> => {
  if (stdout === undefined) {
    return Stream.empty;
  }
  if (typeof stdout === "string") {
    return Stream.make(encoder.encode(stdout));
  }
  if (stdout instanceof Uint8Array) {
    return Stream.make(stdout);
  }
  return stdout;
};

const signalExit = (command: ChildProcess.StandardCommand): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: "Unknown",
    module: "ChildProcess",
    method: "exitCode",
    description: `Process interrupted due to receipt of signal: 'SIGTERM' (${command.command})`,
  });

// A ChildProcessSpawner whose children follow the script the test hands out per spawn, in
// order. Killing a child ends its stdout and makes `exitCode` fail the way Node's spawner
// reports a signal death; leaving the handle's scope kills a child that is still running.
export const fakeSpawner = (
  script: (command: ChildProcess.StandardCommand, index: number) => Script,
): FakeSpawner => {
  const spawned: Array<Spawned> = [];
  const spawn: ChildProcessSpawner.ChildProcessSpawner["Service"]["spawn"] = (command) =>
    Effect.gen(function* () {
      if (command._tag !== "StandardCommand") {
        return yield* Effect.die("fake spawner: piped commands are not scripted");
      }
      const index = spawned.length;
      const scripted = script(command, index);
      const pid = 1000 + index;
      let killed = false;
      let released = false;
      const exited = yield* Deferred.make<
        ChildProcessSpawner.ExitCode,
        PlatformError.PlatformError
      >();
      const kill = Effect.suspend(() => {
        killed = true;
        return Deferred.fail(exited, signalExit(command)).pipe(Effect.asVoid);
      });
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          released = true;
          if (!(yield* Deferred.isDone(exited))) {
            yield* kill;
          }
        }),
      );
      const stdout = bytesOf(scripted.stdout).pipe(
        Stream.interruptWhen(Deferred.await(exited).pipe(Effect.ignore)),
        Stream.onEnd(
          Deferred.succeed(exited, ChildProcessSpawner.ExitCode(scripted.code ?? 0)).pipe(
            Effect.asVoid,
          ),
        ),
      );
      const stderr = Stream.make(encoder.encode(scripted.stderr ?? ""));
      spawned.push({
        command,
        pid,
        killed: () => killed,
        released: () => released,
      });
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(pid),
        exitCode: Deferred.await(exited),
        isRunning: Effect.map(Deferred.isDone(exited), (done) => !done),
        kill: () => kill,
        stdin: Sink.drain,
        stdout,
        stderr,
        all: Stream.merge(stdout, stderr),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
    });
  return {
    layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(ChildProcessSpawner.make(spawn)),
    spawned,
  };
};
