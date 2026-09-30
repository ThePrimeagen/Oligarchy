import type * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as Logger from "@oligarchy/logger";
import * as Stores from "@oligarchy/stores";

export const environment = Env.cli({
  name: "tester",
  description: "Log how many test suites are running, then how many tests passed and failed",
})
  .needs("databaseUrl")
  .done();

export type Services = {
  readonly db: App.Made<Db.Database>;
  readonly logs: App.Made<Stores.Logs.Logs>;
  readonly logger: App.Made<Logger.Logger>;
};

export type Terminal = {
  readonly write: (line: string) => void;
  readonly colors: boolean;
};

const stdout: Terminal = {
  write: (line) => process.stdout.write(`${line}\n`),
  colors: process.stdout.isTTY,
};

// The environment in, the services out. Every line is printed and stored in the logs table; a
// connection the database drops is a line too, printed even when it cannot be stored.
export const createServices = (
  env: { readonly vars: { readonly databaseUrl: Env.Secret } },
  terminal: Terminal = stdout,
): Services => {
  const db = Db.create({}, { url: env.vars.databaseUrl });
  const logs = Stores.Logs.create({ db });
  const logger = Logger.create({ db }, { write: terminal.write, colors: terminal.colors });
  return { db, logs, logger };
};
