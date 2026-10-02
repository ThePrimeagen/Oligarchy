import type * as ClientRoutes from "@oligarchy/automation-client/routes";
import type * as Db from "@oligarchy/db";
import type * as Http from "@oligarchy/http";
import type * as Logger from "@oligarchy/logger";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as AutomationClient from "./automation-client.ts";

const LOCATION = "automation-server";

// A setup is filed with its lock, but forgetting a qemu server takes that server's locks with it,
// and a setup with no server to run on can never be reserved.
const NO_LOCK = "no setup lock names this setup's server";

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

export type Dispatch = {
  // Reserves the next pending job on a live automation client and moves it to running. True when
  // it did, so the next job is asked for at once; false when the queue should wait.
  readonly pass: () => Promise<boolean>;
};

export const create = (options: Options): Dispatch => {
  const { http, token, tests, servers, setupRequests, logger, signal } = options;
  // The client the next job is offered to first: the one after the client that took the last.
  let nextUrl: string | undefined;

  const failed = (error: Error): false => {
    logger.error(`dispatch failed: ${error.message}`, { location: LOCATION, cause: error });
    return false;
  };

  // A drive resumes its test run's ISO only when its definition resumes; a setup names the qemu
  // server its lock names, and is undefined when no lock does.
  const requestFor = async (
    job: Stores.Tests.JobRow,
  ): Promise<
    jarl.Result<ClientRoutes.ReserveRequest | undefined, Db.DatabaseError | Stores.Tests.NotFound>
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
      return jarl.ok(
        setupServer === undefined ? undefined : { jobId: job.id, action: "setup", setupServer },
      );
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

  return {
    pass: async () => {
      const listed = await servers.listLiveServers("automation-client");
      if (jarl.is_err(listed)) {
        return failed(listed.error);
      }
      const live = jarl.value(listed);
      if (live.length === 0) {
        return false;
      }
      const next = await tests.nextPendingJob([]);
      if (jarl.is_err(next)) {
        return failed(next.error);
      }
      const job = jarl.value(next);
      if (job === undefined) {
        return false;
      }
      const asked = await requestFor(job);
      if (jarl.is_err(asked)) {
        return failed(asked.error);
      }
      const request = jarl.value(asked);
      if (request === undefined) {
        const aborted = await tests.abortJob(job.id, NO_LOCK);
        if (jarl.is_err(aborted)) {
          return failed(aborted.error);
        }
        logger.error(`setup aborted: ${NO_LOCK}`, { location: LOCATION, agentId: job.id });
        return true;
      }

      const at = Math.max(
        0,
        live.findIndex((one) => one.url === nextUrl),
      );
      for (const server of [...live.slice(at), ...live.slice(0, at)]) {
        const client = AutomationClient.create({ http, url: server.url, token, signal });
        const reserved = await client.post("/reserve", request);
        if (jarl.is_err(reserved)) {
          if (signal.aborted) {
            return false;
          }
          logger.error(`reserve failed; ${server.url}: ${reserved.error.message}`, {
            location: LOCATION,
            agentId: job.id,
            cause: reserved.error,
          });
          continue;
        }
        // At capacity or needing a setup: the next client may still take it.
        if (jarl.value(reserved) !== "reserved") {
          continue;
        }
        nextUrl = live[(live.indexOf(server) + 1) % live.length]?.url;
        const running = await tests.runJob(job.id, server.id);
        if (jarl.is_err(running)) {
          // Usually an abort that landed while the client reserved: the client still holds the
          // job, so it is given back rather than left until the client restarts.
          logger.error(`running write failed; ${server.url}: ${running.error.message}`, {
            location: LOCATION,
            agentId: job.id,
            cause: running.error,
          });
          const stopped = await client.post("/abort", { jobId: job.id });
          if (jarl.is_err(stopped)) {
            logger.error(`reserve release failed; ${server.url}: ${stopped.error.message}`, {
              location: LOCATION,
              agentId: job.id,
              cause: stopped.error,
            });
          }
          return false;
        }
        logger.info(`reserved ${job.action}; ${server.url}`, {
          location: LOCATION,
          agentId: job.id,
        });
        return true;
      }
      return false;
    },
  };
};
