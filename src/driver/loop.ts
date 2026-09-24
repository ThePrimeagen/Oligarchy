import { Clock, Duration, Effect, FileSystem, Redacted, Result, Stream } from "effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as HarnessConfig from "../harness/config.ts";
import * as History from "../harness/history.ts";
import * as Intent from "../harness/intent.ts";
import * as OpenRouter from "../harness/openrouter.ts";
import * as Stop from "../harness/stop.ts";
import * as Tools from "../harness/tools.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as Log from "./log.ts";

// The tool description is client.md. This only tells the model the harness owns intents.
const SYSTEM =
  "You drive one guest with the client tool. Call it with the action and its flags. Do not call intent; the harness opens and closes intents around each guest action. Stop calling the tool when the task is done.";

export type Input = {
  readonly model: string;
  readonly prompt: string;
  readonly testResultId: string;
  readonly debugLog: string;
  readonly config: HarnessConfig.AppConfig;
  readonly token: Redacted.Redacted;
};

export type Stopped = {
  readonly reason: "model-stopped" | "result-closed";
};

export type Failure =
  | Errors.CommandError
  | Errors.HistoryError
  | Errors.OpenRouterRefusal
  | Errors.OpenRouterUnreachable;

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

const remember = (
  history: History.History,
  toolCallId: string,
  content: string,
  exitCode: number | null,
): Effect.Effect<History.History, Errors.HistoryError> =>
  Effect.fromResult(History.recordToolResult(history, { toolCallId, content, exitCode }));

export const run = Effect.fn("Driver.run")(function* (input: Input) {
  const startedAt = yield* Clock.currentTimeMillis;
  let history = yield* Effect.fromResult(History.begin(SYSTEM, input.prompt));
  let resultClosed = false;
  let step = 0;

  while (true) {
    const now = yield* Clock.currentTimeMillis;
    const decision = Stop.decide({
      history,
      resultClosed,
      stepLimit: input.config.stepLimit,
      elapsed: Duration.millis(now - startedAt),
      ceiling: input.config.runCeiling,
    });
    if (decision._tag === "stop") {
      if (decision.reason === "model-stopped" || decision.reason === "result-closed") {
        yield* log(input.debugLog, step, "stop", decision.reason);
        return { reason: decision.reason } satisfies Stopped;
      }
      const message =
        decision.reason === "step-limit"
          ? `step limit of ${String(input.config.stepLimit)} reached`
          : `run ceiling of ${Duration.format(input.config.runCeiling)} passed`;
      yield* log(input.debugLog, step, "failure", message);
      return yield* Effect.fail(commandError(message));
    }

    step += 1;
    yield* log(input.debugLog, step, "request", input.model);
    const turn = yield* OpenRouter.complete({
      baseUrl: input.config.openRouterBaseUrl,
      token: input.token,
      model: input.model,
      messages: History.wire(history),
      tools: Tools.TOOLS,
      timeouts: input.config.timeouts,
      runCeiling: input.config.runCeiling,
      defaultRetry: input.config.harness.defaultRetry,
      startedAtMillis: startedAt,
    }).pipe(
      Effect.tapError((error) => log(input.debugLog, step, "failure", Render.headline(error))),
    );
    const calls = turn.toolCalls
      .map((call) => `${call.name} ${call.id} ${call.arguments}`)
      .join("\n");
    const said = turn.content ?? "";
    let assistant = said;
    if (said === "") {
      assistant = calls;
    } else if (calls !== "") {
      assistant = `${said}\n${calls}`;
    }
    yield* log(input.debugLog, step, "assistant", assistant);
    history = yield* Effect.fromResult(History.recordAssistant(history, turn));

    for (const call of turn.toolCalls) {
      const planned = Tools.commandLine(call);
      if (Result.isFailure(planned)) {
        yield* log(input.debugLog, step, "refusal", planned.failure.message);
        history = yield* remember(history, call.id, planned.failure.message, null);
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
        const sessionId = (started.stdout.split("\n")[0] ?? "").trim();
        let content = Tools.toolContent(started);
        let exitCode = started.exitCode;
        if (started.exitCode === 0 && sessionId !== "") {
          const markRunning = {
            bin: "./ctrl",
            args: [
              "test",
              "start",
              "--session-id",
              sessionId,
              "--test-result-id",
              input.testResultId,
              "--model",
              input.model,
            ],
          };
          yield* log(input.debugLog, step, "running", sessionId);
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
          if (marked.exitCode !== 0) {
            content = `${content}\n${Tools.toolContent(marked)}`;
            exitCode = marked.exitCode;
          }
        }
        history = yield* remember(history, call.id, content, exitCode);
        continue;
      }

      const message = Intent.intentMessage(turn.content, command.args);
      const bracketed = Intent.bracket(command, input.testResultId, message);
      if (Result.isFailure(bracketed)) {
        yield* log(input.debugLog, step, "refusal", bracketed.failure.message);
        history = yield* remember(history, call.id, bracketed.failure.message, null);
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
          history = yield* remember(history, call.id, Tools.toolContent(opened), opened.exitCode);
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
        const output =
          ended.exitCode === 0
            ? Tools.toolContent(ran)
            : `${Tools.toolContent(ran)}\nintent end failed\n${Tools.toolContent(ended)}`;
        const exitCode = ran.exitCode === 0 ? ended.exitCode : ran.exitCode;
        history = yield* remember(history, call.id, output, exitCode);
        continue;
      }

      const ran = yield* runCommand(command);
      yield* log(input.debugLog, step, "command", `${shown(command)} exit ${String(ran.exitCode)}`);
      history = yield* remember(history, call.id, Tools.toolContent(ran), ran.exitCode);
      if (Intent.closesResult(command, ran.exitCode)) {
        resultClosed = true;
        break;
      }
    }
  }
});
