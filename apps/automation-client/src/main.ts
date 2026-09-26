import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Cause, Effect, Exit, Layer, Option, type Runtime } from "effect";
import * as Client from "@oligarchy/db/client";
import * as Logs from "@oligarchy/db/logs";
import * as ProcessStats from "@oligarchy/db/process-stats";
import * as Servers from "@oligarchy/db/servers";
import * as Config from "@oligarchy/env/config";
import * as Env from "@oligarchy/env/run";
import * as Host from "@oligarchy/fleet/host";
import * as ProcessUsage from "@oligarchy/fleet/process";
import * as Log from "@oligarchy/log/log";
import * as Observability from "@oligarchy/observability/log";
import * as Sentry from "@oligarchy/observability/sentry";
import * as Api from "@oligarchy/http/api";
import * as Serve from "@oligarchy/http/serve";
import * as ProxyClient from "@oligarchy/http/proxy-client";
import * as AutomationClientCommand from "./command.ts";
import * as Handlers from "./handlers.ts";
import * as Heartbeat from "./heartbeat.ts";
import * as Qemu from "./qemu.ts";
import * as Sessions from "./sessions.ts";

const HOST = "127.0.0.1";

const automationClientAttr = Log.AutomationClientProcessAttribution;

// The heartbeat starts once the listener is up, in the same scope: a port refusal announces
// nothing, and a shutdown deletes the row it wrote.
const ServerLive = (maxJobs: number, name: string, port: number, url: Option.Option<string>) =>
  Serve.serve({
    port,
    routes: Handlers.routes,
    services: Layer.unwrap(
      Effect.gen(function* () {
        const { token } = yield* Config.ProxyConfig;
        const serverUrl = yield* Config.serverUrl.pipe(
          Effect.orElseSucceed(() => Config.DEFAULT_SERVER_URL),
        );
        const proxy = yield* ProxyClient.connect({ serverUrl, token });
        return Sessions.Sessions.layer(maxJobs, Qemu.reserve(proxy), Qemu.relinquish(proxy));
      }),
    ).pipe(Layer.provideMerge(Layer.mergeAll(Host.Host.layer, ProcessUsage.ProcessUsage.layer))),
    listening: Effect.gen(function* () {
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
  });

const DatabaseLive = Layer.unwrap(
  Effect.map(Config.ProxyConfig, (config) => Client.Database.layer(config.databaseUrl)),
);

// Sentry sits beneath Log so the log rows flush before Sentry does, and Log captures the reporter.
const MainLive = Layer.mergeAll(
  Servers.ServerStore.layer,
  ProcessStats.ProcessStatsStore.layer,
  Observability.LogLive,
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
});

const teardown: Runtime.Teardown = (exit, onExit) => {
  onExit(Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? 1 : 0);
};

// Every failure past the graph logs its own fatal line; only a defect is printed for it.
Env.run(Env.program(command, { version: Api.VERSION, layer: MainLive, failuresLogged: true }), {
  teardown,
});
