import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import * as CliConfig from "effect/unstable/cli/CliConfig";
import * as CliOutput from "effect/unstable/cli/CliOutput";
import * as Command from "effect/unstable/cli/Command";
import * as GlobalFlag from "effect/unstable/cli/GlobalFlag";
import * as Config from "../config.ts";
import * as Render from "../observability/render.ts";
import * as Api from "../shared/api.ts";
import * as VizCommand from "./command.ts";

// NodeServices brings the Terminal: stdout's size, stdin in raw mode while the view reads keys,
// and the frames written to stdout.
const MainLive = Layer.mergeAll(
  CliOutput.layer(CliOutput.defaultFormatter({ colors: process.stdout.isTTY })),
  CliConfig.layer({ builtIns: GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Wizard) }),
  Config.providerLayer,
).pipe(Layer.provideMerge(NodeServices.layer));

// SIGTERM interrupts the root fiber and the view's scope hands the screen back; ctrl-c arrives as
// a key in raw mode and ends the view the same way q does.
const program = Command.run(VizCommand.makeVizCommand(), { version: Api.VERSION }).pipe(
  Effect.provide(MainLive),
  Effect.scoped,
  Effect.tapCause(Render.reportFailure),
);

NodeRuntime.runMain(program, { disableErrorReporting: true });
