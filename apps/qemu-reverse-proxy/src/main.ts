import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Cause, Effect, Exit, Layer, type Runtime } from "effect";
import * as Client from "@oligarchy/db/client";
import * as Logs from "@oligarchy/db/logs";
import * as Servers from "@oligarchy/db/servers";
import * as SessionStore from "@oligarchy/db/sessions";
import * as SetupRequests from "@oligarchy/db/setup-requests";
import * as Tests from "@oligarchy/db/tests";
import * as Config from "@oligarchy/env/config";
import * as Env from "@oligarchy/env/run";
import * as Sweep from "@oligarchy/fleet/sweep";
import * as Linear from "@oligarchy/linear/client";
import * as Log from "@oligarchy/log/log";
import * as Render from "@oligarchy/log/render";
import * as Observability from "@oligarchy/observability/log";
import * as Sentry from "@oligarchy/observability/sentry";
import * as Api from "@oligarchy/http/api";
import * as Serve from "@oligarchy/http/serve";
import * as QemuReverseProxyCommand from "./command.ts";
import * as Handlers from "./handlers.ts";
import * as Router from "./router.ts";
import * as Setup from "./setup.ts";

const HOST = "127.0.0.1";

// The API behind the bearer on `port`; the fleet page is the dashboard's (oligarchy.trm.sh/servers).
// The sweep starts once the listener is up, in the same scope: a port refusal sweeps nothing.
const ServerLive = (port: number) =>
  Serve.serve({
    port,
    routes: Handlers.routes,
    services: Router.Router.layer.pipe(Layer.provideMerge(Setup.Setup.layer)),
    listening: Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.info(`qemu reverse proxy listening on ${HOST}:${String(port)}`, {
        location: Log.Locations.server,
      });
      const setups = yield* Setup.Setup;
      // A database that cannot be listed is the same class of startup failure as a failed ping:
      // watching nothing while rows sit there would leave those setups unwatched.
      yield* setups.install().pipe(
        Effect.catch((error) =>
          log
            .fatal(`qemu reverse proxy: ${Render.errorDetail(error)}`, {
              location: Log.Locations.server,
              cause: error,
            })
            .pipe(Effect.andThen(Effect.die(error))),
        ),
      );
      yield* Sweep.forget("qemu");
    }),
  });

const DatabaseLive = Layer.unwrap(
  Effect.map(Config.ProxyConfig, (config) => Client.Database.layer(config.databaseUrl)),
);

// A ticket is a Linear issue on LINEAR_TEAM. The proxy does not start without the token or the
// team, the same way it does not start without the database.
const LinearLive = Layer.unwrap(
  Effect.map(Config.linearAccess, ({ token, team }) => Linear.Linear.layer(token, team)),
);

// Sentry sits beneath Log so the log rows flush before Sentry does, and Log captures the reporter.
const MainLive = Layer.mergeAll(
  Servers.ServerStore.layer,
  SessionStore.SessionStore.layer,
  SetupRequests.SetupRequestStore.layer,
  Tests.TestStore.layer,
  LinearLive,
  Observability.LogLive,
).pipe(
  Layer.provideMerge(Logs.LogStore.layer),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Config.ProxyConfig.layer),
  Layer.provideMerge(Sentry.SentryLive),
  Layer.provideMerge(NodeHttpClient.layerNodeHttp),
);

const command = QemuReverseProxyCommand.makeQemuReverseProxyCommand({
  serve: ServerLive,
});

// SIGINT and SIGTERM interrupt the program and exit 0; nothing of this process's own is stopping.
const teardown: Runtime.Teardown = (exit, onExit) => {
  onExit(Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? 1 : 0);
};

// Every failure past the graph logs its own fatal line; only a defect is printed for it.
Env.run(Env.program(command, { version: Api.VERSION, layer: MainLive, failuresLogged: true }), {
  teardown,
});
