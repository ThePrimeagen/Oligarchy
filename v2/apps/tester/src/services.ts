import type * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as Logger from "@oligarchy/logger";
import * as Sentry from "@oligarchy/sentry";
import * as Stores from "@oligarchy/stores";
import type * as jarl from "jarl";

export type Services = App.Needs<
  Http.Http | Sentry.Sentry | Db.Database | Stores.Logs.Logs | Logger.Logger
>;

export type Terminal = {
  readonly write: (line: string) => void;
  readonly colors: boolean;
};

// Everything the services reach outside the process but the database, which env names.
export type World = App.Needs<App.Made<Http.Http>> & { readonly terminal: Terminal };

const live = (config: Pick<Env.Config, "httpTimeout">): World => ({
  terminal: {
    write: (line) => process.stdout.write(`${line}\n`),
    colors: process.stdout.isTTY,
  },
  http: Http.create({}, { timeoutMs: config.httpTimeout }),
});

// The environment in, the services out. Every line is printed and stored in the logs table; a
// connection the database drops is a line too, printed even when it cannot be stored. An error or
// fatal line, and a line that could not be stored, also go to the project's Sentry.
export const createServices = (
  env: {
    readonly vars: { readonly databaseUrl: Env.Secret };
    readonly config: Pick<Env.Config, "httpTimeout">;
  },
  world: World = live(env.config),
) => {
  const { terminal, http } = world;
  const sentry = Sentry.create({ http }, { dsn: Sentry.DSN, environment: Sentry.ENVIRONMENT });
  const db = Db.create({}, { url: env.vars.databaseUrl });
  const logs = Stores.Logs.create({ db });
  const logger = Logger.create({ sentry, db }, { write: terminal.write, colors: terminal.colors });
  return { http, sentry, db, logs, logger } satisfies Services;
};

// Every line waits on its insert, so the pool stays open until the last one lands; a line the
// close itself logs lands, or fails to, before Sentry is waited on.
export const closeServices = async (
  services: App.Needs<Db.Database | Logger.Logger | Sentry.Sentry>,
): Promise<jarl.Result<void, Db.DatabaseError>> => {
  await services.logger.flush();
  const closed = await services.db.close();
  await services.logger.flush();
  await services.sentry.wait();
  return closed;
};
