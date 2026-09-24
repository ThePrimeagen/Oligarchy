import { Console, Effect, Option, Schema } from "effect";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import * as Config from "../config.ts";
import * as EnvFile from "../env-file.ts";
import * as HarnessConfig from "../harness/config.ts";
import * as Domain from "../shared/domain.ts";
import * as Loop from "./loop.ts";

const flags = {
  model: Flag.string("model").pipe(
    Flag.withSchema(Domain.ModelId),
    Flag.withDescription("The model for this run, provider/model"),
  ),
  prompt: Flag.string("prompt").pipe(
    Flag.withSchema(Schema.NonEmptyString),
    Flag.withDescription("The user prompt"),
  ),
  debugLog: Flag.string("debug-log").pipe(
    Flag.withSchema(Schema.NonEmptyString),
    Flag.withDescription("File that receives one JSON line per step"),
  ),
  testResultId: Flag.string("test-result-id").pipe(
    Flag.withSchema(Schema.NonEmptyString),
    Flag.withDescription("Test result id passed to intent start"),
  ),
  agentId: Flag.string("agent-id").pipe(
    Flag.withSchema(Schema.NonEmptyString),
    Flag.withDescription("Calling agent's id"),
  ),
  serverUrl: Flag.string("server-url").pipe(
    Flag.withSchema(Domain.ServerUrl),
    Flag.withDescription("QEMU server URL"),
  ),
  sessionId: Flag.string("session-id").pipe(
    Flag.withSchema(Schema.NonEmptyString),
    Flag.optional,
    Flag.withDescription("Session id, when the guest is already up"),
  ),
};

export const makeDriverCommand = <E, R>(
  run: (input: Loop.Input) => Effect.Effect<Loop.Stopped, E, R>,
) =>
  Command.make(
    "driver",
    flags,
    Effect.fn("driver")(function* (input: Command.Command.Config.Infer<typeof flags>) {
      // The file is reported before the token, so a broken config is never a missing key.
      const config = yield* HarnessConfig.load;
      const token = yield* Config.openRouterToken;
      const stopped = yield* run({
        model: input.model,
        prompt: input.prompt,
        testResultId: input.testResultId,
        debugLog: input.debugLog,
        agentId: input.agentId,
        serverUrl: input.serverUrl,
        sessionId: Option.getOrUndefined(input.sessionId),
        config,
        token,
      });
      return yield* Console.log(stopped.reason);
    }),
  ).pipe(
    Command.withDescription(
      "Run the harness loop for one prompt and one model: each reply is one drive tool call, continue or complete, what the agent did, and a typed action; a debug log of every step; a started session marked running; and intent start and end around each guest action",
    ),
    EnvFile.withEnvFile,
  );
