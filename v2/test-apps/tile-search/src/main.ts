#!/usr/bin/env -S bun --no-env-file
import * as App from "@oligarchy/app";
import * as Env from "@oligarchy/env";
import * as jarl from "jarl";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Application from "./application.ts";
import { environment } from "./environment.ts";
import { createServices } from "./services.ts";

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
const calls: Array<number> = [];
const { services, locators } = createServices(env, (ms) => calls.push(ms));
const app = new App.App(env).main(
  Application.main({
    locators,
    calls,
    write: (line) => process.stdout.write(`${line}\n`),
    outRoot: join(dirname(fileURLToPath(import.meta.url)), "..", "out"),
  }),
);
await app.run(services, (errors) => {
  for (const error of errors) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
});
