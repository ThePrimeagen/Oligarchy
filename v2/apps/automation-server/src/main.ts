import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import * as Env from "@oligarchy/env";
import * as Fleet from "@oligarchy/fleet";
import type * as Http from "@oligarchy/http";
import { listen } from "@oligarchy/http/serve";
import type * as Logger from "@oligarchy/logger";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as Dispatch from "./dispatch.ts";
import { environment, type Run } from "./environment.ts";
import { restart } from "./restart.ts";
import { routes } from "./routes.ts";
import { closeServices, createServices } from "./services.ts";
import { shutdown } from "./shutdown.ts";

const LOCATION = "automation-server";
const HOST = "127.0.0.1";

const reasonOf = (signal: AbortSignal): string =>
  signal.reason instanceof Error ? signal.reason.message : String(signal.reason);

// The dispatch sub-app's main. It runs until the server is killed: once a job is started the next
// is tried at once, and when none could be it waits the interval, which the kill ends at once.
type DispatchWants =
  | Http.Http
  | Stores.Tests.Tests
  | Stores.Servers.Servers
  | Stores.SetupRequests.SetupRequests
  | Logger.Logger;

const dispatch = async (sub: App.App<Run, DispatchWants>) => {
  const { dispatchInterval } = sub.environment.config.automationServer;
  const dispatcher = Dispatch.create({
    ...sub.services,
    token: sub.environment.vars.oligarchyToken,
    signal: sub.signal,
  });
  while (!sub.signal.aborted) {
    const started = await dispatcher.startNextJob();
    if (!started) {
      await Async.sleep(dispatchInterval, sub.signal);
    }
  }
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
// lands during shutdown, and shutdown runs before main returns, so it finishes before any exit
// handler closes the services under it.
const main = async (app: App.App<Run, DispatchWants>) => {
  const { logger } = app.services;
  const { config, flags, vars } = app.environment;
  const { models } = config;
  const listened = await listen(routes({ token: vars.oligarchyToken.reveal() }).fetch, {
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
  app.sub(new App.App(app.environment).main(dispatch));
  await App.waitForAbort(app.signal);
  await listening.close();
  await shutdown();
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
