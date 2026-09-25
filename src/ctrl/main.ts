import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import * as CliConfig from "effect/unstable/cli/CliConfig";
import * as CliOutput from "effect/unstable/cli/CliOutput";
import * as Command from "effect/unstable/cli/Command";
import * as GlobalFlag from "effect/unstable/cli/GlobalFlag";
import * as Api from "@oligarchy/routes/api";
import * as Config from "../config.ts";
import * as Render from "../observability/render.ts";
import * as Sentry from "../observability/sentry.ts";
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
