import type * as App from "@oligarchy/app";
import * as Env from "@oligarchy/env";
import * as jarl from "jarl";

// Env.create as every V2 main ends it: help printed and exit 0, a refusal on stderr and exit 1.
export const environmentOf = async <Out>(environment: Env.Environment<Out>): Promise<Out> => {
  const created = await Env.create(environment);
  if (jarl.error.is(created, Env.HelpRequested)) {
    process.stdout.write(created.error.text);
    process.exit(0);
  }
  if (jarl.error.is(created, Env.Unexpected)) {
    console.error(created.error.message, created.error.cause);
    process.exit(1);
  }
  if (jarl.is_err(created)) {
    process.stderr.write(`${created.error.message}\n`);
    process.exit(1);
  }
  return jarl.value(created);
};

// App.run's onClose: every error the app ended with, one line each on stderr.
export const printErrors: App.OnClose = (errors) => {
  for (const error of errors) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
};
