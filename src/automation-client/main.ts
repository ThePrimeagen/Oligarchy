import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Deferred, Effect, Exit, Layer, Option, type Runtime } from "effect";
import { Command } from "effect/unstable/cli";
import { HttpMiddleware, HttpRouter, HttpServerError } from "effect/unstable/http";
import * as Config from "../config.ts";
import * as Client from "../db/client.ts";
import * as Logs from "../db/logs.ts";
import * as Servers from "../db/servers.ts";
import * as Heartbeat from "../host/heartbeat.ts";
import * as Stats from "../host/stats.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Sentry from "../observability/sentry.ts";
import * as Process from "../qemu/process.ts";
import * as Api from "../shared/api.ts";
import * as AutomationClientCommand from "./command.ts";
import * as Handlers from "./handlers.ts";
import * as OpenCode from "./opencode.ts";
import * as Runs from "./runs.ts";

const HOST = "127.0.0.1";

const automationClientAttr = Log.AutomationClientProcessAttribution;

// stdout is the convenience copy of the log; the logs rows, the servers row and Sentry are
// the record. A write refused by a full filesystem is dropped, never an uncaught exception per
// line (see the qemu server's main).
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

// The platform drops its error listener once the server is up; a later error still needs the
// fatal line and exit 1. Only the first counts.
const server = createServer({ keepAlive: true, keepAliveInitialDelay: 30_000 });
const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
server.on("error", (cause) => {
  Deferred.doneUnsafe(serverFailed, Exit.fail(new HttpServerError.ServeError({ cause })));
});

const ServerLive = (port: number, url: Option.Option<string>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.acquireColor(Log.AutomationClientAgentId);
      yield* log.info(
        `oligarchy automation client listening on ${HOST}:${String(port)}; model ${OpenCode.MODEL}${Option.match(url, { onNone: () => "", onSome: (announced) => `; announcing ${announced}` })}`,
        automationClientAttr,
      );
      const runs = yield* Runs.Runs;
      const row = Effect.map(runs.stats, (stats) => ({
        agents: stats.agents,
        ...Heartbeat.hostRow(stats),
      }));
      yield* Option.match(url, {
        onNone: () => Effect.void,
        onSome: (announced) => Heartbeat.announce(announced, "automation", row),
      });
    }),
  ).pipe(
    Layer.provide(
      HttpRouter.serve(Handlers.routes, { disableLogger: true, disableListenLog: true }),
    ),
    Layer.provide(Runs.Runs.layer),
    Layer.provide(Layer.mergeAll(OpenCode.layer, Stats.Stats.layer)),
    Layer.provide(
      NodeHttpServer.layer(() => server, { host: HOST, port, disablePreemptiveShutdown: true }),
    ),
    Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
  );

const DatabaseLive = Layer.unwrap(
  Effect.map(Config.ProxyConfig, (config) => Client.Database.layer(config.databaseUrl)),
);

const MainLive = Layer.mergeAll(Servers.ServerStore.layer, Log.Log.layer).pipe(
  Layer.provideMerge(Logs.LogStore.layer),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Config.ProxyConfig.layer),
  Layer.provideMerge(Sentry.SentryLive),
  Layer.provideMerge(Layer.succeed(Log.ProcessAttribution)(Log.AutomationClientProcessAttribution)),
  Layer.provideMerge(Config.providerLayer),
  Layer.provideMerge(NodeServices.layer),
);

const missingHostRequirements = Effect.gen(function* () {
  const found = yield* Process.commandExists(OpenCode.BIN);
  return found ? [] : [`${OpenCode.BIN} not on PATH`];
});

const command = AutomationClientCommand.makeAutomationClientCommand({
  missingHostRequirements,
  serve: ServerLive,
  serverFailed,
});

// The graph is built before the command runs: a missing OLIGARCHY_TOKEN or DATABASE_URL is the
// one failure no Log exists to record, so it is printed here. Every later failure logs its own
// fatal line; a defect has nothing else to say for it.
const program = Effect.gen(function* () {
  const services = yield* Layer.build(MainLive).pipe(Effect.tapCause(Render.reportFailure));
  yield* Command.run(command, { version: Api.VERSION }).pipe(
    Effect.provide(services),
    Effect.tapDefect((defect) => Render.reportFailure(Cause.die(defect))),
  );
}).pipe(Effect.scoped);

// SIGINT and SIGTERM interrupt the program and exit 0; in-flight runs are interrupted with them.
const teardown: Runtime.Teardown = (exit, onExit) => {
  onExit(Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? 1 : 0);
};

NodeRuntime.runMain(program, { disableErrorReporting: true, teardown });
