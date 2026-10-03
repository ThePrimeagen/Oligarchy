#!/usr/bin/env -S bun --no-env-file
import * as App from "@oligarchy/app";
import { createClef } from "../shared/clef.ts";
import { environmentOf, printErrors } from "../shared/start.ts";
import * as Application from "./application.ts";
import { environment } from "./environment.ts";

const env = await environmentOf(environment);
const services = createClef(env, env.flags.model);
const app = new App.App(env).main(
  Application.main({ write: (line) => process.stdout.write(`${line}\n`) }),
);
await app.run(services, printErrors);
