import { Clock, Duration, Effect, FileSystem, Redacted, Result, Stream } from "effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as Prompts from "../automation-server/prompts.ts";
import * as HarnessConfig from "../harness/config.ts";
import * as Intent from "../harness/intent.ts";
import * as OpenRouter from "../harness/openrouter.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as Log from "./log.ts";
import * as Reply from "./reply.ts";

export type Input = {
  readonly model: string;
  readonly definition: string;
  readonly proof: string;
  readonly testResultId: string;
  readonly debugLog: string;
  readonly agentId: string;
  readonly serverUrl: string;
  // Set when the guest is already up. A start that prints a session id replaces it.
  readonly sessionId: string | undefined;
  readonly config: HarnessConfig.AppConfig;
  readonly token: Redacted.Redacted;
};

export type Stopped = {
  readonly reason: "model-stopped" | "result-closed";
};

export type Failure = Errors.CommandError | Errors.OpenRouterRefusal | Errors.OpenRouterUnreachable;

type Ran = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

const detail = (error: unknown): string =>
  ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), Render.headline(error));

const commandError = (message: string): Errors.CommandError =>
  Errors.CommandError.make({ message });

const shown = (command: { readonly bin: string; readonly args: ReadonlyArray<string> }): string =>
  [command.bin, ...command.args.map((arg) => JSON.stringify(arg))].join(" ");

const log = Effect.fn("Driver.log")(function* (
  path: string,
  step: number,
  kind: Log.Kind,
  text: string,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .writeFileString(path, Log.line(Log.Event.make({ step, kind, text })), {
      flag: "a",
      mode: 0o644,
    })
    .pipe(Effect.mapError((error) => commandError(`debug log: ${detail(error)}`)));
});

const runCommand = Effect.fn("Driver.runCommand")(function* (command: {
  readonly bin: string;
  readonly args: ReadonlyArray<string>;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(command.bin, command.args, {
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            extendEnv: true,
          }),
        )
        .pipe(Effect.mapError((error) => commandError(`${command.bin}: ${detail(error)}`)));
      const stdout = Stream.mkString(Stream.decodeText(handle.stdout)).pipe(
        Effect.mapError((error) => commandError(`${command.bin}: ${detail(error)}`)),
      );
      const stderr = Stream.mkString(Stream.decodeText(handle.stderr)).pipe(
        Effect.mapError((error) => commandError(`${command.bin}: ${detail(error)}`)),
      );
      const exit = handle.exitCode.pipe(
        Effect.map((code) => ({ code, extra: "" })),
        Effect.catch((error) => Effect.succeed({ code: 1, extra: `${detail(error)}\n` })),
      );
      const [out, err, status] = yield* Effect.all([stdout, stderr, exit], {
        concurrency: "unbounded",
      });
      return {
        exitCode: status.code,
        stdout: out,
        stderr: status.extra === "" ? err : `${status.extra}${err}`,
      } satisfies Ran;
    }),
  );
});

