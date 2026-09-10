import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Deferred, Effect, Exit, Layer, type Runtime } from "effect";
import { Command } from "effect/unstable/cli";
import { HttpMiddleware, HttpRouter, HttpServerError } from "effect/unstable/http";
import * as Config from "../config.ts";
import * as Automation from "../db/automation.ts";
import * as Client from "../db/client.ts";
import * as Logs from "../db/logs.ts";
import * as Tests from "../db/tests.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Sentry from "../observability/sentry.ts";
import * as Api from "../shared/api.ts";
import * as AutomationCommand from "./command.ts";
import * as Handlers from "./handlers.ts";

const HOST = "127.0.0.1";

const automationAttr = {
  location: Log.Locations.automation,
  agentId: Log.AutomationAgentId,
} as const;

// stdout is the convenience copy of the log; the logs rows, automation_jobs rows and Sentry are
// the record. A write refused by a full filesystem is dropped, never an uncaught exception per
// line (see the proxy's main).
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
      yield* log.acquireColor(Log.AutomationAgentId);
      yield* log.info(`oligarchy automation listening on ${HOST}:${String(port)}`, automationAttr);
    }),
  ).pipe(
    Layer.provide(
      HttpRouter.serve(Handlers.routes, {
        disableLogger: true,
        disableListenLog: true,
      }).pipe(Layer.provide(NodeHttpServer.layer(() => server, { host: HOST, port }))),
    ),
    // As on the proxy: no http.server span reaches Sentry.
    Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
  );

const DatabaseLive = Layer.unwrap(Effect.map(Config.databaseUrl, Client.Database.layer));

// LINEAR_WEBHOOK_SECRET signs POST /linear; DATABASE_URL holds the queue and the logs rows.
// Sentry sits beneath Log so Log captures the reporter. Lines land in logs with
// location/agentId "automation"; durable jobs remain automation_jobs.
const MainLive = Layer.mergeAll(
  Log.Log.layer,
  Handlers.LinearWebhookSecret.layer,
  Tests.TestStore.layer,
  Automation.AutomationStore.layer,
).pipe(
  Layer.provideMerge(Logs.LogStore.layer),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Sentry.SentryLive),
  Layer.provideMerge(Layer.succeed(Log.ProcessAttribution)(Log.AutomationProcessAttribution)),
  Layer.provideMerge(Config.providerLayer),
  Layer.provideMerge(NodeServices.layer),
);

const command = AutomationCommand.makeAutomationCommand({ serve: ServerLive, serverFailed });

// The graph is built before the command runs: a missing LINEAR_WEBHOOK_SECRET or DATABASE_URL is
// the one failure no Log exists to record, so it is printed here. Every later failure logs its
// own fatal line; a defect has nothing else to say for it.
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
