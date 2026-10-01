import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import * as Env from "@oligarchy/env";
import type * as Logger from "@oligarchy/logger";
import * as jarl from "jarl";
import { environment, type Run } from "./environment.ts";
import { restart } from "./restart.ts";
import { closeServices, createServices } from "./services.ts";
import { shutdown } from "./shutdown.ts";

const LOCATION = "automation-server";

const reasonOf = (signal: AbortSignal): string =>
  signal.reason instanceof Error ? signal.reason.message : String(signal.reason);

const aborted = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

// The dispatch sub-app's main. It runs until the server is killed: each pass waits the interval,
// and the kill ends the wait at once. It dispatches nothing yet.
const dispatch = async (sub: App.App<Run>) => {
  const { dispatchInterval } = sub.environment.config.automationServer;
  while (!sub.signal.aborted) {
    await Async.sleep(dispatchInterval, sub.signal);
  }
  return jarl.ok(undefined);
};

// Shutdown runs before main returns, so it finishes before any exit handler closes the services
// under it.
const main = async (app: App.App<Run, Logger.Logger>) => {
  const { logger } = app.services;
  const { models } = app.environment.config;
  logger.info(
    `started; drive ${models.drive}; diagnose ${models.diagnose}; setup ${models.setup}`,
    { location: LOCATION },
  );
  await restart();
  app.sub(new App.App(app.environment).main(dispatch));
  await aborted(app.signal);
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
