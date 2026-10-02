import * as App from "@oligarchy/app";
import * as Env from "@oligarchy/env";
import { listen } from "@oligarchy/http/serve";
import * as jarl from "jarl";
import * as Application from "./application.js";
import { environment } from "./environment.ts";
import { closeServices, createServices } from "./services.ts";

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

const app = new App.App(env).main(Application.main({ listen }));
app.onExit(async () => {
  await services.iso.close();
  return closeServices(services);
});
await app.run(services, (errors) => {
  for (const error of errors) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
});
