import { Clock, Duration, Effect, FileSystem, Redacted, Result, Stream } from "effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as HarnessConfig from "../harness/config.ts";
import * as Intent from "../harness/intent.ts";
import * as OpenRouter from "../harness/openrouter.ts";
import * as Tools from "../harness/tools.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as Log from "./log.ts";
import * as Prompt from "./prompt.ts";
import * as Reply from "./reply.ts";

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

// The next ask keeps a short headline. A command can print a screenshot or a serial log.
const BRIEF = 500;

const brief = (text: string): string => {
  const lines: Array<string> = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    lines.push(trimmed);
    if (lines.length === 4) {
      break;
    }
  }
  const joined = lines.join(" / ");
  if (joined.length <= BRIEF) {
    return joined;
  }
  return joined.slice(0, BRIEF);
};

const decision = (did: string, outcome: string): string => {
  const rest = brief(outcome);
  if (rest === "" || rest === did) {
    return did;
  }
  return `${did}: ${rest}`;
};

const ask = (prompt: string, decisions: ReadonlyArray<string>): string => {
  if (decisions.length === 0) {
    return prompt;
  }
  return `${prompt}\n\n${decisions.join("\n")}`;
};

// save keeps a finished install. succeeded and completed are a passed drive.
// Anything else the session was stopped as is a failed result.
const verdictOf = (
  command: Tools.CommandLine,
): { readonly status: "success" | "failed"; readonly reason: string | undefined } => {
  const reason = Intent.flag(command.args, "reason");
  if (command.args[0] === "save") {
    return { status: "success", reason };
  }
  const status = Intent.flag(command.args, "status");
  if (status === "succeeded" || status === "completed") {
    return { status: "success", reason };
  }
  return { status: "failed", reason };
};

export const run = Effect.fn("Driver.run")(function* (input: Input) {
  const startedAt = yield* Clock.currentTimeMillis;
  const decisions: Array<string> = [];
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
    yield* log(input.debugLog, step, "request", input.model);
    const system = `${Prompt.text}\n\n${Tools.clientGuide}`;
    const turn = yield* OpenRouter.complete({
      baseUrl: input.config.openRouterBaseUrl,
      token: input.token,
      model: input.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: ask(input.prompt, decisions) },
      ],
      tools: [],
      timeouts: input.config.timeouts,
      runCeiling: input.config.runCeiling,
      defaultRetry: input.config.harness.defaultRetry,
      startedAtMillis: startedAt,
    }).pipe(
      Effect.tapError((error) => log(input.debugLog, step, "failure", Render.headline(error))),
    );
    yield* log(input.debugLog, step, "assistant", turn.content ?? "");
    const parsed = Reply.parse(turn.content ?? "");
    if (Result.isFailure(parsed)) {
      yield* log(input.debugLog, step, "failure", parsed.failure.message);
      return yield* Effect.fail(commandError(parsed.failure.message));
    }
    const reply = parsed.success;
    if (reply._tag === "Done") {
      yield* log(input.debugLog, step, "stop", "model-stopped");
      return { reason: "model-stopped" } satisfies Stopped;
    }

    turns = step;
    const planned = Reply.command(reply);
    if (Result.isFailure(planned)) {
      yield* log(input.debugLog, step, "refusal", planned.failure.message);
      decisions.push(decision(reply.reason, planned.failure.message));
      continue;
    }
    const command = planned.success;
    let outcome = "";

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
      outcome = Tools.toolContent(started);
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
          outcome = `${outcome}\n${Tools.toolContent(marked)}`;
        }
      }
      decisions.push(decision(reply.reason, outcome));
      continue;
    }

    const message = Intent.intentMessage(reply.reason, command.args);
    const bracketed = Intent.bracket(command, input.testResultId, message);
    if (Result.isFailure(bracketed)) {
      yield* log(input.debugLog, step, "refusal", bracketed.failure.message);
      decisions.push(decision(reply.reason, bracketed.failure.message));
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
        decisions.push(decision(reply.reason, Tools.toolContent(opened)));
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
      outcome =
        ended.exitCode === 0
          ? Tools.toolContent(ran)
          : `${Tools.toolContent(ran)}\nintent end failed\n${Tools.toolContent(ended)}`;
      decisions.push(decision(reply.reason, outcome));
      continue;
    }

    const ran = yield* runCommand(command);
    yield* log(input.debugLog, step, "command", `${shown(command)} exit ${String(ran.exitCode)}`);
    if (Intent.closesResult(command, ran.exitCode)) {
      // A drive or mint stop/save is the harness closing the result.
      const agent = Intent.flag(command.args, "agent-id");
      if (agent === undefined) {
        const missing = "client: closing the result needs --agent-id";
        yield* log(input.debugLog, step, "failure", missing);
        return yield* Effect.fail(commandError(missing));
      }
      const closed = verdictOf(command);
      const mark = {
        bin: "./ctrl",
        args: [
          "test-results",
          "--agent-id",
          agent,
          "--id",
          input.testResultId,
          "--status",
          closed.status,
          ...(closed.reason === undefined ? [] : ["--reason", closed.reason]),
        ],
      };
      const marked = yield* runCommand(mark);
      yield* log(input.debugLog, step, "command", `${shown(mark)} exit ${String(marked.exitCode)}`);
      if (marked.exitCode !== 0) {
        const printed = Tools.toolContent(marked);
        const reason = printed === "" ? "./ctrl test-results failed" : printed;
        yield* log(input.debugLog, step, "failure", reason);
        return yield* Effect.fail(commandError(reason));
      }
      yield* log(input.debugLog, step, "stop", "result-closed");
      return { reason: "result-closed" } satisfies Stopped;
    }
    decisions.push(decision(reply.reason, Tools.toolContent(ran)));
  }
});
