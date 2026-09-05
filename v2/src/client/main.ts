import { NodeHttpClient, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { CliConfig, CliOutput, Command, GlobalFlag } from "effect/unstable/cli";
import * as Config from "../config.ts";
import * as Api from "../shared/api.ts";
import * as ClientCommand from "./command.ts";

const MainLive = Layer.mergeAll(
  CliOutput.layer(CliOutput.defaultFormatter({ colors: process.stdout.isTTY })),
  CliConfig.layer({ builtIns: GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Wizard) }),
  NodeHttpClient.layerNodeHttp,
  Config.providerLayer,
).pipe(Layer.provideMerge(NodeServices.layer));

const main = Command.run(ClientCommand.makeClientCommand(), { version: Api.VERSION }).pipe(
  Effect.tapCause(ClientCommand.report),
  Effect.provide(MainLive),
  Effect.scoped,
);

NodeRuntime.runMain(main, { disableErrorReporting: true });
