import * as Async from "@oligarchy/async";
import type * as ClientRoutes from "@oligarchy/automation-client/routes";
import type * as Db from "@oligarchy/db";
import type * as Env from "@oligarchy/env";
import type * as Http from "@oligarchy/http";
import type * as Logger from "@oligarchy/logger";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as AutomationClient from "./automation-client.ts";
import * as Close from "./close.ts";
import * as DiagnosePrompt from "./diagnose-prompt.ts";

const LOCATION = "automation-server";

// A setup is filed holding the setup lock of the qemu server it installs on, but a qemu server
// that restarts clears its locks. Such a setup can never be reserved, and setups head the queue,
// so left pending it would hold back every job behind it.
const NoSetupLock = jarl.error.define("NoSetupLock");
type NoSetupLock = InstanceType<typeof NoSetupLock>;

// A diagnose judges the newest completed drive or setup on its test run. With none it can never
// run, and diagnoses head every drive in the queue.
const NothingToJudge = jarl.error.define("NothingToJudge");
type NothingToJudge = InstanceType<typeof NothingToJudge>;

// Every live client was full, needed a setup first, or failed: the job stays pending.
const NoClientsAvailable = jarl.error.define("NoClientsAvailable");
type NoClientsAvailable = InstanceType<typeof NoClientsAvailable>;

type LiveClient = Stores.Servers.LiveServer;

export type Options = {
  readonly http: Http.Http;
  readonly token: { readonly reveal: () => string };
  readonly tests: Stores.Tests.Tests;
  readonly servers: Stores.Servers.Servers;
  readonly setupRequests: Stores.SetupRequests.SetupRequests;
  readonly diagnosis: Stores.Diagnosis.Diagnosis;
  readonly logger: Logger.Logger;
  readonly models: Env.Config["models"];
  readonly aborting: Close.Options["aborting"];
  // Ends a reserve or a run in flight, so a shutdown does not wait on a client.
  readonly signal: AbortSignal;
};

export type Dispatcher = {
  // Reserves the next pending job on a live automation client, moves it to running and sends its
  // /run, which goes on past the call. True when it started one, or aborted one that can never
  // run, so the next job can be started at once; false when there is nothing to start now.
  readonly startNextJob: () => Promise<boolean>;
  // Resolves once every /run in flight has answered and its job is closed.
  readonly waitForRuns: () => Promise<void>;
};

// What the client that takes the job is asked. A drive's or setup's driver renders its own prompt,
// so only a diagnose's /run names one, for the job it judges.
type Requests = {
  readonly reserve: ClientRoutes.ReserveRequest;
  readonly run: ClientRoutes.RunRequest;
  readonly judgedJobId: string | undefined;
};

