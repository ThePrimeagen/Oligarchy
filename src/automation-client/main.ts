import { createServer } from "node:http";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Cause, Deferred, Effect, Exit, Layer, Option, type Runtime } from "effect";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerError from "effect/unstable/http/HttpServerError";
import * as Config from "@oligarchy/env/config";
import * as Env from "@oligarchy/env/run";
import * as Log from "@oligarchy/log/log";
import * as Api from "@oligarchy/routes/api";
import * as ProxyClient from "../client/proxy-client.ts";
import * as Client from "../db/client.ts";
import * as Logs from "../db/logs.ts";
import * as ProcessStats from "../db/process-stats.ts";
import * as Servers from "../db/servers.ts";
import * as RowLog from "../observability/log.ts";
import * as Sentry from "../observability/sentry.ts";
import * as Stats from "../qemu/stats.ts";
import * as ProcessUsage from "../shared/process-usage.ts";
import * as AutomationClientCommand from "./command.ts";
import * as Handlers from "./handlers.ts";
import * as Heartbeat from "./heartbeat.ts";
import * as Qemu from "./qemu.ts";
import * as Sessions from "./sessions.ts";

const HOST = "127.0.0.1";

const automationClientAttr = Log.AutomationClientProcessAttribution;

// The platform drops its error listener once the server is up; a later error still needs the
// fatal line and exit 1. Only the first counts.
const server = createServer();
const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
server.on("error", (cause) => {
  Deferred.doneUnsafe(serverFailed, Exit.fail(new HttpServerError.ServeError({ cause })));
});

// The heartbeat starts once the listener is up, in the same scope: a port refusal announces
// nothing, and a shutdown deletes the row it wrote.
const ServerLive = (maxJobs: number, name: string, port: number, url: Option.Option<string>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.info(
        `automation client listening on ${HOST}:${String(port)}; name ${name}; max jobs ${String(maxJobs)}${Option.match(url, { onNone: () => "", onSome: (announced) => `; announcing ${announced}` })}`,
        automationClientAttr,
      );
      yield* Option.match(url, {
        onNone: () => Effect.void,
        onSome: (announced) => Heartbeat.announce(announced, name),
      });
      // Registered last so it runs first: the drivers die before the listener waits on them.
      // A /run handler is uninterruptible, so a signal alone would wait out the driver.
      const sessions = yield* Sessions.Sessions;
      yield* Effect.addFinalizer(() => sessions.shutdown());
    }),
  ).pipe(
    Layer.provide(
      HttpRouter.serve(Handlers.routes, {
        disableLogger: true,
        disableListenLog: true,
      }).pipe(Layer.provide(NodeHttpServer.layer(() => server, { host: HOST, port }))),
    ),
    Layer.provide(
      Layer.unwrap(
        Effect.gen(function* () {
          const { token } = yield* Config.ProxyConfig;
          const serverUrl = yield* Config.serverUrl.pipe(
            Effect.orElseSucceed(() => Config.DEFAULT_SERVER_URL),
          );
          const proxy = yield* ProxyClient.connect({ serverUrl, token });
          return Sessions.Sessions.layer(maxJobs, Qemu.reserve(proxy), Qemu.relinquish(proxy));
        }),
      ),
    ),
    Layer.provide(Layer.mergeAll(Stats.Stats.layer, ProcessUsage.ProcessUsage.layer)),
    Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
  );

const DatabaseLive = Layer.unwrap(
  Effect.map(Config.ProxyConfig, (config) => Client.Database.layer(config.databaseUrl)),
);

// Sentry sits beneath Log so the log rows flush before Sentry does, and Log captures the reporter.
const MainLive = Layer.mergeAll(
  Servers.ServerStore.layer,
  ProcessStats.ProcessStatsStore.layer,
  RowLog.layer,
).pipe(
  Layer.provideMerge(Logs.LogStore.layer),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Config.ProxyConfig.layer),
  Layer.provideMerge(Sentry.SentryLive),
  Layer.provideMerge(Layer.succeed(Log.ProcessAttribution)(Log.AutomationClientProcessAttribution)),
  Layer.provideMerge(NodeHttpClient.layerNodeHttp),
);

const command = AutomationClientCommand.makeAutomationClientCommand({
  serve: ServerLive,
  serverFailed,
});

const teardown: Runtime.Teardown = (exit, onExit) => {
  onExit(Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? 1 : 0);
};

// Every failure past the graph logs its own fatal line; only a defect is printed for it.
Env.run(Env.program(command, { version: Api.VERSION, layer: MainLive, failuresLogged: true }), {
  teardown,
});
