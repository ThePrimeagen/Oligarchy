import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Runtime } from "effect";
import * as Env from "@oligarchy/env/run";
import * as Api from "@oligarchy/http/api";
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

const main = Env.program(SessionCommand.makeSessionCommand(), {
  version: Api.VERSION,
  layer: HostLive,
}).pipe(Effect.provide(NodeServices.layer));

// Not Env.run: that interrupts the root fiber on SIGTERM, while this REPL answers SIGTERM and
// SIGHUP itself (await the boot, stop the session) and leaves 0.
const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => {
    teardown(exit, (code) => {
      process.exit(code);
    });
  });
});

runMain(main, { disableErrorReporting: true });
