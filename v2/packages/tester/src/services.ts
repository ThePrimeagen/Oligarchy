import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as Logger from "@oligarchy/logger";
import * as Sentry from "@oligarchy/sentry";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";

export const environment = Env.cli({
  name: "tester",
  description: "Log how many test suites are running, then how many tests passed and failed",
})
  .needs("databaseUrl")
  .done();

export type Services = {
  readonly http: Http.Http;
  readonly sentry: Sentry.Sentry;
  readonly db: Db.Database;
  readonly logs: Stores.Logs.Logs;
  readonly logger: Logger.Logger;
};

export type Terminal = {
  readonly write: (line: string) => void;
  readonly colors: boolean;
};

// Everything the services reach outside the process but the database, which env names.
export type World = {
  readonly terminal: Terminal;
  readonly http: Http.Http;
};

const live = (): World => ({
  terminal: {
    write: (line) => process.stdout.write(`${line}\n`),
    colors: process.stdout.isTTY,
  },
  http: Http.create(),
});

// The environment in, the services out. Every line is printed and stored in the logs table; a
// connection the database drops is a line too, printed even when it cannot be stored. An error or
// fatal line, and a line that could not be stored, also go to the project's Sentry.
export const createServices = (
  env: { readonly vars: { readonly databaseUrl: Env.Secret } },
  world: World = live(),
): jarl.Result<Services, Db.DatabaseError> => {
  const { terminal, http } = world;
  const sentry = Sentry.create({ dsn: Sentry.DSN, environment: Sentry.ENVIRONMENT, http });
  const opened = Db.open({
    url: env.vars.databaseUrl,
    onPoolError: (error) => {
      logger.error(`db: pool error: ${error.message}`, { cause: error });
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
    sentry,
    store: (row) =>
      logs.insertLog({ text: row.text, level: row.level, location: row.location, runId: null }),
  });
  return jarl.ok({ http, sentry, db, logs, logger });
};

// Every line waits on its insert, so the pool stays open until the last one lands; a line the
// close itself logs lands, or fails to, before Sentry is waited on.
export const closeServices = async (
  services: Pick<Services, "db" | "logger" | "sentry">,
): Promise<jarl.Result<void, Db.DatabaseError>> => {
  await services.logger.flush();
  const closed = await services.db.close();
  await services.logger.flush();
  await services.sentry.wait();
  return closed;
};