export const create = (options: Options): Dispatcher => {
  const { http, token, tests, servers, setupRequests, logger, models, signal } = options;
  // The client the next job is offered to first: the one after the client that took the last.
  let nextClientUrl: string | undefined;
  const runs = new Set<Promise<void>>();

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

  // The bodies of /reserve and /run. A diagnose needs no guest, so its reserve names nothing. A
  // drive names its test run's ISO as resume only when its definition resumes, and boots fresh
  // otherwise. A setup names the qemu server whose lock it holds, the only one it may install on.
  const buildRequests = async (
    job: Stores.Tests.JobRow,
  ): Promise<
    jarl.Result<Requests, Db.DatabaseError | Stores.Tests.NotFound | NoSetupLock | NothingToJudge>
  > => {
    if (job.action === "diagnose") {
      const details = await tests.getTestRunDetails(job.runId);
      if (jarl.is_err(details)) {
        return details;
      }
      const judged = jarl
        .value(details)
        .jobs.findLast((one) => one.action !== "diagnose" && one.status === "completed");
      if (judged === undefined) {
        return jarl.err(new NothingToJudge("no completed drive or setup on its test run to judge"));
      }
      return jarl.ok({
        reserve: { jobId: job.id, action: "diagnose" },
        run: { jobId: job.id, prompt: DiagnosePrompt.render(judged.id, models.diagnose) },
        judgedJobId: judged.id,
      });
    }
    const run = { jobId: job.id };
    if (job.action === "setup") {
      const locked = await setupRequests.serverForJob(job.id);
      if (jarl.is_err(locked)) {
        return locked;
      }
      const setupServer = jarl.value(locked);
      if (setupServer === undefined) {
        return jarl.err(new NoSetupLock("no setup lock names this setup's server"));
      }
      return jarl.ok({
        reserve: { jobId: job.id, action: "setup", setupServer },
        run,
        judgedJobId: undefined,
      });
    }
    const details = await tests.getJobDetails(job.id);
    if (jarl.is_err(details)) {
      return details;
    }
    const { run: testRun, definition } = jarl.value(details);
    return jarl.ok({
      reserve: definition.resume
        ? { jobId: job.id, action: "drive", resume: testRun.iso }
        : { jobId: job.id, action: "drive" },
      run,
      judgedJobId: undefined,
    });
  };

  // Offers the job to each client in turn. Each client counts its own jobs against its --max-jobs
  // and answers at-capacity when full, as it answers setup-needed when no qemu server holds the
  // setup disk a resume needs; either way the next client is asked. Any other failure is a line,
  // and the next client is asked too.
  const reserveOnFirstClientWithRoom = async (
    request: ClientRoutes.ReserveRequest,
    clients: ReadonlyArray<LiveClient>,
  ): Promise<jarl.Result<LiveClient, Async.Aborted | NoClientsAvailable>> => {
    for (const client of clients) {
      const reserved = await AutomationClient.create({ http, url: client.url, token, signal }).post(
        "/reserve",
        request,
      );
      if (jarl.is_err(reserved)) {
        if (signal.aborted) {
          return jarl.err(new Async.Aborted(`reserve on ${client.url} ended: shutting down`));
        }
        logger.error(`reserve failed; ${client.url}: ${reserved.error.message}`, {
          location: LOCATION,
          agentId: request.jobId,
          cause: reserved.error,
        });
        continue;
      }
      if (jarl.value(reserved) === "reserved") {
        return jarl.ok(client);
      }
    }
    return jarl.err(new NoClientsAvailable("no live client took the job"));
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

  // A job that can never run. A pending job can only be aborted: it never ran.
  const abortUnrunnable = async (
    job: Stores.Tests.JobRow,
    why: NoSetupLock | NothingToJudge,
  ): Promise<boolean> => {
    const aborted = await tests.abortJob(job.id, why.message);
    if (jarl.is_err(aborted)) {
      return logFailure(aborted.error);
    }
    logger.error(`${job.action} aborted: ${why.message}`, { location: LOCATION, agentId: job.id });
    return true;
  };

  // A drive or setup starts its test run with its model; one already running, as a retried
  // drive's is, keeps the model it started with. A failure leaves the job to run all the same.
  const startTestRun = async (job: Stores.Tests.JobRow): Promise<void> => {
    if (job.action === "diagnose") {
      return;
    }
    const found = await tests.getTestRun(job.runId);
    if (jarl.is_ok(found) && jarl.value(found).status === "running") {
      return;
    }
    const started = jarl.is_err(found)
      ? found
      : await tests.startRun(job.runId, models[job.action]);
    if (jarl.is_err(started)) {
      logger.error(`test run start failed: ${started.error.message}`, {
        location: LOCATION,
        agentId: job.id,
        cause: started.error,
      });
    }
  };

  // The run goes on past this pass, and its job is closed once the client answers. A run the
  // shutdown ended closes nothing: settling its job is the shutdown's.
  const sendRun = (job: Stores.Tests.JobRow, client: LiveClient, requests: Requests): void => {
    const running = (async () => {
      const ran = await AutomationClient.create({ http, url: client.url, token, signal }).post(
        "/run",
        requests.run,
      );
      if (jarl.error.is(ran, Async.Aborted)) {
        return;
      }
      await Close.close(options, options, { job, judgedJobId: requests.judgedJobId }, ran);
    })();
    runs.add(running);
    void running.finally(() => runs.delete(running));
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

      const next = await tests.nextPendingJob();
      if (jarl.is_err(next)) {
        return logFailure(next.error);
      }
      const job = jarl.value(next);
      if (job === undefined) {
        return false;
      }

      const built = await buildRequests(job);
      if (jarl.error.is(built, NoSetupLock)) {
        return abortUnrunnable(job, built.error);
      }
      if (jarl.error.is(built, NothingToJudge)) {
        return abortUnrunnable(job, built.error);
      }
      if (jarl.is_err(built)) {
        return logFailure(built.error);
      }
      const requests = jarl.value(built);

      const reserved = await reserveOnFirstClientWithRoom(requests.reserve, clientsInTurn(live));
      // Neither is a failure: a shutdown ends the loop, and the job waits for a client with room.
      if (jarl.error.is(reserved, Async.Aborted) || jarl.error.is(reserved, NoClientsAvailable)) {
        return false;
      }
      const client = jarl.value(reserved);
      nextClientUrl = live[(live.indexOf(client) + 1) % live.length]?.url;
      if (!(await markRunning(job, client))) {
        return false;
      }
      await startTestRun(job);
      sendRun(job, client, requests);
      return true;
    },

    waitForRuns: async () => {
      while (runs.size > 0) {
        await Promise.all(runs);
      }
    },
  };
};