export const run = Effect.fn("Driver.run")(function* (input: Input) {
  const startedAt = yield* Clock.currentTimeMillis;
  const reasons: Array<string> = [];
  let sessionId = input.sessionId;
  let turns = 0;

  while (true) {
    const now = yield* Clock.currentTimeMillis;
    if (turns >= input.config.stepLimit) {
      const message = `step limit of ${String(input.config.stepLimit)} reached`;
      yield* log(input.debugLog, turns, "failure", message);
      return yield* Effect.fail(commandError(message));
    }
    if (Duration.Order(Duration.millis(now - startedAt), input.config.runCeiling) >= 0) {
      const message = `run ceiling of ${Duration.format(input.config.runCeiling)} passed`;
      yield* log(input.debugLog, turns, "failure", message);
      return yield* Effect.fail(commandError(message));
    }

    const step = turns + 1;
    const prompt = yield* Prompts.openRouterDrive(
      input.definition,
      input.proof,
      reasons,
      step,
    ).pipe(Effect.mapError((error) => commandError(error.message)));
    yield* log(input.debugLog, step, "request", input.model);
    const turn = yield* OpenRouter.complete({
      baseUrl: input.config.openRouterBaseUrl,
      token: input.token,
      model: input.model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: "Take this step." },
      ],
      tools: [Reply.TOOL],
      toolChoice: { type: "function", function: { name: "drive" } },
      timeouts: input.config.timeouts,
      runCeiling: input.config.runCeiling,
      defaultRetry: input.config.harness.defaultRetry,
      startedAtMillis: startedAt,
    }).pipe(
      Effect.tapError((error) => log(input.debugLog, step, "failure", Render.headline(error))),
    );
    const call = turn.toolCalls.length === 1 ? turn.toolCalls[0] : undefined;
    yield* log(input.debugLog, step, "assistant", call?.arguments ?? turn.content ?? "");
    if (call === undefined) {
      const message = "reply: expected one drive call";
      yield* log(input.debugLog, step, "failure", message);
      return yield* Effect.fail(commandError(message));
    }
    const parsed = Reply.parse(call);
    if (Result.isFailure(parsed)) {
      yield* log(input.debugLog, step, "failure", parsed.failure.message);
      return yield* Effect.fail(commandError(parsed.failure.message));
    }
    const reply = parsed.success;
    if (reply.completes) {
      yield* log(input.debugLog, step, "stop", "model-stopped");
      return { reason: "model-stopped" } satisfies Stopped;
    }

    turns = step;
    // The action runs nothing. The loop goes to the next step.
    if (reply.action._tag === "update_screenshot") {
      reasons.push(reply.reason);
      continue;
    }
    const planned = Reply.command(reply.action, {
      agentId: input.agentId,
      serverUrl: input.serverUrl,
      sessionId,
    });
    if (Result.isFailure(planned)) {
      yield* log(input.debugLog, step, "refusal", planned.failure.message);
      reasons.push(reply.reason);
      continue;
    }
    const command = planned.success;

    if (command.args[0] === "start") {
      const routing = Intent.flag(command.args, "server-url");
      const noted = [
        shown(command),
        ...(command.args.includes("--resume") ? ["resume"] : []),
        ...(routing === undefined ? [] : [`routing ${routing}`]),
      ].join(" ");
      yield* log(input.debugLog, step, "start", noted);
      const started = yield* runCommand(command);
      yield* log(
        input.debugLog,
        step,
        "command",
        `${shown(command)} exit ${String(started.exitCode)}`,
      );
      const printed = (started.stdout.split("\n")[0] ?? "").trim();
      if (started.exitCode === 0 && printed !== "") {
        sessionId = printed;
        const markRunning = {
          bin: "./ctrl",
          args: [
            "test",
            "start",
            "--session-id",
            printed,
            "--test-result-id",
            input.testResultId,
            "--model",
            input.model,
          ],
        };
        yield* log(input.debugLog, step, "running", printed);
        const marked = yield* runCommand(markRunning).pipe(
          Effect.catchTag("CommandError", (error) =>
            Effect.succeed({ exitCode: 1, stdout: "", stderr: `${error.message}\n` }),
          ),
        );
        yield* log(
          input.debugLog,
          step,
          "command",
          `${shown(markRunning)} exit ${String(marked.exitCode)}`,
        );
      }
      reasons.push(reply.reason);
      continue;
    }

    const message = Intent.intentMessage(reply.reason, command.args);
    const bracketed = Intent.bracket(command, input.testResultId, message);
    if (Result.isFailure(bracketed)) {
      yield* log(input.debugLog, step, "refusal", bracketed.failure.message);
      reasons.push(reply.reason);
      continue;
    }

    if (bracketed.success._tag === "guest") {
      yield* log(input.debugLog, step, "intent", message);
      const opened = yield* runCommand(bracketed.success.start);
      yield* log(
        input.debugLog,
        step,
        "command",
        `${shown(bracketed.success.start)} exit ${String(opened.exitCode)}`,
      );
      if (opened.exitCode !== 0) {
        reasons.push(reply.reason);
        continue;
      }
      // A spawn or log failure still has to close the intent this start opened.
      const closeIntent = runCommand(bracketed.success.end).pipe(Effect.ignore);
      const ran = yield* runCommand(command).pipe(Effect.tapError(() => closeIntent));
      yield* log(
        input.debugLog,
        step,
        "command",
        `${shown(command)} exit ${String(ran.exitCode)}`,
      ).pipe(Effect.tapError(() => closeIntent));
      const ended = yield* runCommand(bracketed.success.end);
      yield* log(
        input.debugLog,
        step,
        "command",
        `${shown(bracketed.success.end)} exit ${String(ended.exitCode)}`,
      );
      reasons.push(reply.reason);
      continue;
    }

    const ran = yield* runCommand(command);
    yield* log(input.debugLog, step, "command", `${shown(command)} exit ${String(ran.exitCode)}`);
    if (Intent.closesResult(command, ran.exitCode)) {
      yield* log(input.debugLog, step, "stop", "result-closed");
      return { reason: "result-closed" } satisfies Stopped;
    }
    // relinquish stops the guest. The id it printed is no longer a session.
    if (command.args[0] === "relinquish" && ran.exitCode === 0) {
      sessionId = undefined;
    }
    reasons.push(reply.reason);
  }
});
