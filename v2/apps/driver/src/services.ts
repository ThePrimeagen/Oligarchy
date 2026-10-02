import type * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import * as DriveHarness from "@oligarchy/drive-harness";
import type * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as Logger from "@oligarchy/logger";
import * as OpenRouter from "@oligarchy/openrouter";
import * as Qemu from "@oligarchy/qemu-http-tools";
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
  | Qemu.QemuHttpTools
  | OpenRouter.OpenRouter
  | DriveHarness.DriveHarness
>;

// Every line is printed and stored in the logs table; an error or fatal line, and a line that
// could not be stored, also go to the project's Sentry. The job's guest calls abort on `signal`;
// its stop does not, so a stopped driver still stops its guest.
export const createServices = (
  env: {
    readonly flags: { readonly jobId: string; readonly serverUrl: string };
    readonly vars: {
      readonly databaseUrl: Env.Secret;
      readonly oligarchyToken: Env.Secret;
      readonly openRouterToken: Env.Secret;
    };
    readonly config: Env.Config;
  },
  signal: AbortSignal,
) => {
  const { flags, vars, config } = env;
  const http = Http.create({});
  const sentry = Sentry.create({ http }, { dsn: Sentry.DSN, environment: Sentry.ENVIRONMENT });
  const db = Db.create({}, { url: vars.databaseUrl });
  const logger = Logger.create(
    { sentry, db },
    { write: (line) => process.stdout.write(`${line}\n`), colors: process.stdout.isTTY },
  );
  const tests = Stores.Tests.create({ db });
  const qemuHttpTools = Qemu.create(
    { http },
    { job: flags.jobId, baseUrl: flags.serverUrl, token: vars.oligarchyToken, signal },
  );
  const openRouter = OpenRouter.create(
    { http },
    {
      token: vars.openRouterToken,
      baseUrl: config.openRouterBaseUrl,
      timeoutMs: config.timeouts.header,
      defaultRetry: config.harness.defaultRetry,
      attempts: ATTEMPTS,
    },
  );
  const driveHarness = DriveHarness.create(
    { tests, qemuHttpTools, openRouter },
    { recentActions: config.harness.recentActions },
  );
  return {
    http,
    sentry,
    db,
    logger,
    tests,
    qemuHttpTools,
    openRouter,
    driveHarness,
  } satisfies Services;
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
