import type * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import * as Http from "@oligarchy/http";
import * as Logger from "@oligarchy/logger";
import * as Sentry from "@oligarchy/sentry";
import * as Stores from "@oligarchy/stores";
import type { Run } from "./environment.ts";
export type Services = App.Needs<
  | Http.Http
  | Db.Database
  | Logger.Logger
  | Sentry.Sentry
  | Stores.Servers.Servers
  | Stores.Tests.Tests
  | Stores.SetupRequests.SetupRequests
>;
export const createServices = (env: Run) => {
  const http = Http.create({}, { timeoutMs: env.config.httpTimeout });
  const sentry = Sentry.create({ http }, { dsn: Sentry.DSN, environment: Sentry.ENVIRONMENT });
  const db = Db.create({}, { url: env.vars.databaseUrl });
  const logger = Logger.create(
    { db, sentry },
    { write: (line) => process.stdout.write(`${line}\n`), colors: process.stdout.isTTY },
  );
  const services = { http, sentry, db, logger };
  const servers = Stores.Servers.create(services);
  const tests = Stores.Tests.create(services);
  const setupRequests = Stores.SetupRequests.create(services);
  return { ...services, servers, tests, setupRequests } satisfies Services;
};
export const closeServices = async (services: Services) => {
  await services.logger.flush();
  const closed = await services.db.close();
  await services.logger.flush();
  await services.sentry.wait();
  return closed;
};
