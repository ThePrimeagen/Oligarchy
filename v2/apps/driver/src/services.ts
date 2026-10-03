import type * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import type * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as Logger from "@oligarchy/logger";
import * as OpenRouter from "@oligarchy/openrouter";
import * as Sentry from "@oligarchy/sentry";
import * as Stores from "@oligarchy/stores";
import type * as jarl from "jarl";

// No count of its own: an ask is made again until a wait would reach the run's deadline, so a
// provider overloaded for minutes is waited out rather than failing the drive.
const ATTEMPTS = Number.MAX_SAFE_INTEGER;

export type Services = App.Needs<
  | Http.Http
  | Sentry.Sentry
  | Db.Database
  | Logger.Logger
  | Stores.Tests.Tests
  | OpenRouter.OpenRouter
>;

export const openRouterOptions = (env: {
  readonly vars: { readonly openRouterToken: Env.Secret };
  readonly config: Pick<Env.Config, "openRouterBaseUrl"> & {
    readonly driver: Pick<Env.Config["driver"], "askTimeout"> & {
      readonly harness: Pick<Env.Config["driver"]["harness"], "defaultRetry">;
    };
  };
}): OpenRouter.Options => ({
  token: env.vars.openRouterToken,
  baseUrl: env.config.openRouterBaseUrl,
  timeoutMs: env.config.driver.askTimeout,
  defaultRetry: env.config.driver.harness.defaultRetry,
  attempts: ATTEMPTS,
});

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
  const openRouter = OpenRouter.create({ http }, openRouterOptions(env));
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
