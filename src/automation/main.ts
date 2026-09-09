import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Deferred, Effect, Exit, Layer, type Runtime } from "effect";
import { Command } from "effect/unstable/cli";
import { HttpMiddleware, HttpRouter, HttpServerError } from "effect/unstable/http";
import * as Config from "../config.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Sentry from "../observability/sentry.ts";
import * as Api from "../shared/api.ts";
import * as AutomationCommand from "./command.ts";
import * as Handlers from "./handlers.ts";

const HOST = "127.0.0.1";

// Where every request lands, one line each, in the working directory as they asked.
const RECORD = "./automation-logs";

// stdout is the convenience copy of the log; Sentry is the record. A write refused by a full
// filesystem is dropped, never an uncaught exception per line (see the proxy's main).
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

// The platform drops its error listener once the server is up; a later error still needs the
// fatal line and exit 1. Only the first counts.
const server = createServer();
const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
server.on("error", (cause) => {
  Deferred.doneUnsafe(serverFailed, Exit.fail(new HttpServerError.ServeError({ cause })));
});

const ServerLive = (port: number) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.info(
        `oligarchy automation listening on ${HOST}:${String(port)}; recording to ${RECORD}`,
      );
    }),
  ).pipe(
    Layer.provide(
      HttpRouter.serve(Handlers.routes(RECORD), {
        disableLogger: true,
        disableListenLog: true,
      }).pipe(Layer.provide(NodeHttpServer.layer(() => server, { host: HOST, port }))),
    ),
    // As on the proxy: no http.server span reaches Sentry.
    Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
  );

// LINEAR_WEBHOOK_SECRET is the one variable this process reads: Linear signs POST /linear with it.
const WebhookSecretLive = Layer.unwrap(
  Effect.map(Config.linearWebhookSecret, (secret) =>
    Layer.succeed(Handlers.LinearWebhookSecret)(Handlers.LinearWebhookSecret.of(secret)),
  ),
);

// No database: this service keeps no rows, so its log is stdout and Sentry. Sentry sits beneath
// Log so Log captures the reporter.
const MainLive = Layer.mergeAll(Log.Log.layerStdout, WebhookSecretLive).pipe(
  Layer.provideMerge(Sentry.SentryLive),
  Layer.provideMerge(Config.providerLayer),
  Layer.provideMerge(NodeServices.layer),
);

const command = AutomationCommand.makeAutomationCommand({ serve: ServerLive, serverFailed });

// The graph is built before the command runs: a missing LINEAR_WEBHOOK_SECRET is the one failure
// no Log exists to record, so it is printed here. Every later failure logs its own fatal line; a
// defect has nothing else to say for it.
const program = Effect.gen(function* () {
  const services = yield* Layer.build(MainLive).pipe(Effect.tapCause(Render.reportFailure));
  yield* Command.run(command, { version: Api.VERSION }).pipe(
    Effect.provide(services),
    Effect.tapDefect((defect) => Render.reportFailure(Cause.die(defect))),
  );
}).pipe(Effect.scoped);

// SIGINT and SIGTERM interrupt the program and exit 0; nothing of this process's own is stopping.
const teardown: Runtime.Teardown = (exit, onExit) => {
  onExit(Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? 1 : 0);
};

NodeRuntime.runMain(program, { disableErrorReporting: true, teardown });
