import * as App from "@oligarchy/app";
import * as Env from "@oligarchy/env";
import * as Fleet from "@oligarchy/fleet";
import type * as Http from "@oligarchy/http";
import { listen } from "@oligarchy/http/serve";
import type * as Logger from "@oligarchy/logger";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { environment, type Run } from "./environment.ts";
import * as Jobs from "./jobs.ts";
import * as QemuServer from "./qemu-server.ts";
import * as Reserve from "./reserve.ts";
import { routes } from "./routes.ts";
import { closeServices, createServices } from "./services.ts";

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
const announcing = (jobs: Jobs.Jobs) => async (sub: App.App<Run, Announcing>) => {
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
const main = async (app: App.App<Run, Announcing | Http.Http>) => {
  const { logger, http } = app.services;
  const { flags, vars } = app.environment;
  const jobs = Jobs.create();
  const reservations = Reserve.create({
    maxJobs: flags.maxJobs,
    jobs,
    qemuServer: QemuServer.create({ http, url: flags.serverUrl, token: vars.oligarchyToken }),
    logger,
  });
  const listened = await listen(
    routes({
      token: vars.oligarchyToken.reveal(),
      sessions: { reserve: reservations.reserve, abort: jobs.abort },
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

const created = await Env.create(environment);
if (jarl.error.is(created, Env.HelpRequested)) {
  process.stdout.write(created.error.text);
  process.exit(0);
}
if (jarl.error.is(created, Env.Unexpected)) {
  // A bug, not a refusal: the stack is what finds it.
  console.error(created.error.message, created.error.cause);
  process.exit(1);
}
if (jarl.is_err(created)) {
  process.stderr.write(`${created.error.message}\n`);
  process.exit(1);
}

const env = jarl.value(created);

const services = createServices(env);

const app = new App.App(env).main(main);
app.onExit(() => closeServices(services));
await app.run(services, (errors) => {
  for (const error of errors) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
});
