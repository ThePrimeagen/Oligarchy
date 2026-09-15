import { NodeHttpClient, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { CliConfig, CliOutput, Command, GlobalFlag } from "effect/unstable/cli";
import * as Config from "../config.ts";
import * as Render from "../observability/render.ts";
import * as Sentry from "../observability/sentry.ts";
import * as Api from "../shared/api.ts";
import * as CtrlCommand from "./command.ts";

// Sentry sits beneath everything a command builds: the Log a database action builds captures the
// reporter, and its rows flush when the action's layer closes, before this scope flushes Sentry.
const MainLive = Layer.mergeAll(
  CliOutput.layer(CliOutput.defaultFormatter({ colors: process.stdout.isTTY })),
  CliConfig.layer({ builtIns: GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Wizard) }),
  NodeHttpClient.layerNodeHttp,
  Config.providerLayer,
).pipe(Layer.provideMerge(Sentry.SentryLive), Layer.provideMerge(NodeServices.layer));

const program = Command.run(CtrlCommand.makeCtrlCommand(), { version: Api.VERSION }).pipe(
  Effect.provide(MainLive),
  Effect.scoped,
  Effect.tapCause(Render.reportFailure),
);

NodeRuntime.runMain(program, { disableErrorReporting: true });
