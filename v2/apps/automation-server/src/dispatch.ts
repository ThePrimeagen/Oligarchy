import type * as ClientRoutes from "@oligarchy/automation-client/routes";
import type * as Db from "@oligarchy/db";
import type * as Http from "@oligarchy/http";
import type * as Logger from "@oligarchy/logger";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as AutomationClient from "./automation-client.ts";

const LOCATION = "automation-server";

// A setup is filed holding the setup lock of the qemu server it installs on, but a qemu server
// that restarts clears its locks. Such a setup can never be reserved, and setups head the queue,
// so left pending it would hold back every job behind it.
const NoSetupLock = jarl.error.define("NoSetupLock");
type NoSetupLock = InstanceType<typeof NoSetupLock>;

type LiveClient = Stores.Servers.LiveServer;

export type Options = {
  readonly http: Http.Http;
  readonly token: { readonly reveal: () => string };
  readonly tests: Stores.Tests.Tests;
  readonly servers: Stores.Servers.Servers;
  readonly setupRequests: Stores.SetupRequests.SetupRequests;
  readonly logger: Logger.Logger;
  // Ends a reserve in flight, so a shutdown does not wait on a client.
  readonly signal: AbortSignal;
};

export type Dispatcher = {
  // Reserves the next pending job on a live automation client and moves it to running. True when
  // it did, so the next job can be started at once; false when there is nothing to start now.
  readonly startNextJob: () => Promise<boolean>;
};

export const create = (options: Options): Dispatcher => {
  const { http, token, tests, servers, setupRequests, logger, signal } = options;
  // The client the next job is offered to first: the one after the client that took the last.
  let nextClientUrl: string | undefined;

  const logFailure = (error: Error): false => {
    logger.error(`dispatch failed: ${error.message}`, { location: LOCATION, cause: error });
    return false;
  };

  // The live clients, starting with the one whose turn it is.
  const clientsInTurn = (live: ReadonlyArray<LiveClient>): ReadonlyArray<LiveClient> => {
    const turn = Math.max(
      0,
      live.findIndex((client) => client.url === nextClientUrl),
    );
    return [...live.slice(turn), ...live.slice(0, turn)];
  };

  // The body of /reserve. A diagnose needs no guest, so it names nothing. A drive names its test
  // run's ISO as resume only when its definition resumes, and boots fresh otherwise. A setup names
  // the qemu server whose lock it holds, the only one it may install on.
  const buildReserveRequest = async (
    job: Stores.Tests.JobRow,
  ): Promise<
    jarl.Result<ClientRoutes.ReserveRequest, Db.DatabaseError | Stores.Tests.NotFound | NoSetupLock>
  > => {
    if (job.action === "diagnose") {
      return jarl.ok({ jobId: job.id, action: "diagnose" });
    }
    if (job.action === "setup") {
      const locked = await setupRequests.serverForJob(job.id);
      if (jarl.is_err(locked)) {
        return locked;
      }
      const setupServer = jarl.value(locked);
      if (setupServer === undefined) {
        return jarl.err(new NoSetupLock("no setup lock names this setup's server"));
      }
      return jarl.ok({ jobId: job.id, action: "setup", setupServer });
    }
    const details = await tests.getJobDetails(job.id);
    if (jarl.is_err(details)) {
      return details;
    }
    const { run, definition } = jarl.value(details);
    return jarl.ok(
      definition.resume
        ? { jobId: job.id, action: "drive", resume: run.iso }
        : { jobId: job.id, action: "drive" },
    );
  };

  // Offers the job to each client in turn. Each client counts its own jobs against its --max-jobs
  // and answers at-capacity when full, as it answers setup-needed when no qemu server holds the
  // setup disk a resume needs; either way the next client is asked. Any other failure is a line,
  // and the next client is asked too. Undefined when no client reserved it.
  const reserveOnFirstClientWithRoom = async (
    request: ClientRoutes.ReserveRequest,
    clients: ReadonlyArray<LiveClient>,
  ): Promise<LiveClient | undefined> => {
    for (const client of clients) {
      const reserved = await AutomationClient.create({ http, url: client.url, token, signal }).post(
        "/reserve",
        request,
      );
      if (jarl.is_err(reserved)) {
        if (signal.aborted) {
          return undefined;
        }
        logger.error(`reserve failed; ${client.url}: ${reserved.error.message}`, {
          location: LOCATION,
          agentId: request.jobId,
          cause: reserved.error,
        });
        continue;
      }
      if (jarl.value(reserved) === "reserved") {
        return client;
      }
    }
    return undefined;
  };

  // The job is the client's from now on. A job that left pending meanwhile, usually an abort
  // that landed during the reserve, is given back at the client rather than held there until it
  // restarts.
  const markRunning = async (job: Stores.Tests.JobRow, client: LiveClient): Promise<boolean> => {
    const running = await tests.runJob(job.id, client.id);
    if (jarl.is_ok(running)) {
      logger.info(`reserved ${job.action}; ${client.url}`, { location: LOCATION, agentId: job.id });
      return true;
    }
    logger.error(`running write failed; ${client.url}: ${running.error.message}`, {
      location: LOCATION,
      agentId: job.id,
      cause: running.error,
    });
    const given = await AutomationClient.create({ http, url: client.url, token, signal }).post(
      "/abort",
      { jobId: job.id },
    );
    if (jarl.is_err(given)) {
      logger.error(`reserve release failed; ${client.url}: ${given.error.message}`, {
        location: LOCATION,
        agentId: job.id,
        cause: given.error,
      });
    }
    return false;
  };

  return {
    startNextJob: async () => {
      const listed = await servers.listLiveServers("automation-client");
      if (jarl.is_err(listed)) {
        return logFailure(listed.error);
      }
      const live = jarl.value(listed);
      if (live.length === 0) {
        return false;
      }

      const next = await tests.nextPendingJob([]);
      if (jarl.is_err(next)) {
        return logFailure(next.error);
      }
      const job = jarl.value(next);
      if (job === undefined) {
        return false;
      }

      const built = await buildReserveRequest(job);
      if (jarl.error.is(built, NoSetupLock)) {
        // A pending job can only be aborted: it never ran.
        const aborted = await tests.abortJob(job.id, built.error.message);
        if (jarl.is_err(aborted)) {
          return logFailure(aborted.error);
        }
        logger.error(`setup aborted: ${built.error.message}`, {
          location: LOCATION,
          agentId: job.id,
        });
        return true;
      }
      if (jarl.is_err(built)) {
        return logFailure(built.error);
      }

      const client = await reserveOnFirstClientWithRoom(jarl.value(built), clientsInTurn(live));
      if (client === undefined) {
        return false;
      }
      nextClientUrl = live[(live.indexOf(client) + 1) % live.length]?.url;
      return markRunning(job, client);
    },
  };
};
