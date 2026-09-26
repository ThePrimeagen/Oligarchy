import {
  Cause,
  Clock,
  Config as EffectConfig,
  Console,
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
import * as DbErrors from "@oligarchy/db/errors";
import * as Tests from "@oligarchy/db/tests";
import * as Config from "@oligarchy/env/config";
import * as EnvErrors from "@oligarchy/env/errors";
import * as Oligarchy from "@oligarchy/env/oligarchy";
import type * as ProxyClient from "@oligarchy/http/proxy-client";
import * as ExternalFailure from "@oligarchy/log/external-failure";
import * as Render from "@oligarchy/log/render";
import * as SharedErrors from "@oligarchy/shared/errors";
import * as Steps from "@oligarchy/shared/steps";
import * as Actions from "../client/actions.ts";
import * as Intent from "../harness/intent.ts";
import * as OpenRouter from "../harness/openrouter.ts";
import * as Pointer from "../harness/pointer.ts";
import * as Tools from "../harness/tools.ts";
import * as Errors from "../harness/errors.ts";
import * as Client from "./client.ts";
import * as Log from "./log.ts";
import * as Prompt from "./prompt.ts";
import * as Reply from "./reply.ts";

export type Input = {
  readonly model: string;
  readonly prompt: string;
  readonly agentId: string;
  readonly debugLog: string;
  readonly config: Oligarchy.AppConfig;
  readonly token: Redacted.Redacted;
  readonly reasoning: Oligarchy.Effort;
};

export type Stopped = {
  readonly reason: "model-stopped" | "machine-off" | "result-closed";
};

export type Failure =
  | SharedErrors.CommandError
  | Errors.OpenRouterRefusal
  | Errors.OpenRouterUnreachable;

type Ran = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

const detail = (error: unknown): string =>
  ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), Render.headline(error));

const commandError = (message: string): SharedErrors.CommandError =>
  SharedErrors.CommandError.make({ message });

const shown = (command: { readonly bin: string; readonly args: ReadonlyArray<string> }): string =>
  [command.bin, ...command.args.map((arg) => JSON.stringify(arg))].join(" ");

