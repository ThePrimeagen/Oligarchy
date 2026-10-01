import type * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import type * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as Logger from "@oligarchy/logger";
import * as Sentry from "@oligarchy/sentry";
import type * as jarl from "jarl";
import * as Jobs from "./jobs.ts";

export type Services = {
  readonly http: App.Made<Http.Http>;
  readonly sentry: App.Made<Sentry.Sentry>;
  readonly db: App.Made<Db.Database>;
  readonly logger: App.Made<Logger.Logger>;
  readonly jobs: App.Made<Jobs.Jobs>;
};

export type Terminal = {
  readonly write: (line: string) => void;
  readonly colors: boolean;
};

// Everything the services reach outside the process but the database, which env names.
export type World = {
  readonly terminal: Terminal;
  readonly http: App.Made<Http.Http>;
};

const live = (): World => ({
  terminal: {
    write: (line) => process.stdout.write(`${line}\n`),
    colors: process.stdout.isTTY,
  },
  http: Http.create({}),
});

// Every line is printed and stored in the logs table; an error or fatal line, and a line that
// could not be stored, also go to the project's Sentry.
export const createServices = (
  env: { readonly vars: { readonly databaseUrl: Env.Secret } },
  world: World = live(),
): Services => {
  const { terminal, http } = world;
  const sentry = Sentry.create({ http }, { dsn: Sentry.DSN, environment: Sentry.ENVIRONMENT });
  const db = Db.create({}, { url: env.vars.databaseUrl });
  const logger = Logger.create({ sentry, db }, { write: terminal.write, colors: terminal.colors });
  const jobs = Jobs.create({});
  return { http, sentry, db, logger, jobs };
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
