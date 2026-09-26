import { createServer } from "node:http";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Cause, Deferred, Effect, Exit, Layer, type Runtime } from "effect";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerError from "effect/unstable/http/HttpServerError";
import * as Automation from "@oligarchy/db/automation";
import * as Client from "@oligarchy/db/client";
import * as Diagnosis from "@oligarchy/db/diagnosis";
import * as Logs from "@oligarchy/db/logs";
import * as Servers from "@oligarchy/db/servers";
import * as Sessions from "@oligarchy/db/sessions";
import * as SetupRequests from "@oligarchy/db/setup-requests";
import * as Tests from "@oligarchy/db/tests";
import * as Config from "@oligarchy/env/config";
import * as Env from "@oligarchy/env/run";
import * as Sweep from "@oligarchy/fleet/sweep";
import * as Linear from "@oligarchy/linear/client";
import * as Log from "@oligarchy/log/log";
import * as Observability from "@oligarchy/observability/log";
import * as Sentry from "@oligarchy/observability/sentry";
import * as Api from "@oligarchy/routes/api";
import * as Backlog from "./backlog.ts";
import * as AutomationClient from "./client.ts";
import * as AutomationServerCommand from "./command.ts";
import * as Handlers from "./handlers.ts";
import * as Worker from "./worker.ts";

const HOST = "127.0.0.1";

const automationAttr = {
  location: Log.Locations.automation,
  agentId: Log.AutomationAgentId,
} as const;

// The platform drops its error listener once the server is up; a later error still needs the
// fatal line and exit 1. Only the first counts.
const server = createServer();
const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
server.on("error", (cause) => {
  Deferred.doneUnsafe(serverFailed, Exit.fail(new HttpServerError.ServeError({ cause })));
});

// Dispatch, the sweep and the board watch start once the listener is up, in the same scope:
// a port refusal starts none of them, and a shutdown stops them before the pool closes.
const ServerLive = (port: number, models: { drive: string; diagnose: string; mint: string }) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.info(
        `automation server listening on ${HOST}:${String(port)}; drive ${models.drive}; diagnose ${models.diagnose}; mint ${models.mint}`,
        automationAttr,
      );
      yield* Worker.dispatch(models);
      yield* Sweep.forget("automation-client");
      yield* Backlog.watch();
    }),
  ).pipe(
    Layer.provide(
      HttpRouter.serve(Handlers.routes, {
        disableLogger: true,
        disableListenLog: true,
      }).pipe(Layer.provide(NodeHttpServer.layer(() => server, { host: HOST, port }))),
    ),
    // As on the qemu server: no http.server span reaches Sentry.
    Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
  );

const DatabaseLive = Layer.unwrap(Effect.map(Config.databaseUrl, Client.Database.layer));

const LinearLive = Layer.unwrap(
  Effect.gen(function* () {
    const { token, team } = yield* Config.linearAccess;
    const apiUrl = yield* Config.linearApiUrl;
    return Linear.Linear.layer(token, team, apiUrl);
  }),
);

// LINEAR_WEBHOOK_SECRET signs POST /linear; LINEAR_API_TOKEN reads the columns the webhook
// missed and LINEAR_TEAM names the board those columns belong to; OLIGARCHY_TOKEN authenticates
// POST /run to a client and POST /abort from Cloudflare; DATABASE_URL holds the queue, the
// live-server list and the logs rows. Sentry sits beneath Log so Log captures the reporter.
// Lines land in logs with location/agentId "automation"; durable jobs remain automation_jobs.
const MainLive = Layer.mergeAll(
  Observability.LogLive,
  Handlers.LinearWebhookSecret.layer,
  AutomationClient.OligarchyToken.layer,
  Tests.TestStore.layer,
  Automation.AutomationStore.layer,
  Servers.ServerStore.layer,
  Sessions.SessionStore.layer,
  Diagnosis.DiagnosisStore.layer,
  SetupRequests.SetupRequestStore.layer,
  LinearLive,
).pipe(
  Layer.provideMerge(Logs.LogStore.layer),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Sentry.SentryLive),
  Layer.provideMerge(Layer.succeed(Log.ProcessAttribution)(Log.AutomationProcessAttribution)),
  Layer.provideMerge(NodeHttpClient.layerNodeHttp),
);

const command = AutomationServerCommand.makeAutomationServerCommand({
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
