import * as App from "@oligarchy/app";
import * as Env from "@oligarchy/env";
import { listen } from "@oligarchy/http/serve";
import type * as Logger from "@oligarchy/logger";
import * as jarl from "jarl";
import { environment, type Run } from "./environment.ts";
import { routes } from "./routes.ts";
import { closeServices, createServices } from "./services.ts";

const LOCATION = "automation-client";
const HOST = "127.0.0.1";

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

// Nothing starts unless the port is bound. On a signal the listener closes before main returns,
// so it finishes before any exit handler closes the services under it.
const main = async (app: App.App<Run, Logger.Logger>) => {
  const { logger } = app.services;
  const { flags, vars } = app.environment;
  const listened = await listen(routes({ token: vars.oligarchyToken.reveal() }).fetch, {
    hostname: HOST,
    port: flags.port,
  });
  if (jarl.is_err(listened)) {
    logger.fatal(listened.error.message, { location: LOCATION });
    return listened;
  }
  logger.info(`started on ${HOST}:${String(flags.port)}`, { location: LOCATION });
  await aborted(app.signal);
  await jarl.value(listened).close();
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
