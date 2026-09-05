import { NodeServices } from "@effect/platform-node";
import { Cause, Console, Effect, Layer, Runtime } from "effect";
import { CliConfig, CliError, CliOutput, Command, GlobalFlag } from "effect/unstable/cli";
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

// Effect renders parse failures with the usage itself; everything else gets one headline and
// the cause. The REPL never fails after the prompt: a failure here is a parse or token failure.
const render = <E>(cause: Cause.Cause<E>): Effect.Effect<void> => {
  const text = Render.renderFailure(cause);
  return text === "" || CliError.isCliError(Cause.squash(cause))
    ? Effect.void
    : Console.error(text);
};

const main = Command.run(SessionCommand.command, { version: Api.VERSION }).pipe(
  Effect.tapCause(render),
  Effect.provide(MainLive),
  Effect.scoped,
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
