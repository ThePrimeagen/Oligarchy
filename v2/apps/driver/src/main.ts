import * as App from "@oligarchy/app";
import * as Env from "@oligarchy/env";
import * as jarl from "jarl";
import * as Application from "./application.ts";
import { environment } from "./environment.ts";
import { TIMED_OUT } from "./exits.ts";
import { closeServices, createServices } from "./services.ts";

let timedOut = false;

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

const app = new App.App(env).main(
  Application.main({
    timedOut: () => {
      timedOut = true;
    },
  }),
);
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
