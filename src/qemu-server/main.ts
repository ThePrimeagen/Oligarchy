import { createServer } from "node:http";
import { NodeHttpClient, NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Deferred, Effect, Exit, Layer, MutableRef, Option, type Runtime } from "effect";
import { Command } from "effect/unstable/cli";
import { HttpMiddleware, HttpRouter, HttpServerError } from "effect/unstable/http";
import * as Config from "../config.ts";
import * as Actions from "../db/actions.ts";
import * as Client from "../db/client.ts";
import * as DebugLogs from "../db/debug-logs.ts";
import * as Logs from "../db/logs.ts";
import * as ProcessStats from "../db/process-stats.ts";
import * as Servers from "../db/servers.ts";
import * as SessionStore from "../db/sessions.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Sentry from "../observability/sentry.ts";
import * as Host from "../qemu/host.ts";
import * as Iso from "../qemu/iso.ts";
import * as Qemu from "../qemu/qemu.ts";
import * as Stats from "../qemu/stats.ts";
import * as Api from "../shared/api.ts";
import type * as Domain from "../shared/domain.ts";
import * as ProcessUsage from "../shared/process-usage.ts";
import * as QemuServerCommand from "./command.ts";
import * as Handlers from "./handlers.ts";
import * as Heartbeat from "./heartbeat.ts";
import * as Sessions from "./sessions.ts";

const HOST = "127.0.0.1";

// Shared with the Sessions drain: the reason surviving rows close with, and whether one refused.
const shutdown = Sessions.Shutdown.defaultValue();

// stdout is the convenience copy of the log; the rows and Sentry are the record. When it is a file
// on a full disk, Node reports the failed write as an 'error' event that, unhandled, is an uncaught
// exception per line — which took a qemu server down under six installs filling a tmpfs. Drop the line.
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

// The platform drops its error listener once the server is up; a later server error (the
// acceptor breaking) still needs the fatal line, the drain and exit 1. Only the first counts:
// later accept errors must not exit before the first fatal flush finishes.
const server = createServer();
const serverFailed = Deferred.makeUnsafe<never, HttpServerError.ServeError>();
server.on("error", (cause) => {
  if (Deferred.doneUnsafe(serverFailed, Exit.fail(new HttpServerError.ServeError({ cause })))) {
    MutableRef.set(shutdown.reason, `qemu server error: ${cause.message}`);
  }
});

// The heartbeat starts once the listener is up, in the same scope: a port refusal announces
// nothing, and a shutdown deletes the row it wrote.
const ServerLive = (
  display: Domain.QemuDisplay,
  automation: boolean,
  maxJobs: number,
  name: string,
  port: number,
  url: Option.Option<string>,
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.info(
        `qemu server listening on ${HOST}:${String(port)}; name ${name}; display ${display}${automation ? "; automation" : ""}; max jobs ${String(maxJobs)}${Option.match(url, { onNone: () => "", onSome: (announced) => `; announcing ${announced}` })}`,
        { location: Log.Locations.server },
      );
      yield* Option.match(url, {
        onNone: () => Effect.void,
        onSome: (announced) => Heartbeat.announce(announced, name),
      });
    }),
  ).pipe(
    Layer.provide(
      HttpRouter.serve(Handlers.routes(display, automation), {
        disableLogger: true,
        disableListenLog: true,
      }),
    ),
    Layer.provide(Sessions.Sessions.layer(maxJobs)),
    Layer.provide(Layer.succeed(Sessions.Shutdown)(shutdown)),
    Layer.provide(
      Layer.mergeAll(
        Qemu.Qemu.layer,
        Iso.Iso.layer,
        Stats.Stats.layer,
        ProcessUsage.ProcessUsage.layer,
      ),
    ),
    // Bound before Sessions exists: a port refusal is one fatal line, never a drain.
    Layer.provide(NodeHttpServer.layer(() => server, { host: HOST, port })),
    // Root session spans require no request span above them.
    Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
  );

const DatabaseLive = Layer.unwrap(
  Effect.map(Config.ProxyConfig, (config) => Client.Database.layer(config.databaseUrl)),
);

// Sentry sits beneath Log so the log rows flush before Sentry does, and Log captures the reporter.
const MainLive = Layer.mergeAll(
  SessionStore.SessionStore.layer,
  DebugLogs.DebugLogStore.layer,
  Servers.ServerStore.layer,
  ProcessStats.ProcessStatsStore.layer,
  Log.Log.layer,
).pipe(
  Layer.provideMerge(Actions.ActionStore.layer),
  Layer.provideMerge(Logs.LogStore.layer),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Config.ProxyConfig.layer),
  Layer.provideMerge(Sentry.SentryLive),
  Layer.provideMerge(Config.providerLayer),
  Layer.provideMerge(NodeHttpClient.layerNodeHttp),
  Layer.provideMerge(NodeServices.layer),
);

const qemuServerCommand = QemuServerCommand.makeQemuServerCommand({
  missingHostRequirements: Host.missingHostRequirements,
  serve: ServerLive,
  serverFailed,
});

// The graph is built before the command runs: a missing variable or a bad DATABASE_URL is the one
// failure no Log exists to record, so it is printed here. Every later failure logs its own fatal
// line; a defect has nothing else to say for it.
const program = Effect.gen(function* () {
  const services = yield* Layer.build(MainLive).pipe(Effect.tapCause(Render.reportFailure));
  yield* Command.run(qemuServerCommand, { version: Api.VERSION }).pipe(
    Effect.provide(services),
    Effect.tapDefect((defect) => Render.reportFailure(Cause.die(defect))),
  );
}).pipe(Effect.scoped);

// SIGINT and SIGTERM interrupt the program and exit 0 unless a session refused to drain.
const teardown: Runtime.Teardown = (exit, onExit) => {
  if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
    onExit(1);
    return;
  }
  onExit(MutableRef.get(shutdown.failed) ? 1 : 0);
};

NodeRuntime.runMain(program, { disableErrorReporting: true, teardown });
