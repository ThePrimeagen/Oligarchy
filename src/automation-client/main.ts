import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Deferred, Effect, Exit, Layer, Option, type Runtime } from "effect";
import { Command } from "effect/unstable/cli";
import { HttpMiddleware, HttpRouter, HttpServerError } from "effect/unstable/http";
import * as Config from "../config.ts";
import * as Client from "../db/client.ts";
import * as Logs from "../db/logs.ts";
import * as Servers from "../db/servers.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Sentry from "../observability/sentry.ts";
import * as Stats from "../qemu/stats.ts";
import * as Api from "../shared/api.ts";
import * as AutomationClientCommand from "./command.ts";
import * as Handlers from "./handlers.ts";
import * as Heartbeat from "./heartbeat.ts";
import * as Sessions from "./sessions.ts";

const HOST = "127.0.0.1";

const automationClientAttr = Log.AutomationClientProcessAttribution;

// stdout is the convenience copy of the log; the rows and Sentry are the record. A write refused
// by a full filesystem is dropped, never an uncaught exception per line (see the qemu server's main).
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

// The platform drops its error listener once the server is up; a later error still needs the
// fatal line and exit 1. Only the first counts.
const server = createServer();
const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
server.on("error", (cause) => {
  Deferred.doneUnsafe(serverFailed, Exit.fail(new HttpServerError.ServeError({ cause })));
});

// The heartbeat starts once the listener is up, in the same scope: a port refusal announces
// nothing, and a shutdown deletes the row it wrote.
const ServerLive = (port: number, url: Option.Option<string>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.acquireColor(Log.AutomationClientAgentId);
      yield* log.info(
        `automation client listening on ${HOST}:${String(port)}${Option.match(url, { onNone: () => "", onSome: (announced) => `; announcing ${announced}` })}`,
        automationClientAttr,
      );
      yield* Option.match(url, { onNone: () => Effect.void, onSome: Heartbeat.announce });
    }),
  ).pipe(
    Layer.provide(
      HttpRouter.serve(Handlers.routes, {
        disableLogger: true,
        disableListenLog: true,
      }).pipe(Layer.provide(NodeHttpServer.layer(() => server, { host: HOST, port }))),
    ),
    Layer.provide(Sessions.Sessions.layer),
    Layer.provide(Stats.Stats.layer),
    Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
  );

const DatabaseLive = Layer.unwrap(
  Effect.map(Config.ProxyConfig, (config) => Client.Database.layer(config.databaseUrl)),
);

// Sentry sits beneath Log so the log rows flush before Sentry does, and Log captures the reporter.
const MainLive = Layer.mergeAll(Servers.ServerStore.layer, Log.Log.layer).pipe(
  Layer.provideMerge(Logs.LogStore.layer),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Config.ProxyConfig.layer),
  Layer.provideMerge(Sentry.SentryLive),
  Layer.provideMerge(Layer.succeed(Log.ProcessAttribution)(Log.AutomationClientProcessAttribution)),
  Layer.provideMerge(Config.providerLayer),
  Layer.provideMerge(NodeServices.layer),
);

const command = AutomationClientCommand.makeAutomationClientCommand({
  serve: ServerLive,
  serverFailed,
});

// The graph is built before the command runs: a missing variable or a bad DATABASE_URL is the one
// failure no Log exists to record, so it is printed here. Every later failure logs its own fatal
// line; a defect has nothing else to say for it.
const program = Effect.gen(function* () {
  const services = yield* Layer.build(MainLive).pipe(Effect.tapCause(Render.reportFailure));
  yield* Command.run(command, { version: Api.VERSION }).pipe(
    Effect.provide(services),
    Effect.tapDefect((defect) => Render.reportFailure(Cause.die(defect))),
  );
}).pipe(Effect.scoped);

const teardown: Runtime.Teardown = (exit, onExit) => {
  onExit(Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? 1 : 0);
};

NodeRuntime.runMain(program, { disableErrorReporting: true, teardown });
