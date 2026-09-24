import { Console, Effect, Schema } from "effect";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import * as Config from "../config.ts";
import * as EnvFile from "../env-file.ts";
import * as HarnessConfig from "../harness/config.ts";
import * as Loop from "./loop.ts";

// drive and mint are the harness. A diagnose is opencode, and this program does not run it.
const DriverAction = Schema.String.check(
  Schema.isPattern(/^(drive|mint)$/, { message: "action must be drive or mint" }),
).annotate({ identifier: "@oligarchy/driver/command/DriverAction" });

const flags = {
  action: Flag.string("action").pipe(
    Flag.withSchema(DriverAction),
    Flag.withDescription("drive or mint; the model is that action's in oligarchy.json"),
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
    Flag.withDescription("Test result this run closes"),
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
        model: input.action === "mint" ? config.models.mint : config.models.drive,
        prompt: input.prompt,
        testResultId: input.testResultId,
        debugLog: input.debugLog,
        config,
        token,
      });
      return yield* Console.log(stopped.reason);
    }),
  ).pipe(
    Command.withDescription(
      "Run the harness loop for one prompt: the model is oligarchy.json's for --action; each reply is complete or continue, what the agent did, and the action; a debug log of every step; a started session marked running; and intent start and end around each guest action",
    ),
    EnvFile.withEnvFile,
  );
