import type * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import type * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as Logger from "@oligarchy/logger";
import * as OpenRouter from "@oligarchy/openrouter";
import * as Sentry from "@oligarchy/sentry";
import * as Stores from "@oligarchy/stores";
import type * as jarl from "jarl";

// The most asks of one completion, the first included.
const ATTEMPTS = 3;

export type Services = App.Needs<
  | Http.Http
  | Sentry.Sentry
  | Db.Database
  | Logger.Logger
  | Stores.Tests.Tests
  | OpenRouter.OpenRouter
>;

// Every line is printed and stored in the logs table; an error or fatal line, and a line that
// could not be stored, also go to the project's Sentry.
export const createServices = (env: {
  readonly vars: {
    readonly databaseUrl: Env.Secret;
    readonly openRouterToken: Env.Secret;
  };
  readonly config: Env.Config;
}) => {
  const { vars, config } = env;
  const http = Http.create({}, { timeoutMs: config.httpTimeout });
  const sentry = Sentry.create({ http }, { dsn: Sentry.DSN, environment: Sentry.ENVIRONMENT });
  const db = Db.create({}, { url: vars.databaseUrl });
  const logger = Logger.create(
    { sentry, db },
    { write: (line) => process.stdout.write(`${line}\n`), colors: process.stdout.isTTY },
  );
  const tests = Stores.Tests.create({ db });
  const openRouter = OpenRouter.create(
    { http },
    {
      token: vars.openRouterToken,
      baseUrl: config.openRouterBaseUrl,
      timeoutMs: config.driver.askTimeout,
      defaultRetry: config.driver.harness.defaultRetry,
      attempts: ATTEMPTS,
    },
  );
  return { http, sentry, db, logger, tests, openRouter } satisfies Services;
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
