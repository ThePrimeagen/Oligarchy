import * as App from "@oligarchy/app";
import * as Fleet from "@oligarchy/fleet";
import type * as Http from "@oligarchy/http";
import type * as Serve from "@oligarchy/http/serve";
import type * as Logger from "@oligarchy/logger";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import type * as Child from "./child.ts";
import type * as Environment from "./environment.ts";
import * as Jobs from "./jobs.ts";
import * as Proxy from "./proxy.ts";
import * as Reserve from "./reserve.ts";
import { routes } from "./routes.ts";
import * as Run from "./run.ts";

const LOCATION = "automation-client";
const HOST = "127.0.0.1";

const reasonOf = (signal: AbortSignal): string =>
  signal.reason instanceof Error ? signal.reason.message : String(signal.reason);

type Announcing =
  | Fleet.Host.Host
  | Fleet.Usage.Usage
  | Stores.Servers.Servers
  | Stores.ProcessStats.ProcessStats
  | Logger.Logger;

// The announce sub-app's main: the servers row under --url, written now and every heartbeat with
// the host's cpu sampled in between, until the client is killed; then the row goes. It boots no
// guests itself; each reading counts the jobs held.
const announcing = (jobs: Jobs.Jobs) => async (sub: App.App<Environment.Run, Announcing>) => {
  const { host, usage, servers, processStats, logger } = sub.services;
  const { name, url } = sub.environment.flags;
  await Promise.all([
    Fleet.Host.sampling(host, sub.signal),
    Fleet.announce(
      {
        type: "automation-client",
        url,
        name,
        attribution: { location: LOCATION },
        report: async () => jarl.ok({ qemus: 0, jobs: jobs.count() }),
      },
      { host, usage, servers, processStats, logger },
      sub.signal,
    ),
  ]);
  return jarl.ok(undefined);
};

// Nothing starts unless the port is bound, so a client that cannot serve is never announced. On a
// signal the listener closes first, so no request lands during shutdown; closing ends the
// connections but not a /run still under way, so every job held is then aborted and let go. Both
// finish before main returns, and every sub-app's main has returned, its row deleted, before any
// exit handler closes the services under them.
export const main =
  (options: {
    readonly listen: typeof Serve.listen;
    readonly spawn: Child.Spawn;
    readonly env: Run.Options["env"];
  }) =>
  async (app: App.App<Environment.Run, Announcing | Http.Http>) => {
    const { logger, http } = app.services;
    const { flags, vars, config } = app.environment;
    const jobs = Jobs.create();
    const reservations = Reserve.create({
      maxJobs: flags.maxJobs,
      jobs,
      proxy: Proxy.create({
        http,
        url: flags.serverUrl,
        token: vars.oligarchyToken,
        reserveTimeoutMs: config.automationClient.reserveTimeout,
      }),
      logger,
    });
    const run = Run.create({
      reservations,
      spawn: options.spawn,
      env: options.env,
      serverUrl: flags.serverUrl,
      config,
      vars,
      logger,
    });
    const listened = await options.listen(
      routes({
        token: vars.oligarchyToken.reveal(),
        sessions: { reserve: reservations.reserve, run, abort: jobs.abort },
      }).fetch,
      { hostname: HOST, port: flags.port },
    );
    if (jarl.is_err(listened)) {
      logger.fatal(listened.error.message, { location: LOCATION });
      return listened;
    }
    logger.info(
      `started on ${HOST}:${String(flags.port)}; name ${flags.name}; announcing ${flags.url}`,
      { location: LOCATION },
    );
    app.sub(new App.App(app.environment).main(announcing(jobs)));
    await App.waitForAbort(app.signal);
    await jarl.value(listened).close();
    await jobs.shutdown();
    logger.info(`stopped; ${reasonOf(app.signal)}`, { location: LOCATION });
    return jarl.ok(undefined);
  };
