import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import type * as Http from "@oligarchy/http";
import type * as Logger from "@oligarchy/logger";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as AutomationClient from "./automation-client.ts";
import * as Close from "./close.ts";
import type { AbortRequest } from "./routes.ts";

const LOCATION = "automation-server";

export const REASON = "aborted by an operator";

// The job, or the suite, has already ended; the message says how.
export const NothingToAbort = jarl.error.define("NothingToAbort");
export type NothingToAbort = InstanceType<typeof NothingToAbort>;

// A running job's automation client could not be asked to stop it, so it is left running; the
// message says which job and why.
export const NotStopped = jarl.error.define("NotStopped");
export type NotStopped = InstanceType<typeof NotStopped>;

// The jobs an abort is stopping at their clients. Each one's run answers aborted once its client
// kills it; that close leaves the job to the abort, which writes it with the operator's reason.
export type Aborting = Set<string>;

type Services = App.Needs<Http.Http | Stores.Tests.Tests | Stores.Servers.Servers | Logger.Logger>;

export type Options = {
  readonly token: { readonly reveal: () => string };
  readonly aborting: Aborting;
};

type Failure = Db.DatabaseError | Stores.Tests.NotFound | NothingToAbort | NotStopped;

type Answer = Promise<jarl.Result<void, Failure>>;

export type Aborter = {
  // A job is aborted with its test run, and the run's suite closes once none of its runs is
  // open. A suite has each open job aborted, each open run with it, then the suite itself.
  readonly abort: (request: AbortRequest) => Answer;
  // Resolves once every abort in flight has written what it will.
  readonly settled: () => Promise<void>;
};

const OPEN: ReadonlyArray<Stores.Tests.JobStatus> = ["pending", "running"];

