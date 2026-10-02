import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import * as Fleet from "@oligarchy/fleet";
import type * as Http from "@oligarchy/http";
import type * as Serve from "@oligarchy/http/serve";
import type * as Logger from "@oligarchy/logger";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as Abort from "./abort.ts";
import * as Dispatch from "./dispatch.ts";
import type { Run } from "./environment.ts";
import { restart } from "./restart.ts";
import { routes } from "./routes.ts";
import { shutdown } from "./shutdown.ts";

const LOCATION = "automation-server";
const HOST = "127.0.0.1";

const reasonOf = (signal: AbortSignal): string =>
  signal.reason instanceof Error ? signal.reason.message : String(signal.reason);

// The dispatch sub-app's main. It runs until the server is killed: once a job is started the next
// is tried at once, and when none could be it waits the interval, which the kill ends at once. It
// returns only once every run in flight is closed, so none is closed after its services are.
type DispatchWants =
  | Http.Http
  | Stores.Tests.Tests
  | Stores.Servers.Servers
  | Stores.SetupRequests.SetupRequests
  | Stores.Diagnosis.Diagnosis
  | Logger.Logger;

const dispatch = (aborting: Abort.Aborting) => async (sub: App.App<Run, DispatchWants>) => {
  const { config, vars } = sub.environment;
  const { dispatchInterval } = config.automationServer;
  const dispatcher = Dispatch.create({
    ...sub.services,
    token: vars.oligarchyToken,
    models: config.models,
    aborting,
    signal: sub.signal,
  });
  while (!sub.signal.aborted) {
    const started = await dispatcher.startNextJob();
    if (!started) {
      await Async.sleep(dispatchInterval, sub.signal);
    }
  }
  await dispatcher.waitForRuns();
  return jarl.ok(undefined);
};

// The forget sub-app's main. It runs until the server is killed: each pass forgets the automation
// clients silent for longer than forgetAfter, so dispatch never reserves on a dead one, then waits
// the interval, and the kill ends the wait at once.
const forgetClients = async (sub: App.App<Run, Stores.Servers.Servers | Logger.Logger>) => {
  const { servers, logger } = sub.services;
  const { forgetInterval, forgetAfter } = sub.environment.config.automationServer;
  while (!sub.signal.aborted) {
    await Fleet.forget(
      "automation-client",
      { servers, logger, attribution: { location: LOCATION } },
      { silentFor: forgetAfter },
    );
    await Async.sleep(forgetInterval, sub.signal);
  }
  return jarl.ok(undefined);
};

// Nothing starts unless the port is bound. On a signal the listener closes first, so no request
// lands during shutdown; the aborts it had taken finish writing, and shutdown runs, before main
// returns, so both finish before any exit handler closes the services under them.
export const main =
  (options: { readonly listen: typeof Serve.listen }) =>
  async (app: App.App<Run, DispatchWants>) => {
    const { logger } = app.services;
    const { config, flags, vars } = app.environment;
    const { models } = config;
    const aborting: Abort.Aborting = new Set();
    const aborter = Abort.create(app.services, { token: vars.oligarchyToken, aborting });
    const served = routes({ token: vars.oligarchyToken.reveal(), abort: aborter.abort });
    const listened = await options.listen(served.fetch, {
      hostname: HOST,
      port: flags.port,
    });
    if (jarl.is_err(listened)) {
      logger.fatal(listened.error.message, { location: LOCATION });
      return listened;
    }
    const listening = jarl.value(listened);
    logger.info(
      `started on ${HOST}:${String(flags.port)}; drive ${models.drive}; diagnose ${models.diagnose}; setup ${models.setup}`,
      { location: LOCATION },
    );
    await restart();
    app.sub(new App.App(app.environment).main(forgetClients));
    app.sub(new App.App(app.environment).main(dispatch(aborting)));
    await App.waitForAbort(app.signal);
    await listening.close();
    await aborter.settled();
    await shutdown();
    logger.info(`stopped; ${reasonOf(app.signal)}`, { location: LOCATION });
    return jarl.ok(undefined);
  };
