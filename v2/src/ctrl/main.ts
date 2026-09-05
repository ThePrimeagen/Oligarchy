import { NodeHttpClient, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Console, Effect, Layer, Option } from "effect";
import { CliConfig, CliError, CliOutput, Command, GlobalFlag } from "effect/unstable/cli";
import * as Config from "../config.ts";
import * as Render from "../observability/render.ts";
import * as Api from "../shared/api.ts";
import * as CtrlCommand from "./command.ts";

const MainLive = Layer.mergeAll(
  CliOutput.layer(CliOutput.defaultFormatter({ colors: process.stdout.isTTY })),
  CliConfig.layer({ builtIns: GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Wizard) }),
  NodeHttpClient.layerNodeHttp,
  Config.providerLayer,
).pipe(Layer.provideMerge(NodeServices.layer));

// Command.run has already rendered help and usage errors; everything else prints one headline and
// the cause. Interrupts print nothing.
const report = (cause: Cause.Cause<unknown>): Effect.Effect<void> => {
  const failure = Cause.findErrorOption(cause);
  if (Option.isSome(failure) && CliError.isCliError(failure.value)) {
    return Effect.void;
  }
  const text = Render.renderFailure(cause);
  return text === "" ? Effect.void : Console.error(text);
};

const program = Command.run(CtrlCommand.makeCtrlCommand(), { version: Api.VERSION }).pipe(
  Effect.tapCause(report),
  Effect.provide(MainLive),
  Effect.scoped,
);

NodeRuntime.runMain(program, { disableErrorReporting: true });
