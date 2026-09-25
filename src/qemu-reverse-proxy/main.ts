import { createServer } from "node:http";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Cause, Deferred, Effect, Exit, Layer, type Runtime } from "effect";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerError from "effect/unstable/http/HttpServerError";
import * as Client from "@oligarchy/db/client";
import * as Logs from "@oligarchy/db/logs";
import * as Servers from "@oligarchy/db/servers";
import * as SessionStore from "@oligarchy/db/sessions";
import * as SetupRequests from "@oligarchy/db/setup-requests";
import * as Tests from "@oligarchy/db/tests";
import * as Config from "@oligarchy/env/config";
import * as Env from "@oligarchy/env/run";
import * as Linear from "@oligarchy/linear/client";
import * as Log from "@oligarchy/log/log";
import * as Render from "@oligarchy/log/render";
import * as Observability from "@oligarchy/observability/log";
import * as Sentry from "@oligarchy/observability/sentry";
import * as Api from "@oligarchy/routes/api";
import * as StaleServers from "../shared/stale-servers.ts";
import * as QemuReverseProxyCommand from "./command.ts";
import * as Handlers from "./handlers.ts";
import * as Router from "./router.ts";
import * as Setup from "./setup.ts";

const HOST = "127.0.0.1";

// The platform drops its error listener once the server is up; a later error still needs the
// fatal line and exit 1. Only the first counts.
const server = createServer();
const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
server.on("error", (cause) => {
  Deferred.doneUnsafe(serverFailed, Exit.fail(new HttpServerError.ServeError({ cause })));
});

// The API behind the bearer on `port`; the fleet page is the dashboard's (oligarchy.trm.sh/servers).
// The sweep starts once the listener is up, in the same scope: a port refusal sweeps nothing.
const ServerLive = (port: number) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
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
      yield* StaleServers.forget("qemu");
    }),
  ).pipe(
    Layer.provide(
      HttpRouter.serve(Handlers.routes, { disableLogger: true, disableListenLog: true }).pipe(
        Layer.provide(NodeHttpServer.layer(() => server, { host: HOST, port })),
      ),
    ),
    Layer.provide(Router.Router.layer),
    Layer.provide(Setup.Setup.layer),
    // As on the qemu server: no http.server span reaches Sentry.
    Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
  );

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
  serverFailed,
});

// SIGINT and SIGTERM interrupt the program and exit 0; nothing of this process's own is stopping.
const teardown: Runtime.Teardown = (exit, onExit) => {
  onExit(Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? 1 : 0);
};

// Every failure past the graph logs its own fatal line; only a defect is printed for it.
Env.run(Env.program(command, { version: Api.VERSION, layer: MainLive, failuresLogged: true }), {
  teardown,
});
