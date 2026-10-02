import { writeFile } from "node:fs/promises";
import * as Env from "@oligarchy/env";
import * as jarl from "jarl";
import * as Commands from "./commands.ts";
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
const code = await Commands.run(services, env, {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  writeFile: (path, data) => writeFile(path, data),
});
const closed = await closeServices(services);
if (jarl.is_err(closed)) {
  process.stderr.write(`${closed.error.message}\n`);
}
// Not process.exit: stdout may still be draining a long logs into a pipe.
process.exitCode = jarl.is_err(closed) ? 1 : code;