const log = Effect.fn("Driver.log")(function* (
  to: { readonly debugLog: string; readonly agentId: string },
  step: number,
  kind: Log.Kind,
  text: string,
) {
  const event = Log.Event.make({ step, kind, text });
  yield* Console.log(Log.printed(to.agentId, event));
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .writeFileString(to.debugLog, Log.line(event), {
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

const firstLine = (output: string): string =>
  output
    .split("\n")
    .find((line) => line.trim() !== "")
    ?.trim() ?? "";

// The qemu server no longer has the session: every later command answers the same, so there is
// nothing left for the model to try.
const sessionGone = (output: string): string | undefined => {
  const headline = firstLine(output);
  return headline.startsWith("unknown session") ? headline : undefined;
};

// Three in a row: the model cannot answer in the tool's shape, and asking again only spends
// the run. A command that reaches the guest, even one the guest refuses, starts the count again.
const BAD_REPLY_LIMIT = 3;
// Each bad reply is quoted in the failure, which is the result's reason: a model can answer
// with a page of prose.
const QUOTED_REPLY = 200;

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
  effect: Effect.Effect<A, DbErrors.DatabaseError>,
): Effect.Effect<A, SharedErrors.CommandError> =>
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
  // The bad replies since the last command that reached the guest, each with its reason.
  let misses: Array<string> = [];
  // The model is asked fresh each turn, so it sees what it answered last, as it wrote it.
  let lastResponse: Option.Option<string> = Option.none();
  // The last get-image's PNG. Any other guest action may change the screen, so it drops it.
  let screen: Uint8Array | undefined;
  // The last action other than get-image that succeeded: what a screenshot shows the result of.
  let previous: Option.Option<ReadonlyArray<string>> = Option.none();
  // Where the last mouse action that succeeded left the pointer. A click presses there.
  let pointer: Option.Option<Pointer.Point> = Option.none();
  // A mint's image failed: the guest is off. The model gets one turn to call Done.
  let machineOff = false;
  // Step N's intent is the Nth ActionList line. Step 1 opens with the session, and only a reply
  // naming another step ends it and opens that one; the stop or save closes the last.
  const steps = Steps.stepsOf(facts.instruction);
  let step = 1;
  // Not while that step's intent start has failed.
  let intentOpen = false;
  // A run with no stored server leaves --server-url off its commands, so the client uses
  // SERVER_URL or its default; the intents go to that same server.
  const serverUrl =
    facts.serverUrl !== ""
      ? facts.serverUrl
      : yield* Config.serverUrl.pipe(
          EffectConfig.withDefault(Config.DEFAULT_SERVER_URL),
          Effect.mapError((error) => commandError(`SERVER_URL: ${Render.headline(error)}`)),
        );

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
      yield* log(input, 0, "start", noted);
      const started = yield* Client.run(command);
      const sessionId = (started.stdout.split("\n")[0] ?? "").trim();
      if (started.exitCode !== 0 || sessionId === "") {
        yield* log(input, 0, "command", `${shown(command)} exit ${String(started.exitCode)}`);
        const printed = Tools.toolContent(started);
        const message = printed === "" ? "start failed" : printed;
        yield* log(input, 0, "failure", message);
        return yield* Effect.fail(commandError(message));
      }
      // The id is the resource. The exit log is the use, so a log failure still stops.
      return { sessionId, command, started };
    }),
    (booted) =>
      Effect.gen(function* () {
        const sessionId = booted.sessionId;
        yield* log(
          input,
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
        yield* log(input, 0, "running", sessionId);
        const marked = yield* runCommand(markRunning).pipe(
          Effect.catchTag("CommandError", (error) =>
            Effect.succeed({ exitCode: 1, stdout: "", stderr: `${error.message}\n` }),
          ),
        );
        yield* log(input, 0, "command", `${shown(markRunning)} exit ${String(marked.exitCode)}`);
        if (marked.exitCode !== 0) {
          decisions.push(decision("start", Tools.toolContent(marked)));
        }

        const held = { agentId: input.agentId, serverUrl, sessionId };
        const failure = Effect.match({
          onFailure: (error: EnvErrors.MissingVariable | ProxyClient.Failure) =>
            Render.headline(error),
          onSuccess: () => undefined,
        });

        const endStep = Effect.fn("Driver.endStep")(function* (turn: number) {
          if (!intentOpen) {
            return undefined;
          }
          intentOpen = false;
          const failed = yield* failure(Actions.intentEnd(held));
          yield* log(input, turn, "command", `intent end ${failed ?? "ok"}`);
          return failed === undefined
            ? undefined
            : decision(`step ${String(step)}`, `intent end failed\n${failed}`);
        });

        // The failure text when the intent did not open, so no guest action runs outside one.
        const openStep = Effect.fn("Driver.openStep")(function* (turn: number) {
          const message = steps[step - 1] ?? `step ${String(step)}`;
          yield* log(input, turn, "intent", message);
          const failed = yield* failure(
            Actions.intentStart({ ...held, testResultId: facts.resultId, message }),
          );
          yield* log(input, turn, "command", `intent start ${failed ?? "ok"}`);
          if (failed === undefined) {
            intentOpen = true;
            return undefined;
          }
          const gone = sessionGone(failed);
          if (gone !== undefined) {
            yield* log(input, turn, "failure", gone);
            return yield* Effect.fail(commandError(gone));
          }
          return failed;
        });

        const miss = Effect.fn("Driver.miss")(function* (turn: number, why: string, reply: string) {
          misses.push(`${why} (replied ${brief(reply).slice(0, QUOTED_REPLY)})`);
          if (misses.length < BAD_REPLY_LIMIT) {
            return yield* Effect.void;
          }
          const message = `model could not respond correctly: ${String(BAD_REPLY_LIMIT)} bad replies in a row: ${misses.join("; ")}`;
          yield* log(input, turn, "failure", message);
          return yield* Effect.fail(commandError(message));
        });

        const first = yield* openStep(0);
        if (first !== undefined) {
          decisions.push(decision("step 1", first));
        }

        while (true) {
          const now = yield* Clock.currentTimeMillis;
          if (turns >= input.config.stepLimit) {
            const message = `step limit of ${String(input.config.stepLimit)} reached`;
            yield* log(input, turns, "failure", message);
            return yield* Effect.fail(commandError(message));
          }
          if (Duration.Order(Duration.millis(now - startedAt), input.config.runCeiling) >= 0) {
            const message = `run ceiling of ${Duration.format(input.config.runCeiling)} passed`;
            yield* log(input, turns, "failure", message);
            return yield* Effect.fail(commandError(message));
          }

          const turn = turns + 1;
          const reasons = decisions.length === 0 ? "none" : decisions.join("\n");
          const system = Prompt.render({
            TEST_DEFINITION: facts.instruction,
            TEST_PROOF: facts.proof,
            REASONS: reasons,
            CLIENT_TOOLS: Tools.clientGuide.trimEnd(),
            RESPONSE: lastResponse,
            PREVIOUS: screen === undefined ? Option.none() : previous,
          });
          yield* log(input, turn, "request", input.model);
          const answer = yield* OpenRouter.complete({
            baseUrl: input.config.openRouterBaseUrl,
            token: input.token,
            model: input.model,
            messages: [
              { role: "system", content: system },
              {
                role: "user",
                content:
                  screen === undefined
                    ? input.prompt
                    : [
                        { type: "text", text: input.prompt },
                        {
                          type: "image_url",
                          image_url: {
                            url: `data:image/png;base64,${Buffer.from(screen).toString("base64")}`,
                          },
                        },
                      ],
              },
            ],
            tools: [],
            reasoning: input.reasoning,
            timeouts: input.config.timeouts,
            runCeiling: input.config.runCeiling,
            defaultRetry: input.config.harness.defaultRetry,
            startedAtMillis: startedAt,
          }).pipe(Effect.tapError((error) => log(input, turn, "failure", Render.headline(error))));
          const text = answer.content ?? "";
          yield* log(input, turn, "assistant", text);
          lastResponse = Option.some(text);
          const parsed = Reply.parse(text);
          if (Result.isFailure(parsed)) {
            // Nothing is left to drive, so any reply ends it, as Done would.
            if (machineOff) {
              yield* log(input, turn, "stop", "machine-off");
              return { reason: "machine-off" } satisfies Stopped;
            }
            const why = parsed.failure.message;
            yield* log(input, turn, "refusal", why);
            decisions.push(decision("reply refused", `${why}: ${text}`));
            yield* miss(turn, why, text);
            continue;
          }
          const reply = parsed.success;
          if (reply._tag === "Done") {
            yield* log(input, turn, "stop", "model-stopped");
            return { reason: "model-stopped" } satisfies Stopped;
          }
          if (machineOff) {
            yield* log(input, turn, "stop", "machine-off");
            return { reason: "machine-off" } satisfies Stopped;
          }

          // The model is asked fresh each turn, so the past steps carry the number it repeats.
          const said = `step ${String(reply.step)}: ${reply.reason}`;
          const planned = Reply.command(reply);
          if (Result.isFailure(planned)) {
            yield* log(input, turn, "refusal", planned.failure.message);
            decisions.push(decision(said, planned.failure.message));
            yield* miss(turn, planned.failure.message, text);
            continue;
          }
          if (HARNESS_OWNED.has(planned.success.args[0] ?? "")) {
            const message = "client: the harness starts and stops the session";
            yield* log(input, turn, "refusal", message);
            decisions.push(decision(said, message));
            yield* miss(turn, message, text);
            continue;
          }
          turns = turn;
          const owned = Intent.owned(planned.success.args, {
            agentId: input.agentId,
            serverUrl: facts.serverUrl,
            sessionId,
          });
          if (Result.isFailure(owned)) {
            yield* log(input, turn, "refusal", owned.failure.message);
            decisions.push(decision(said, owned.failure.message));
            yield* miss(turn, owned.failure.message, text);
            continue;
          }
          const pointed = Pointer.placed(owned.success, pointer);
          if (Result.isFailure(pointed)) {
            yield* log(input, turn, "refusal", pointed.failure.message);
            decisions.push(decision(said, pointed.failure.message));
            yield* miss(turn, pointed.failure.message, text);
            continue;
          }
          const guest = { bin: planned.success.bin, args: pointed.success };

          if (reply.step !== step || !intentOpen) {
            if (reply.step !== step) {
              const unclosed = yield* endStep(turn);
              if (unclosed !== undefined) {
                decisions.push(unclosed);
              }
              step = reply.step;
            }
            const unopened = yield* openStep(turn);
            if (unopened !== undefined) {
              decisions.push(decision(said, unopened));
              continue;
            }
          }

          const ran = yield* Client.run(guest);
          yield* log(input, turn, "command", `${shown(guest)} exit ${String(ran.exitCode)}`);
          const imaging = guest.args[0] === "get-image";
          if (ran.exitCode === 0) {
            pointer = Pointer.after(guest.args, pointer);
            if (!imaging) {
              previous = Option.some(Intent.dropHeld(guest.args));
            }
          }
          const shot = imaging && ran.exitCode === 0 && ran.bytes.length > 0;
          screen = shot ? ran.bytes : undefined;
          const printed = Tools.toolContent(ran);
          const gone = sessionGone(printed);
          if (gone !== undefined) {
            yield* log(input, turn, "failure", gone);
            return yield* Effect.fail(commandError(gone));
          }
          // Without this a failed get-image reads as nothing, and the model asks for it forever.
          // A mint's last act is powering the guest off, so its failed image is the end of the
          // drive, and Done is what lets the harness save the disk.
          let outcome = printed;
          if (shot) {
            outcome = "took a screenshot";
          } else if (imaging && ran.exitCode !== 0) {
            machineOff = facts.mint;
            outcome = facts.mint
              ? `IMAGE HAS FAILED, MACHINE IS SHUT DOWN. Nothing is left to drive: call Done, and the harness saves the disk.\n${outcome}`
              : `IMAGE HAS FAILED, MACHINE IS SHUT DOWN\n${outcome}`;
          }
          decisions.push(decision(said, outcome));
          if (ran.malformed) {
            yield* miss(turn, firstLine(printed), text);
          } else {
            misses = [];
          }
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
          yield* log(input, 0, "command", `${shown(command)} exit ${String(ran.exitCode)}`);
          if (ran.exitCode !== 0) {
            const printed = Tools.toolContent(ran);
            return yield* Effect.fail(commandError(printed === "" ? "stop failed" : printed));
          }
          return yield* Effect.void;
        });
        const closeResult = Effect.fn("Driver.closeResult")(function* (
          ok: boolean,
          why: string | undefined,
        ) {
          const mark = {
            bin: "./ctrl",
            args: [
              "test-results",
              "--agent-id",
              input.agentId,
              "--id",
              facts.resultId,
              "--status",
              ok ? "success" : "failed",
              ...(why === undefined || why === "" ? [] : ["--reason", why]),
            ],
          };
          const marked = yield* runCommand(mark);
          yield* log(input, 0, "command", `${shown(mark)} exit ${String(marked.exitCode)}`);
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
              input,
              0,
              "failure",
              `stop: ${Render.headline(Cause.squash(stopped.cause))}`,
            ).pipe(Effect.ignore);
          }
          const closed = yield* Effect.exit(closeResult(false, reason));
          if (Exit.isFailure(closed)) {
            yield* log(
              input,
              0,
              "failure",
              `test-results: ${Render.headline(Cause.squash(closed.cause))}`,
            ).pipe(Effect.ignore);
          }
          if (Exit.isSuccess(stopped)) {
            yield* log(input, 0, "stop", "session-stopped").pipe(Effect.ignore);
          }
          return yield* Effect.void;
        }
        // A save that keeps nothing is the result's failure, and the result is never left open.
        const ended = yield* Effect.exit(stopGuest);
        if (Exit.isFailure(ended)) {
          const why = Render.headline(Cause.squash(ended.cause));
          yield* closeResult(false, why).pipe(
            Effect.catch((error) =>
              log(input, 0, "failure", `test-results: ${Render.headline(error)}`),
            ),
            Effect.ignore,
          );
          return yield* Effect.failCause(ended.cause);
        }
        yield* closeResult(true, undefined);
        return yield* log(input, 0, "stop", "result-closed");
      }),
  );
  return { reason: "result-closed" } satisfies Stopped;
});
