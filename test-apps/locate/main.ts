#!/usr/bin/env -S bun --no-env-file
import * as App from "@oligarchy/app";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { environmentOf, printErrors } from "../shared/start.ts";
import * as Application from "./application.ts";
import { environment } from "./environment.ts";
import { createServices } from "./services.ts";

const env = await environmentOf(environment);
const calls: Array<number> = [];
const services = createServices(env, (ms) => calls.push(ms));
const app = new App.App(env).main(
  Application.main({
    calls,
    write: (line) => process.stdout.write(`${line}\n`),
    outRoot: join(dirname(fileURLToPath(import.meta.url)), "..", "out"),
  }),
);
await app.run(services, printErrors);
