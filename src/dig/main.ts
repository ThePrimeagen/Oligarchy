import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Console, Deferred, Effect, Exit, Layer, type Runtime } from "effect";
import { CliConfig, CliOutput, Command, GlobalFlag } from "effect/unstable/cli";
import { HttpMiddleware, HttpRouter, HttpServerError } from "effect/unstable/http";
import * as Render from "../observability/render.ts";
import * as Api from "../shared/api.ts";
import * as DigCommand from "./command.ts";
import * as Handlers from "./handlers.ts";

const HOST = "0.0.0.0";
const ANNOUNCE = "127.0.0.1";

process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const server = createServer();
const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
server.on("error", (cause) => {
  Deferred.doneUnsafe(serverFailed, Exit.fail(new HttpServerError.ServeError({ cause })));
});

const ServerLive = (port: number) =>
  Layer.effectDiscard(Console.log(`dig listening on ${ANNOUNCE}:${String(port)}`)).pipe(
    Layer.provide(
      HttpRouter.serve(Handlers.routes, {
        disableLogger: true,
        disableListenLog: true,
      }).pipe(Layer.provide(NodeHttpServer.layer(() => server, { host: HOST, port }))),
    ),
    Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
  );

const MainLive = Layer.mergeAll(
  CliOutput.layer(CliOutput.defaultFormatter({ colors: process.stdout.isTTY })),
  CliConfig.layer({ builtIns: GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Wizard) }),
).pipe(Layer.provideMerge(NodeServices.layer));

const command = DigCommand.makeDigCommand({
  serve: ServerLive,
  serverFailed,
});

const program = Command.run(command, { version: Api.VERSION }).pipe(
  Effect.provide(MainLive),
  Effect.scoped,
  Effect.tapCause(Render.reportFailure),
);

const teardown: Runtime.Teardown = (exit, onExit) => {
  onExit(Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? 1 : 0);
};

NodeRuntime.runMain(program, { disableErrorReporting: true, teardown });
