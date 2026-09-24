import {
  Cause,
  Clock,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Option,
  Redacted,
  Result,
  Stream,
} from "effect";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as Tests from "../db/tests.ts";
import * as HarnessConfig from "../harness/config.ts";
import * as Intent from "../harness/intent.ts";
import * as OpenRouter from "../harness/openrouter.ts";
import * as Tools from "../harness/tools.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as Client from "./client.ts";
import * as Log from "./log.ts";
import * as Prompt from "./prompt.ts";
import * as Reply from "./reply.ts";

export type Input = {
  readonly model: string;
  readonly prompt: string;
  readonly agentId: string;
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

// The agent id is the ticket on the result. Definition, proof, iso, server, and whether
// start resumes are that row's, not fields a caller passes in.
type Loaded = {
  readonly resultId: string;
  readonly instruction: string;
  readonly proof: string;
  readonly iso: string;
  readonly serverUrl: string;
  readonly resume: boolean;
  readonly mint: boolean;
};

const stored = <A>(
  effect: Effect.Effect<A, Errors.DatabaseError>,
): Effect.Effect<A, Errors.CommandError> =>
  effect.pipe(Effect.mapError((error) => commandError(error.message)));

const loadRun = Effect.fn("Driver.loadRun")(function* (agentId: string) {
  const tests = yield* Tests.TestStore;
  const found = yield* stored(tests.findResultByLinearId(agentId));
  if (Option.isNone(found)) {
    return yield* Effect.fail(commandError(`no result for ${agentId}`));
  }
  const resultId = found.value.id;
  const facts = yield* stored(tests.driveFacts(resultId));
  if (Option.isNone(facts)) {
    return yield* Effect.fail(commandError(`no definition for ${agentId}`));
  }
  const resume = yield* stored(tests.resumeIso(resultId));
  return {
    resultId,
    instruction: facts.value.instruction,
    proof: facts.value.proof,
    iso: facts.value.iso,
    serverUrl: facts.value.serverUrl,
    resume: Option.isSome(resume),
    mint: facts.value.name === "mint",
  } satisfies Loaded;
});

const HARNESS_OWNED = new Set(["start", "stop", "save"]);

export const run = Effect.fn("Driver.run")(function* (input: Input) {
  const startedAt = yield* Clock.currentTimeMillis;
  const facts = yield* loadRun(input.agentId);
  const decisions: Array<string> = [];
  let turns = 0;

  // acquireUseRelease keeps the stop uninterruptible: an interrupt during the model
  // loop still stops the session start already opened. A start that never prints an id
  // fails the acquire, so nothing is stopped.
  yield* Effect.acquireUseRelease(
    Effect.gen(function* () {
      const stamped = Intent.owned(
        ["start", "--iso", facts.iso, ...(facts.resume ? ["--resume"] : [])],
        { agentId: input.agentId, serverUrl: facts.serverUrl, sessionId: "" },
      );
      if (Result.isFailure(stamped)) {
        return yield* Effect.fail(commandError(stamped.failure.message));
      }
      const command = {
        bin: "./client",
        args: stamped.success,
      } satisfies Tools.CommandLine;
      const routing = Intent.flag(command.args, "server-url");
      const noted = [
        shown(command),
        ...(command.args.includes("--resume") ? ["resume"] : []),
        ...(routing === undefined ? [] : [`routing ${routing}`]),
      ].join(" ");
      // Logged before the guest boots, so a log that cannot be written starts nothing.
      yield* log(input.debugLog, 0, "start", noted);
      const started = yield* Client.run(command);
      const sessionId = (started.stdout.split("\n")[0] ?? "").trim();
      if (started.exitCode !== 0 || sessionId === "") {
        yield* log(
          input.debugLog,
          0,
          "command",
          `${shown(command)} exit ${String(started.exitCode)}`,
        );
        const printed = Tools.toolContent(started);
        const message = printed === "" ? "start failed" : printed;
        yield* log(input.debugLog, 0, "failure", message);
        return yield* Effect.fail(commandError(message));
      }
      // The id is the resource. The exit log is the use, so a log failure still stops.
      return { sessionId, command, started };
    }),
    (booted) =>
      Effect.gen(function* () {
        const sessionId = booted.sessionId;
        yield* log(
          input.debugLog,
          0,
          "command",
          `${shown(booted.command)} exit ${String(booted.started.exitCode)}`,
        );
        const markRunning = {
          bin: "./ctrl",
          args: [
            "test",
            "start",
            "--session-id",
            sessionId,
            "--test-result-id",
            facts.resultId,
            "--model",
            input.model,
          ],
        };
        yield* log(input.debugLog, 0, "running", sessionId);
        const marked = yield* runCommand(markRunning).pipe(
          Effect.catchTag("CommandError", (error) =>
            Effect.succeed({ exitCode: 1, stdout: "", stderr: `${error.message}\n` }),
          ),
        );
        yield* log(
          input.debugLog,
          0,
          "command",
          `${shown(markRunning)} exit ${String(marked.exitCode)}`,
        );
        if (marked.exitCode !== 0) {
          decisions.push(decision("start", Tools.toolContent(marked)));
        }

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
          const reasons = decisions.length === 0 ? "none" : decisions.join("\n");
          const system = Prompt.render({
            TEST_DEFINITION: facts.instruction,
            TEST_PROOF: facts.proof,
            STEP: String(step),
            REASONS: reasons,
            CLIENT_TOOLS: Tools.clientGuide.trimEnd(),
          });
          yield* log(input.debugLog, step, "request", input.model);
          const turn = yield* OpenRouter.complete({
            baseUrl: input.config.openRouterBaseUrl,
            token: input.token,
            model: input.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: input.prompt },
            ],
            tools: [],
            timeouts: input.config.timeouts,
            runCeiling: input.config.runCeiling,
            defaultRetry: input.config.harness.defaultRetry,
            startedAtMillis: startedAt,
          }).pipe(
            Effect.tapError((error) =>
              log(input.debugLog, step, "failure", Render.headline(error)),
            ),
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

          const planned = Reply.command(reply);
          if (Result.isFailure(planned)) {
            yield* log(input.debugLog, step, "refusal", planned.failure.message);
            decisions.push(decision(reply.reason, planned.failure.message));
            continue;
          }
          if (HARNESS_OWNED.has(planned.success.args[0] ?? "")) {
            const message = "client: the harness starts and stops the session";
            yield* log(input.debugLog, step, "refusal", message);
            decisions.push(decision(reply.reason, message));
            continue;
          }
          turns = step;
          const owned = Intent.owned(planned.success.args, {
            agentId: input.agentId,
            serverUrl: facts.serverUrl,
            sessionId,
          });
          if (Result.isFailure(owned)) {
            yield* log(input.debugLog, step, "refusal", owned.failure.message);
            decisions.push(decision(reply.reason, owned.failure.message));
            continue;
          }
          const guest = { bin: planned.success.bin, args: owned.success };
          let outcomeText = "";

          const message = Intent.intentMessage(reply.reason, guest.args);
          const bracketed = Intent.bracket(guest, facts.resultId, message);
          if (Result.isFailure(bracketed)) {
            yield* log(input.debugLog, step, "refusal", bracketed.failure.message);
            decisions.push(decision(reply.reason, bracketed.failure.message));
            continue;
          }

          if (bracketed.success._tag === "guest") {
            yield* log(input.debugLog, step, "intent", message);
            const opened = yield* Client.run(bracketed.success.start);
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
            // A log failure still has to close the intent this start opened.
            const closeIntent = Client.run(bracketed.success.end).pipe(Effect.ignore);
            const ran = yield* Client.run(guest);
            yield* log(
              input.debugLog,
              step,
              "command",
              `${shown(guest)} exit ${String(ran.exitCode)}`,
            ).pipe(Effect.tapError(() => closeIntent));
            const ended = yield* Client.run(bracketed.success.end);
            yield* log(
              input.debugLog,
              step,
              "command",
              `${shown(bracketed.success.end)} exit ${String(ended.exitCode)}`,
            );
            outcomeText =
              ended.exitCode === 0
                ? Tools.toolContent(ran)
                : `${Tools.toolContent(ran)}\nintent end failed\n${Tools.toolContent(ended)}`;
            decisions.push(decision(reply.reason, outcomeText));
            continue;
          }

          const ran = yield* Client.run(guest);
          yield* log(
            input.debugLog,
            step,
            "command",
            `${shown(guest)} exit ${String(ran.exitCode)}`,
          );
          decisions.push(decision(reply.reason, Tools.toolContent(ran)));
        }
      }),
    (booted, exit) =>
      Effect.gen(function* () {
        const failed = Exit.isFailure(exit);
        const reason = failed ? Render.headline(Cause.squash(exit.cause)) : undefined;
        const save = !failed && facts.mint;
        const endArgs = save
          ? ["save"]
          : [
              "stop",
              "--status",
              failed ? "failed" : "succeeded",
              ...(reason === undefined || reason === "" ? [] : ["--reason", reason]),
            ];
        const stamped = Intent.owned(endArgs, {
          agentId: input.agentId,
          serverUrl: facts.serverUrl,
          sessionId: booted.sessionId,
        });
        const stopGuest = Effect.gen(function* () {
          if (Result.isFailure(stamped)) {
            return yield* Effect.fail(commandError(stamped.failure.message));
          }
          const command = {
            bin: "./client",
            args: stamped.success,
          } satisfies Tools.CommandLine;
          const ran = yield* Client.run(command);
          yield* log(
            input.debugLog,
            0,
            "command",
            `${shown(command)} exit ${String(ran.exitCode)}`,
          );
          if (ran.exitCode !== 0) {
            const printed = Tools.toolContent(ran);
            return yield* Effect.fail(commandError(printed === "" ? "stop failed" : printed));
          }
          return yield* Effect.void;
        });
        const closeResult = Effect.gen(function* () {
          const mark = {
            bin: "./ctrl",
            args: [
              "test-results",
              "--agent-id",
              input.agentId,
              "--id",
              facts.resultId,
              "--status",
              failed ? "failed" : "success",
              ...(reason === undefined || reason === "" ? [] : ["--reason", reason]),
            ],
          };
          const marked = yield* runCommand(mark);
          yield* log(
            input.debugLog,
            0,
            "command",
            `${shown(mark)} exit ${String(marked.exitCode)}`,
          );
          if (marked.exitCode !== 0) {
            const printed = Tools.toolContent(marked);
            return yield* Effect.fail(
              commandError(printed === "" ? "./ctrl test-results failed" : printed),
            );
          }
          return yield* Effect.void;
        });
        if (failed) {
          // The run already failed. Cleanup failures are logged and do not replace that reason.
          // The result is still closed when the guest stop itself fails.
          const stopped = yield* Effect.exit(stopGuest);
          if (Exit.isFailure(stopped)) {
            yield* log(
              input.debugLog,
              0,
              "failure",
              `stop: ${Render.headline(Cause.squash(stopped.cause))}`,
            ).pipe(Effect.ignore);
          }
          const closed = yield* Effect.exit(closeResult);
          if (Exit.isFailure(closed)) {
            yield* log(
              input.debugLog,
              0,
              "failure",
              `test-results: ${Render.headline(Cause.squash(closed.cause))}`,
            ).pipe(Effect.ignore);
          }
          if (Exit.isSuccess(stopped)) {
            yield* log(input.debugLog, 0, "stop", "session-stopped").pipe(Effect.ignore);
          }
          return;
        }
        yield* stopGuest;
        yield* closeResult;
        yield* log(input.debugLog, 0, "stop", "result-closed");
      }),
  );
  return { reason: "result-closed" } satisfies Stopped;
});
