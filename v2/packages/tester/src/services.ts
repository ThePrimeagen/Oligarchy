import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as Logger from "@oligarchy/logger";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";

export const environment = Env.cli({
  name: "tester",
  description: "Log how many test suites are running, then how many tests passed and failed",
})
  .needs("databaseUrl")
  .done();

export type Services = {
  readonly db: Db.Database;
  readonly logs: Stores.Logs.Logs;
  readonly logger: Logger.Logger;
};

export type Terminal = {
  readonly write: (line: string) => void;
  readonly colors: boolean;
};

const stdout: Terminal = {
  write: (line) => process.stdout.write(`${line}\n`),
  colors: process.stdout.isTTY,
};

// Every line is printed and stored in the logs table; a connection the database drops is a line
// too, printed even when it cannot be stored.
export const createServices = (
  env: { readonly vars: { readonly databaseUrl: Env.Secret } },
  terminal: Terminal = stdout,
): jarl.Result<Services, Db.DatabaseError> => {
  const opened = Db.open({
    url: env.vars.databaseUrl,
    onPoolError: (error) => {
      logger.error(`db: pool error: ${error.message}`);
    },
  });
  if (!opened.ok) {
    return opened;
  }
  const db = jarl.value(opened);
  const logs = Stores.Logs.create(db);
  const logger = Logger.create({
    write: terminal.write,
    colors: terminal.colors,
    store: logs.insertLog,
  });
  return jarl.ok({ db, logs, logger });
};
