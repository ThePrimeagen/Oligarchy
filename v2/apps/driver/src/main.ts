import * as App from "@oligarchy/app";
import * as DriveHarness from "@oligarchy/drive-harness";
import * as Env from "@oligarchy/env";
import type * as Logger from "@oligarchy/logger";
import type * as OpenRouter from "@oligarchy/openrouter";
import type * as Qemu from "@oligarchy/qemu-http-tools";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as Drive from "./drive.ts";
import { environment, type Run } from "./environment.ts";
import { closeServices, createServices } from "./services.ts";

const main = async (
  app: App.App<
    Run,
    Logger.Logger | Stores.Tests.Tests | Qemu.QemuHttpTools | OpenRouter.OpenRouter
  >,
) => {
  const { flags, config } = app.environment;
  const harness = new DriveHarness.DriveHarness(app.services, {
    recentActions: config.harness.recentActions,
  });
  const ended = await Drive.drive(app.services, harness, {
    jobId: flags.jobId,
    config,
    signal: app.signal,
  });
  return jarl.is_err(ended) ? ended : jarl.ok(undefined);
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

// The guest's calls stop with the app: on a signal, or once main returns.
const guest = new AbortController();
const services = createServices(env, guest.signal);

const app = new App.App(env).main(main);
app.signal.addEventListener("abort", () => guest.abort(app.signal.reason), { once: true });
app.onExit(() => closeServices(services));
await app.run(services, (errors) => {
  for (const error of errors) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
});
