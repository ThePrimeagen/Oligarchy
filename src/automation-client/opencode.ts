import { Effect, FileSystem, Layer, Option, Path, Redacted, Ref, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as Config from "../config.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as Events from "./events.ts";
import * as Runner from "./runner.ts";

export const BIN = "opencode";
// Pinned by S1 against `opencode models` on the host: the contributor tier of Muse Spark 1.3.
export const MODEL = "opencode/muse-spark-1.3-contributor-free";
const SHIMS = ["client", "client-with-image", "ctrl", "session"] as const;
const STDERR_TAIL_BYTES = 4096;
// Releasing the scope waits for the exit; an opencode that ignores SIGTERM must not wedge a
// timeout or a shutdown behind it.
const FORCE_KILL_AFTER = "5 seconds";

const OPENCODE_JSON = JSON.stringify({
  permission: {
    bash: {
      "*": "deny",
      "./client*": "allow",
      "./client-with-image*": "allow",
      "./ctrl*": "allow",
      "./session*": "allow",
      "sleep*": "allow",
    },
    edit: "deny",
    write: "deny",
    webfetch: "deny",
    read: "allow",
  },
});

const encoder = new TextEncoder();

const detail = (error: unknown): string =>
  ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), Render.errorDetail(error));

const failed = (input: Runner.RunInput, message: string, cause?: unknown): Errors.RunFailed =>
  cause === undefined
    ? Errors.RunFailed.make({ message, agentId: input.key })
    : Errors.RunFailed.make({ message, agentId: input.key, cause });

export const layer: Layer.Layer<
  Runner.AgentRunner,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path | Config.ProxyConfig
> = Layer.effect(Runner.AgentRunner)(
  Effect.gen(function* () {
    const spawn = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* Config.ProxyConfig;
    return Runner.AgentRunner.of({
      name: "opencode",
      model: MODEL,
      run: Effect.fn("OpenCode.run")(function* (input: Runner.RunInput) {
        const dir = yield* fs
          .makeTempDirectoryScoped({ prefix: "oligarchy-run-" })
          .pipe(Effect.mapError((error) => failed(input, `opencode: ${detail(error)}`, error)));
        const repo = path.resolve(import.meta.dirname, "../..");
        for (const name of SHIMS) {
          yield* fs
            .writeFileString(path.join(dir, name), `#!/bin/sh\nexec "${repo}/${name}" "$@"\n`, {
              mode: 0o700,
            })
            .pipe(Effect.mapError((error) => failed(input, `opencode: ${detail(error)}`, error)));
        }
        yield* fs
          .writeFileString(path.join(dir, "opencode.json"), OPENCODE_JSON, { mode: 0o600 })
          .pipe(Effect.mapError((error) => failed(input, `opencode: ${detail(error)}`, error)));
        const handle = yield* spawn
          .spawn(
            ChildProcess.make(BIN, ["run", "--model", MODEL, "--format", "json"], {
              cwd: dir,
              env: {
                OLIGARCHY_TOKEN: Redacted.value(config.token),
                DATABASE_URL: Redacted.value(config.databaseUrl),
                OLIGARCHY_MODEL: MODEL,
              },
              extendEnv: true,
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
              detached: false,
              killSignal: "SIGTERM",
              forceKillAfter: FORCE_KILL_AFTER,
            }),
          )
          .pipe(Effect.mapError((error) => failed(input, `opencode: ${detail(error)}`, error)));
        const events = yield* Ref.make(Events.empty);
        const tail = yield* Ref.make("");
        // The prompt goes in, both pipes are drained to their end, and the exit is awaited, all at
        // once: the pipes end when the child does, so everything it wrote is in the fold and the
        // tail before the verdict is read. A pipe that breaks fails the run then and there; a
        // signal death is an answer, not a failure, and is judged below.
        const [exited] = yield* Effect.all(
          [
            handle.exitCode.pipe(
              Effect.map(Result.succeed),
              Effect.catch((error) => Effect.succeed(Result.fail(error))),
            ),
            Stream.run(Stream.make(encoder.encode(input.prompt)), handle.stdin),
            handle.stdout.pipe(
              Stream.decodeText(),
              Stream.splitLines,
              Stream.runForEach((line) => Ref.update(events, (state) => Events.fold(state, line))),
            ),
            handle.stderr.pipe(
              Stream.decodeText(),
              Stream.runForEach((text) =>
                Ref.update(tail, (current) => `${current}${text}`.slice(-STDERR_TAIL_BYTES)),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.mapError((error) => failed(input, `opencode: ${detail(error)}`, error)));
        if (Result.isFailure(exited)) {
          return yield* failed(input, `opencode: ${detail(exited.failure)}`, exited.failure);
        }
        const state = yield* Ref.get(events);
        const code = exited.success;
        if (code === 0) {
          if (Option.isNone(state.session)) {
            return yield* failed(input, "opencode: exited 0 without a session");
          }
          return { session: state.session.value, text: state.text } satisfies Runner.RunOutcome;
        }
        const stderr = (yield* Ref.get(tail)).trim();
        const reason = Option.getOrElse(state.error, () => (stderr === "" ? "no output" : stderr));
        return yield* failed(input, `opencode: exited ${String(code)}: ${reason}`);
      }),
    });
  }),
);