export const create = (services: Services, options: Options): Aborter => {
  const { http, tests, servers, logger } = services;
  const { token, aborting } = options;
  const inFlight = new Set<Promise<unknown>>();

  const at = (job: Stores.Tests.JobRow) => ({ location: LOCATION, agentId: job.id });

  // A client that holds the job is asked to stop it. One that is forgotten, or holds nothing for
  // it, has nothing to stop, which is said under the job once it is aborted.
  const stopAtClient = async (
    job: Stores.Tests.JobRow,
  ): Promise<
    jarl.Result<{ readonly said: string; readonly level: "info" | "warning" }, Failure>
  > => {
    const client = job.serverId === null ? undefined : await servers.findServer(job.serverId);
    if (client !== undefined && jarl.is_err(client)) {
      return client;
    }
    const found = client === undefined ? undefined : jarl.value(client);
    if (found === undefined) {
      return jarl.ok({
        level: "warning",
        said: `aborted running ${job.action}; its automation client is forgotten, so nothing was stopped`,
      });
    }
    const stopped = await AutomationClient.create({ http, url: found.url, token }).post("/abort", {
      jobId: job.id,
    });
    if (jarl.is_err(stopped)) {
      logger.error(`abort failed; ${stopped.error.message}`, { ...at(job), cause: stopped.error });
      return jarl.err(
        new NotStopped(`job ${job.id} could not be stopped: ${stopped.error.message}`),
      );
    }
    return jarl.value(stopped) === "stopped"
      ? jarl.ok({ level: "info", said: `aborted running ${job.action}; stopped at ${found.url}` })
      : jarl.ok({
          level: "warning",
          said: `aborted running ${job.action}; ${found.url} was not running it`,
        });
  };

  // A job that left the state it was read in meanwhile, as a run that ended while its client was
  // asked to stop it, is NothingToAbort; one an abort of the client's own closed stands as it is.
  const writeAborted = async (
    job: Stores.Tests.JobRow,
    during: string,
  ): Promise<jarl.Result<void, Failure>> => {
    const aborted = await tests.abortJob(job.id, REASON);
    if (!jarl.error.is(aborted, Stores.Tests.InvalidState)) {
      return jarl.is_err(aborted) ? aborted : jarl.ok(undefined);
    }
    const now = await tests.getJob(job.id);
    if (jarl.is_err(now)) {
      return now;
    }
    const { status } = jarl.value(now);
    return status === "aborted"
      ? jarl.ok(undefined)
      : jarl.err(new NothingToAbort(`job ${job.id} ${status} ${during}; nothing to abort`));
  };

  const abortJob = async (job: Stores.Tests.JobRow): Promise<jarl.Result<void, Failure>> => {
    if (job.status === "pending") {
      const aborted = await tests.abortJob(job.id, REASON);
      if (jarl.error.is(aborted, Stores.Tests.InvalidState)) {
        // Dispatch moved it to running meanwhile: stop it where it went.
        const now = await tests.getJob(job.id);
        return jarl.is_err(now) ? now : abortOpen(jarl.value(now));
      }
      if (jarl.is_err(aborted)) {
        return aborted;
      }
      logger.info(`aborted pending ${job.action}`, at(job));
      return jarl.ok(undefined);
    }
    aborting.add(job.id);
    try {
      const stopped = await stopAtClient(job);
      if (jarl.is_err(stopped)) {
        return stopped;
      }
      const written = await writeAborted(job, "while it was being stopped");
      if (jarl.is_err(written)) {
        return written;
      }
      const { level, said } = jarl.value(stopped);
      logger[level](said, at(job));
      return jarl.ok(undefined);
    } finally {
      aborting.delete(job.id);
    }
  };

  const abortOpen = (job: Stores.Tests.JobRow): Promise<jarl.Result<void, Failure>> =>
    OPEN.includes(job.status)
      ? abortJob(job)
      : Promise.resolve(
          jarl.err(new NothingToAbort(`job ${job.id} is ${job.status}; nothing to abort`)),
        );

  // A run whose job was aborted has nothing open, so it is aborted too; one already closed stays.
  const abortRun = async (runId: string): Promise<jarl.Result<void, Failure>> => {
    const aborted = await tests.abortRun(runId, REASON);
    if (jarl.error.is(aborted, Stores.Tests.InvalidState)) {
      return jarl.ok(undefined);
    }
    return jarl.is_err(aborted) ? aborted : jarl.ok(undefined);
  };

  const byJob = async (jobId: string): Answer => {
    const found = await tests.getJob(jobId);
    if (jarl.is_err(found)) {
      return found;
    }
    const job = jarl.value(found);
    const aborted = await abortOpen(job);
    if (jarl.is_err(aborted)) {
      return aborted;
    }
    const run = await abortRun(job.runId);
    if (jarl.is_err(run)) {
      return run;
    }
    const closed = await tests.getTestRun(job.runId);
    if (jarl.is_err(closed)) {
      return closed;
    }
    const { suiteId } = jarl.value(closed);
    if (suiteId === null) {
      return jarl.ok(undefined);
    }
    const suiteClosed = await Close.closeSuite(services, suiteId);
    return jarl.error.is(suiteClosed, Stores.Tests.InvalidState) ? jarl.ok(undefined) : suiteClosed;
  };

  // Every open run goes, even when one of its jobs could not be stopped; that one is the answer,
  // and the suite stays open around it.
  const bySuite = async (suiteId: string): Answer => {
    const found = await tests.getTestSuiteDetails(suiteId);
    if (jarl.is_err(found)) {
      return found;
    }
    const { suite, runs } = jarl.value(found);
    if (suite.status !== "pending" && suite.status !== "running") {
      return jarl.err(new NothingToAbort(`suite ${suiteId} is ${suite.status}; nothing to abort`));
    }
    const open = runs.filter(({ run }) => run.status === "pending" || run.status === "running");
    const each = await Promise.all(
      open.map(async ({ run, jobs }) => {
        const job = jobs.find((one) => OPEN.includes(one.status));
        const aborted = job === undefined ? jarl.ok(undefined) : await abortJob(job);
        return jarl.is_err(aborted) ? aborted : abortRun(run.id);
      }),
    );
    const failed = each.find((one) => jarl.is_err(one));
    if (failed !== undefined) {
      return failed;
    }
    const aborted = await tests.abortSuite(suiteId, REASON);
    if (jarl.error.is(aborted, Stores.Tests.InvalidState)) {
      return jarl.ok(undefined);
    }
    if (jarl.is_err(aborted)) {
      return aborted;
    }
    logger.info(`suite ${suiteId} aborted`, { location: LOCATION });
    return jarl.ok(undefined);
  };

  return {
    abort: (request) => {
      const answer = request.jobId === undefined ? bySuite(request.suiteId) : byJob(request.jobId);
      inFlight.add(answer);
      void answer.finally(() => inFlight.delete(answer));
      return answer;
    },
    settled: async () => {
      while (inFlight.size > 0) {
        await Promise.all(inFlight);
      }
    },
  };
};
