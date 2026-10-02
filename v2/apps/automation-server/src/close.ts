import type * as App from "@oligarchy/app";
import type * as ClientRoutes from "@oligarchy/automation-client/routes";
import type * as Db from "@oligarchy/db";
import type * as Http from "@oligarchy/http";
import type * as Logger from "@oligarchy/logger";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";

const LOCATION = "automation-server";

const ABORTED = "aborted at its automation client";

// A job its automation client was handed /run for. A diagnose names the drive or setup it judges;
// a drive or setup names none.
export type Running = {
  readonly job: Stores.Tests.JobRow;
  readonly judgedJobId: string | undefined;
};

type Services = App.Needs<Stores.Tests.Tests | Stores.Diagnosis.Diagnosis | Logger.Logger>;

type Closed = Promise<
  jarl.Result<void, Db.DatabaseError | Stores.Tests.InvalidState | Stores.Tests.NotFound>
>;

const at = (job: Stores.Tests.JobRow) => ({ location: LOCATION, agentId: job.id });

// The driver ran to its end; its diagnose judges it.
const queueDiagnose = async ({ tests, logger }: Services, job: Stores.Tests.JobRow): Closed => {
  const completed = await tests.completeJob(job.id);
  if (jarl.is_err(completed)) {
    return completed;
  }
  const queued = await tests.createJob(job.runId, "diagnose");
  if (jarl.is_err(queued)) {
    return queued;
  }
  logger.info(`${job.action} completed; diagnose ${jarl.value(queued).id} queued`, at(job));
  return jarl.ok(undefined);
};

// A suite closes with its last open run: passed when every run passed. Two of its runs closing at
// once can each find none open, and the one that completes the suite second is refused.
const closeSuite = async ({ tests }: Services, suiteId: string): Closed => {
  const found = await tests.getTestSuite(suiteId);
  if (jarl.is_err(found)) {
    return found;
  }
  const { runs } = jarl.value(found);
  if (runs.pending + runs.running > 0) {
    return jarl.ok(undefined);
  }
  const total = Object.values(runs).reduce((sum, count) => sum + count, 0);
  const completed = await tests.completeSuite(
    suiteId,
    runs.passed === total ? "passed" : "failed",
    null,
  );
  if (jarl.error.is(completed, Stores.Tests.InvalidState)) {
    return jarl.ok(undefined);
  }
  return jarl.is_err(completed) ? completed : jarl.ok(undefined);
};

// The diagnosing agent records its verdict with ctrl diagnose before it exits; the verdict closes
// the job it judged, that job's test run, and the run's suite once nothing in it is open.
const finalize = async (
  services: Services,
  job: Stores.Tests.JobRow,
  judgedJobId: string,
): Closed => {
  const { tests, diagnosis, logger } = services;
  const found = await diagnosis.getDiagnosis(judgedJobId);
  if (jarl.is_err(found)) {
    return found;
  }
  const recorded = jarl.value(found);
  if (recorded === undefined) {
    const reason = `the diagnosing agent recorded no diagnosis for job ${judgedJobId}`;
    logger.error(`diagnose errored: ${reason}`, at(job));
    const errored = await tests.errorJob(job.id, reason);
    return jarl.is_err(errored) ? errored : jarl.ok(undefined);
  }
  const { verdict, summary } = recorded;
  const completed = await tests.completeJob(job.id);
  if (jarl.is_err(completed)) {
    return completed;
  }
  const judged = verdict === "passed" ? "succeeded" : "failed";
  const finalized = await tests.finalizeJob(judgedJobId, judged, summary);
  if (jarl.is_err(finalized)) {
    return finalized;
  }
  const closedRun = await tests.completeRun(job.runId, verdict, summary);
  if (jarl.is_err(closedRun)) {
    return closedRun;
  }
  logger.info(`diagnose completed; job ${judgedJobId} ${judged}`, at(job));
  const { suiteId } = jarl.value(closedRun);
  return suiteId === null ? jarl.ok(undefined) : closeSuite(services, suiteId);
};

// An operator's abort may have aborted the job before its client answered; that abort stands.
const abort = async ({ tests, logger }: Services, job: Stores.Tests.JobRow): Closed => {
  const aborted = await tests.abortJob(job.id, ABORTED);
  if (jarl.error.is(aborted, Stores.Tests.InvalidState)) {
    return jarl.ok(undefined);
  }
  if (jarl.is_err(aborted)) {
    return aborted;
  }
  logger.info(`${job.action} ${ABORTED}`, at(job));
  return jarl.ok(undefined);
};

// The system failed the job, not its test: no diagnose is queued, and its test run stays running
// for an operator to try again.
const fail = async (
  { tests, logger }: Services,
  job: Stores.Tests.JobRow,
  failure: Error,
): Closed => {
  logger.error(`run failed: ${failure.message}`, { ...at(job), cause: failure });
  const errored = await tests.errorJob(job.id, failure.message);
  return jarl.is_err(errored) ? errored : jarl.ok(undefined);
};

// Closes the job by how its /run answered. A write that fails stops the close where it is.
export const close = async (
  services: Services,
  running: Running,
  ran: jarl.Result<ClientRoutes.Ran, Http.HttpFailure>,
): Promise<void> => {
  const { job, judgedJobId } = running;
  let closed: Awaited<Closed>;
  if (jarl.is_err(ran)) {
    closed = await fail(services, job, ran.error);
  } else if (jarl.value(ran) === "aborted") {
    closed = await abort(services, job);
  } else if (judgedJobId === undefined) {
    closed = await queueDiagnose(services, job);
  } else {
    closed = await finalize(services, job, judgedJobId);
  }
  if (jarl.is_err(closed)) {
    services.logger.error(`close failed: ${closed.error.message}`, {
      ...at(job),
      cause: closed.error,
    });
  }
};
