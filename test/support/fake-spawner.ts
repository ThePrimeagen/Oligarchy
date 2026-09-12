import { Cause, Deferred, Effect, Exit, Layer, PlatformError, Queue, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export type Scripted = {
  // Exits with this code right after emitting its output; absent means "runs until told".
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  // The spawn itself fails (an ENOENT binary, say) with this message.
  readonly spawnError?: string;
  // SIGTERM does not exit; a kill with forceKillAfter then escalates to SIGKILL.
  readonly ignoreTerm?: boolean;
  // kill() fails with this description; the process stays running unless alreadyDeadOnKill.
  readonly killError?: string;
  readonly alreadyDeadOnKill?: boolean;
  // A process the command started outlives it holding the stderr pipe: the exit delivers its
  // code and the last bytes, but stderr never ends, as Node's `exit` fires before `close`.
  readonly stderrStaysOpen?: boolean;
};

export type Script = (command: string, args: ReadonlyArray<string>) => Scripted;

export type Spawned = {
  readonly pid: number;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly options: ChildProcess.CommandOptions;
  readonly kills: Array<string>;
  readonly killOptions: Array<ChildProcess.KillOptions | undefined>;
  readonly isReleased: () => boolean;
  readonly isRunning: Effect.Effect<boolean>;
  // Exits, then (as Node does) delivers the last stderr bytes and closes the pipes.
  readonly exit: (code: number, trailingStderr?: string) => Effect.Effect<void>;
  // Dies from a signal sent by someone else: no exit code, as Node reports it.
  readonly die: (signal: string) => Effect.Effect<void>;
};

export type FakeSpawner = {
  readonly spawned: Array<Spawned>;
  readonly layer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>;
};

const encoder = new TextEncoder();

const signalDeath = (signal: string): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: "Unknown",
    module: "ChildProcess",
    method: "exitCode",
    description: `Process interrupted due to receipt of signal: '${signal}'`,
  });

// A ChildProcessSpawner whose processes are scripted per command; every spawn is recorded.
export const fakeSpawner = (script: Script = () => ({ exitCode: 0 })): FakeSpawner => {
  const spawned: Array<Spawned> = [];
  let nextPid = 4000;

  const spawn: ChildProcessSpawner.ChildProcessSpawner["Service"]["spawn"] = (command) =>
    Effect.gen(function* () {
      if (!ChildProcess.isStandardCommand(command)) {
        return yield* Effect.die("fake spawner: piped commands are not scripted");
      }
      const scripted = script(command.command, command.args);
      if (scripted.spawnError !== undefined) {
        return yield* Effect.fail(
          PlatformError.systemError({
            _tag: "NotFound",
            module: "ChildProcess",
            method: "spawn",
            pathOrDescriptor: command.command,
            cause: new Error(scripted.spawnError),
          }),
        );
      }
      const exitSignal = yield* Deferred.make<number, PlatformError.PlatformError>();
      const stdout = yield* Queue.unbounded<Uint8Array, Cause.Done>();
      const stderr = yield* Queue.unbounded<Uint8Array, Cause.Done>();
      const emit = (queue: Queue.Queue<Uint8Array, Cause.Done>, text: string | undefined) => {
        if (text !== undefined && text !== "") {
          Queue.offerUnsafe(queue, encoder.encode(text));
        }
      };
      const end = () => {
        Queue.endUnsafe(stdout);
        if (scripted.stderrStaysOpen !== true) {
          Queue.endUnsafe(stderr);
        }
      };
      emit(stdout, scripted.stdout);
      emit(stderr, scripted.stderr);
      if (scripted.exitCode !== undefined) {
        Deferred.doneUnsafe(exitSignal, Exit.succeed(scripted.exitCode));
        end();
      }
      const kills: Array<string> = [];
      const killOptions: Array<ChildProcess.KillOptions | undefined> = [];
      let released = false;
      const die = (signal: string) =>
        Effect.sync(() => {
          if (!Deferred.isDoneUnsafe(exitSignal)) {
            Deferred.doneUnsafe(exitSignal, Exit.fail(signalDeath(signal)));
            end();
          }
        });
      const failKill = (description: string) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "Unknown",
            module: "ChildProcess",
            method: "kill",
            description,
          }),
        );
      const kill = (options?: ChildProcess.KillOptions) =>
        Effect.gen(function* () {
          killOptions.push(options);
          if (scripted.killError !== undefined) {
            if (scripted.alreadyDeadOnKill === true) {
              yield* die("SIGTERM");
            }
            return yield* failKill(scripted.killError);
          }
          const signal = options?.killSignal ?? "SIGTERM";
          kills.push(signal);
          if (Deferred.isDoneUnsafe(exitSignal)) {
            return yield* failKill("Failed to kill child process");
          }
          if (scripted.ignoreTerm === true && signal === "SIGTERM") {
            if (options?.forceKillAfter === undefined) {
              return yield* Effect.never;
            }
            yield* Effect.sleep(options.forceKillAfter);
            kills.push("SIGKILL");
            return yield* die("SIGKILL");
          }
          return yield* die(signal);
        });
      const pid = nextPid++;
      spawned.push({
        pid,
        command: command.command,
        args: command.args,
        options: command.options,
        kills,
        killOptions,
        isReleased: () => released,
        isRunning: Effect.map(Deferred.isDone(exitSignal), (done) => !done),
        exit: (code, trailingStderr) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(exitSignal, code);
            yield* Effect.yieldNow;
            emit(stderr, trailingStderr);
            end();
          }),
        die,
      });
      // The real spawner's release sends the kill signal when the process still runs.
      yield* Effect.addFinalizer(() =>
        Effect.suspend(() => {
          released = true;
          // A child already gone cannot be killed.
          return Deferred.isDoneUnsafe(exitSignal)
            ? Effect.void
            : kill().pipe(Effect.catch(() => Effect.void));
        }),
      );
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(pid),
        exitCode: Effect.map(Deferred.await(exitSignal), ChildProcessSpawner.ExitCode),
        isRunning: Effect.map(Deferred.isDone(exitSignal), (done) => !done),
        kill,
        stdin: Sink.drain,
        stdout: Stream.fromQueue(stdout),
        stderr: Stream.fromQueue(stderr),
        all: Stream.merge(Stream.fromQueue(stdout), Stream.fromQueue(stderr)),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
    });

  return {
    spawned,
    layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(ChildProcessSpawner.make(spawn)),
  };
};

// Scripts by executable name; anything unnamed exits 0 silently.
export const byCommand =
  (
    table: Readonly<Record<string, Scripted | ((args: ReadonlyArray<string>) => Scripted)>>,
  ): Script =>
  (command, args) => {
    const entry = table[command];
    if (entry === undefined) {
      return { exitCode: 0 };
    }
    return typeof entry === "function" ? entry(args) : entry;
  };
