import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Runtime } from "effect";
import * as CliConfig from "effect/unstable/cli/CliConfig";
import * as CliOutput from "effect/unstable/cli/CliOutput";
import * as Command from "effect/unstable/cli/Command";
import * as GlobalFlag from "effect/unstable/cli/GlobalFlag";
import * as Config from "../config.ts";
import * as Render from "../observability/render.ts";
import * as Api from "../shared/api.ts";
import * as SessionCommand from "./command.ts";
import * as Image from "./image.ts";
import * as Readline from "./readline.ts";
import * as State from "./state.ts";

const HostLive = Layer.succeed(State.Host)(
  State.Host.of({
    execPath: process.execPath,
    imageProtocol: Image.imageProtocol(process.env),
    input: process.stdin,
    output: process.stdout,
    termination: Readline.signals(["SIGTERM", "SIGHUP"]),
  }),
);

const MainLive = Layer.mergeAll(
  CliOutput.layer(CliOutput.defaultFormatter({ colors: process.stdout.isTTY })),
  CliConfig.layer({ builtIns: GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Wizard) }),
  Config.providerLayer,
  HostLive,
).pipe(Layer.provideMerge(NodeServices.layer));

const main = Command.run(SessionCommand.makeSessionCommand(), { version: Api.VERSION }).pipe(
  Effect.provide(MainLive),
  Effect.scoped,
  Effect.tapCause(Render.reportFailure),
);

// Not NodeRuntime.runMain: that interrupts the root fiber on SIGTERM, while this REPL answers
// SIGTERM and SIGHUP itself (kill the follow, await the boot, stop the session) and leaves 0.
const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => {
    teardown(exit, (code) => {
      process.exit(code);
    });
  });
});

runMain(main, { disableErrorReporting: true });
