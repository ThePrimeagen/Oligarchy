import { createServer } from "node:http";
import { NodeHttpClient, NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Deferred, Effect, Exit, Layer, type Runtime } from "effect";
import { Command } from "effect/unstable/cli";
import { HttpMiddleware, HttpRouter, HttpServer, HttpServerError } from "effect/unstable/http";
import * as Config from "../config.ts";
import * as Cursor from "../ctrl/cursor.ts";
import * as Client from "../db/client.ts";
import * as Logs from "../db/logs.ts";
import * as Servers from "../db/servers.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Sentry from "../observability/sentry.ts";
import * as Api from "../shared/api.ts";
import * as ReverseProxyCommand from "./command.ts";
import * as Diagnostics from "./diagnostics.ts";
import * as Handlers from "./handlers.ts";
import * as Router from "./router.ts";

const HOST = "127.0.0.1";

// stdout is the convenience copy of the log; the rows and Sentry are the record. A write refused
// by a full filesystem is dropped, never an uncaught exception per line (see the proxy's main).
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

// The platform drops its error listener once a server is up; a later error on either listener
// still needs the fatal line and exit 1. Only the first counts.
const server = createServer();
const diagnosticsServer = createServer();
const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
for (const listener of [server, diagnosticsServer]) {
  listener.on("error", (cause) => {
    Deferred.doneUnsafe(serverFailed, Exit.fail(new HttpServerError.ServeError({ cause })));
  });
}

// Two listeners, each with its own HttpServer: the API behind the bearer on `port`, the
// operator's page on `diagnosticsPort`. HttpRouter.serve memoises one router per graph, so the
// page is a plain handler under HttpServer.serve rather than a second router.
const ServerLive = (port: number, diagnosticsPort: number) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.info(
        `oligarchy reverse proxy listening on ${HOST}:${String(port)}; diagnostics on ${HOST}:${String(diagnosticsPort)}`,
      );
    }),
  ).pipe(
    Layer.provide(
      HttpRouter.serve(Handlers.routes, { disableLogger: true, disableListenLog: true }).pipe(
        Layer.provide(NodeHttpServer.layer(() => server, { host: HOST, port })),
      ),
    ),
    Layer.provide(
      HttpServer.serve(Diagnostics.handler).pipe(
        Layer.provide(
          NodeHttpServer.layer(() => diagnosticsServer, { host: HOST, port: diagnosticsPort }),
        ),
      ),
    ),
    Layer.provide(Router.Router.layer),
    // As on the proxy: no http.server span reaches Sentry.
    Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
  );

const DatabaseLive = Layer.unwrap(
  Effect.map(Config.ProxyConfig, (config) => Client.Database.layer(config.databaseUrl)),
);

// The reverse proxy spawns agents, so it needs the key at startup. Built above ProxyConfig, so a
// missing CURSOR_API_TOKEN is reported after the proxy's two, never before.
const CursorLive = Layer.unwrap(
  Effect.map(Config.cursorApiToken, (apiKey) => Cursor.CursorAgents.layer(apiKey)),
);

// Sentry sits beneath Log so the log rows flush before Sentry does, and Log captures the reporter.
const MainLive = Layer.mergeAll(Servers.ServerStore.layer, Log.Log.layer, CursorLive).pipe(
  Layer.provideMerge(Logs.LogStore.layer),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Config.ProxyConfig.layer),
  Layer.provideMerge(Sentry.SentryLive),
  Layer.provideMerge(Config.providerLayer),
  Layer.provideMerge(NodeHttpClient.layerNodeHttp),
  Layer.provideMerge(NodeServices.layer),
);

const command = ReverseProxyCommand.makeReverseProxyCommand({ serve: ServerLive, serverFailed });

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

// SIGINT and SIGTERM interrupt the program and exit 0; nothing of this process's own is stopping.
const teardown: Runtime.Teardown = (exit, onExit) => {
  onExit(Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? 1 : 0);
};

NodeRuntime.runMain(program, { disableErrorReporting: true, teardown });
