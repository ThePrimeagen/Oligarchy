import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  Result,
  Schema,
  Scope,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as Log from "../observability/log.ts";
import * as Process from "../qemu/process.ts";
import * as Agents from "../shared/agents.ts";
import type * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

export const EXECUTABLE = "opencode";
// OpenCode's own Grok, as the Cursor default is Grok; anything else is the operator's to name.
export const DEFAULT_MODEL: Domain.ModelChoice = { model: "opencode/grok-code" };
// A run names its session in its first event, once the provider has taken the prompt; one that
// has not in this long is not going to.
export const SESSION_TIMEOUT = "60 seconds";
export const STDERR_TAIL_BYTES = 4096;
export const FORCE_KILL_AFTER = "5 seconds";

// The agent runs ./client and ./ctrl from the package root, as a cloud agent does from its
// checkout; the package sits two directories above this module.
const ROOT = decodeURIComponent(new URL("../..", import.meta.url).pathname);

const encoder = new TextEncoder();

// Every line `opencode run --format json` writes names the session it belongs to; an error event
// carries opencode's error, which is named, with the message under `data` when it has one.
const Event = Schema.fromJsonString(
  Schema.toCodecJson(
    Schema.Union([
      Schema.Struct({
        type: Schema.Literal("error"),
        sessionID: Schema.String,
        error: Schema.Unknown,
      }),
      Schema.Struct({ sessionID: Schema.String }),
    ]),
  ),
);
type Event = typeof Event.Type;
const decodeEvent = Schema.decodeUnknownOption(Event);
const NamedError = Schema.Struct({
  name: Schema.String,
  data: Schema.optionalKey(Schema.Struct({ message: Schema.optionalKey(Schema.String) })),
});
const namedError = Schema.decodeUnknownOption(NamedError);

const describeError = (error: unknown): string =>
  Option.match(namedError(error), {
    onNone: () => JSON.stringify(error),
    onSome: (named) => named.data?.message ?? named.name,
  });

const failed = (message: string, cause?: unknown): Errors.AgentFailed =>
  Errors.AgentFailed.make(
    Object.assign({ message, retryable: false }, cause === undefined ? undefined : { cause }),
  );

// The choice as `opencode run` takes it: the model as provider/model, the reasoning level as the
// model's variant. opencode has no fast mode, and a Cursor id has no provider.
export const args = (
  choice: Domain.ModelChoice,
): Result.Result<ReadonlyArray<string>, Errors.ModelUnavailable> => {
  if (!choice.model.includes("/")) {
    return Result.fail(
      Errors.ModelUnavailable.make({
        model: choice.model,
        message: `model "${choice.model}" must be provider/model`,
      }),
    );
  }
  if (choice.fast !== undefined) {
    return Result.fail(
      Errors.ModelUnavailable.make({
        model: choice.model,
        message: `model "${choice.model}" has no fast mode`,
      }),
    );
  }
  return Result.succeed([
    "run",
    "--format",
    "json",
    "--model",
    choice.model,
    ...(choice.reasoning === undefined ? [] : ["--variant", choice.reasoning]),
  ]);
};

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const log = yield* Log.Log;
  // The runs live here, not in the request that spawned them: an agent works long after its
  // POST /agent was answered, and every one dies with the reverse proxy.
  const runs = yield* Effect.scope;

  if (!(yield* Process.commandExists(EXECUTABLE))) {
    return yield* Errors.HostRequirementsMissing.make({ missing: [`${EXECUTABLE} not on PATH`] });
  }

  const prompt = Effect.fn("OpenCode.prompt")(function* (text: string, choice: Domain.ModelChoice) {
    const argv = yield* Effect.fromResult(args(choice));
    const run = yield* Scope.fork(runs);
    return yield* Effect.gen(function* () {
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(EXECUTABLE, argv, {
            cwd: ROOT,
            // The prompt goes on stdin, which opencode reads whole when it is not a terminal:
            // argv has a size limit and shows in `ps`.
            stdin: Stream.make(encoder.encode(text)),
            stdout: "pipe",
            stderr: "pipe",
            extendEnv: true,
            killSignal: "SIGTERM",
            forceKillAfter: FORCE_KILL_AFTER,
          }),
        )
        .pipe(Effect.mapError((error) => failed(`opencode: ${Process.detail(error)}`, error)));
      const tail = yield* Ref.make("");
      const stderr = yield* Effect.forkScoped(
        handle.stderr.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) =>
            Ref.update(tail, (current) => `${current}${chunk}`.slice(-STDERR_TAIL_BYTES)),
          ),
          Effect.ignore,
        ),
        { startImmediately: true },
      );
      // Every line is read so the child never blocks on a full pipe; the first event is the one
      // waited on, and a line that is not an event (a share link, a warning) is read past.
      const first = yield* Deferred.make<Event>();
      yield* Effect.forkScoped(
        handle.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) =>
            Option.match(decodeEvent(line), {
              onNone: () => Effect.void,
              onSome: (event) => Effect.asVoid(Deferred.succeed(first, event)),
            }),
          ),
          Effect.ignore,
        ),
        { startImmediately: true },
      );
      const exited: Effect.Effect<number | null> = handle.exitCode.pipe(
        Effect.map((code): number | null => code),
        Effect.orElseSucceed((): number | null => null),
      );
      // Exit can fire before the piped stderr is fully drained: read the tail after the drain.
      const withTail = (message: string): Effect.Effect<string> =>
        Effect.gen(function* () {
          yield* Fiber.join(stderr);
          const said = (yield* Ref.get(tail)).trim();
          return said === "" ? message : `${message}: ${said}`;
        });
      const event = yield* Deferred.await(first).pipe(
        Effect.raceFirst(
          Effect.flatMap(exited, (code) =>
            Effect.flatMap(
              withTail(`opencode: exited ${String(code)} before its first event`),
              (message) => Effect.fail(failed(message)),
            ),
          ),
        ),
        Effect.timeoutOrElse({
          duration: SESSION_TIMEOUT,
          orElse: () => Effect.fail(failed(`opencode: no event within ${SESSION_TIMEOUT}`)),
        }),
      );
      if ("error" in event) {
        return yield* failed(`opencode: ${describeError(event.error)}`);
      }
      // The run is under way. It is watched out from the runs' scope, which outlives this request;
      // its own scope, and the child with it, is let go once it has exited.
      yield* Effect.forkIn(
        Effect.gen(function* () {
          const code = yield* exited;
          yield* code === 0
            ? log.info(`agent finished; ${event.sessionID}`)
            : log.error(
                yield* withTail(
                  `agent failed; ${event.sessionID}; exited ${code === null ? "on a signal" : String(code)}`,
                ),
              );
          yield* Scope.close(run, Exit.void);
        }),
        runs,
      );
      const started: Agents.Started = { agentId: event.sessionID };
      return started;
    }).pipe(
      Scope.provide(run),
      // A run refused before it had a session is stopped here; the spawner's release kills a
      // child still going and waits for it.
      Effect.tapError(() => Scope.close(run, Exit.void)),
    );
  });

  return Agents.Agents.of({ defaultModel: DEFAULT_MODEL, prompt });
});

export const layer: Layer.Layer<
  Agents.Agents,
  Errors.HostRequirementsMissing,
  ChildProcessSpawner.ChildProcessSpawner | Log.Log
> = Layer.effect(Agents.Agents)(make);
