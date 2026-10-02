import * as App from "@oligarchy/app";
import * as Env from "@oligarchy/env";
import type * as Http from "@oligarchy/http";
import type * as Logger from "@oligarchy/logger";
import type * as OpenRouter from "@oligarchy/openrouter";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as Drive from "./drive.ts";
import { environment, type Run } from "./environment.ts";
import { TIMED_OUT } from "./exits.ts";
import { closeServices, createServices } from "./services.ts";

let timedOut = false;

// The guest's calls stop with the app: on a signal, or once main returns.
const main = async (
  app: App.App<Run, Logger.Logger | Stores.Tests.Tests | OpenRouter.OpenRouter | Http.Http>,
) => {
  const { flags, vars, config } = app.environment;
  const ended = await Drive.drive(app.services, app.signal, {
    jobId: flags.jobId,
    serverUrl: flags.serverUrl,
    token: vars.oligarchyToken,
    config,
  });
  if (jarl.is_err(ended)) {
    return ended;
  }
  timedOut = jarl.value(ended).status === "timed_out";
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
// The failure in full: its stack names where it was made.
await app.run(
  services,
  (errors) => {
    for (const error of errors) {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
    }
  },
  {
    ...App.processIo,
    exit: (code) => App.processIo.exit(code === 0 && timedOut ? TIMED_OUT : code),
  },
);
