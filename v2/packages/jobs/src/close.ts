import * as Async from "@oligarchy/async";
import type * as Db from "@oligarchy/db";
import * as Linear from "@oligarchy/linear";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import { isOpen } from "./find.ts";
import type { Action, Needs } from "./needs.ts";
import * as Ready from "./ready.ts";

// errored is the system failing the action, never the test, and always says why.
export type Outcome =
  | { readonly status: "errored"; readonly reason: string }
  | {
      readonly status: Exclude<Stores.Automation.FinishStatus, "errored">;
      readonly reason: string | null;
    };

const ATTEMPTS = 3;

// A drive or mint that ran to its end is completed: the diagnosis judges it. A diagnose that
// ran is succeeded. failed is a diagnosis verdict, not an action's close.
const finished = (action: Action): Outcome => ({
  status: action.action === "diagnose" ? "succeeded" : "completed",
  reason: null,
});

// What an action made of a driver that exited cleanly.
export const judge = async (
  needs: Pick<Needs, "tests" | "sessions">,
  action: Action,
): Promise<jarl.Result<Outcome, Db.DatabaseError>> => {
  // A diagnose is judged by nothing here: its job was closed before it was queued.
  if (action.action === "diagnose") {
    return jarl.ok(finished(action));
  }
  const job = await needs.tests.findResult(action.resultId);
  if (!job.ok) {
    return job;
  }
  if (job.value === undefined) {
    throw new Error(`judge: result ${action.resultId} vanished during the drive`);
  }
  // The driver exiting 0 with the job still open is an agent that quit early, and the action
  // says so rather than reading as a run. The harness closes the job on stop or save.
  if (isOpen(job.value)) {
    return jarl.ok({
      status: "errored",
      reason: `driver exited; result ${action.resultId} is ${job.value.status}`,
    });
  }
  // A driver closes the job whatever happened to its guest. A session the qemu server errored
  // is the system failing the drive, whatever verdict the driver wrote.
  const { sessionId } = job.value;
  if (sessionId !== null) {
    const session = await needs.sessions.getSession(sessionId);
    if (!session.ok) {
      return session;
    }
    if (session.value?.status === "errored") {
      const why = session.value.reason === null ? "" : `; ${session.value.reason}`;
      return jarl.ok({ status: "errored", reason: `session ${sessionId} errored${why}` });
    }
  }
  return jarl.ok(finished(action));
};

// Three attempts, then a line. The action is already closed; a board that will not move does
// not reopen it.
export const moveTicket = async (
  needs: Pick<Needs, "logger">,
  ticket: string,
  column: string,
  move: () => Promise<jarl.Result<void, unknown>>,
): Promise<void> => {
  const moved = await Async.repeat(move, ATTEMPTS)();
  if (!moved.ok) {
    needs.logger.error(`move to ${column} failed: ${Errors.detail(moved.error)}`, {
      location: Errors.AUTOMATION,
      agentId: ticket,
    });
  }
};

// The system failed the action. A drive's or mint's job is errored with it, since whatever
// verdict it had is not the test's; a diagnose leaves the job it was judging alone. The ticket
// moves to Errored with the reason. Neither failing unwinds the close: each is a line.
export const fail = async (
  needs: Pick<Needs, "tests" | "linear" | "logger">,
  action: Action,
  ticket: string | null,
  reason: string,
): Promise<void> => {
  if (action.action !== "diagnose") {
    const written = await Async.repeat(
      () => needs.tests.errorResult(action.resultId, reason),
      ATTEMPTS,
    )();
    if (!written.ok) {
      needs.logger.error(
        `result errored write failed; ${action.resultId}: ${Errors.detail(written.error)}`,
        ticket === null
          ? { location: Errors.AUTOMATION }
          : { location: Errors.AUTOMATION, agentId: ticket },
      );
    }
  }
  if (ticket === null) {
    return;
  }
  await moveTicket(needs, ticket, Linear.ERRORED_STATE, () =>
    needs.linear.moveToErrored(ticket, `${action.action} errored; ${reason}`),
  );
};

// The diagnosing agent writes the verdict on the drive's session before it exits. Passed is
// Succeeded and failed is Failed. No session, no row, or a read that will not land is a line:
// guessing a column would be a lie, and the diagnose is already succeeded.
const verdict = async (
  needs: Pick<Needs, "diagnosis" | "linear" | "logger">,
  action: Action,
  ticket: string,
  sessionId: string | null,
): Promise<void> => {
  const where = { location: Errors.AUTOMATION, agentId: ticket };
  if (sessionId === null) {
    needs.logger.error(`diagnose verdict missing; ${action.resultId}`, where);
    return;
  }
  const read = await Async.repeat(() => needs.diagnosis.getDiagnosis(sessionId), ATTEMPTS)();
  if (!read.ok) {
    needs.logger.error(
      `diagnose verdict read failed; ${sessionId}: ${Errors.detail(read.error)}`,
      where,
    );
    return;
  }
  if (read.value === undefined) {
    needs.logger.error(`diagnose verdict missing; ${sessionId}`, where);
    return;
  }
  if (read.value.verdict === "passed") {
    await moveTicket(needs, ticket, Linear.SUCCEEDED_STATE, () =>
      needs.linear.moveToSucceeded(ticket),
    );
    return;
  }
  await moveTicket(needs, ticket, Linear.FAILED_STATE, () => needs.linear.moveToFailed(ticket));
};

// True when this call closed the row. Three attempts at the write; a row that still will not
// close stays running for an operator to mark, and the line names the status it should have.
// Then the ticket: a drive or mint gives up its ready label; errored moves to Errored; a drive
// or mint that completed goes to Needs Review; a diagnose that succeeded goes to Succeeded or
// Failed by its verdict; aborted stays where it was.
export const close = async (
  needs: Pick<Needs, "automation" | "tests" | "diagnosis" | "linear" | "logger">,
  action: Action,
  outcome: Outcome,
): Promise<jarl.Result<boolean, Db.DatabaseError>> => {
  const where = { location: Errors.AUTOMATION };
  const written = await Async.repeat(
    () => needs.automation.finish(action.id, outcome.status, outcome.reason),
    ATTEMPTS,
  )();
  if (!written.ok) {
    needs.logger.error(
      `close write failed; ${action.id} should be ${outcome.status}: ${Errors.detail(written.error)}`,
      where,
    );
    return jarl.ok(false);
  }
  // Something else, an abort or a shutdown, closed the row first.
  if (!written.value) {
    return jarl.ok(false);
  }
  if (outcome.status === "errored") {
    needs.logger.error(`${action.action} errored; ${outcome.reason}`, where);
  } else {
    needs.logger.info(`${action.action} ${outcome.status}`, where);
  }
  const job = await needs.tests.findResult(action.resultId);
  if (!job.ok) {
    return job;
  }
  const ticket = job.value?.linearId ?? null;
  if (action.action !== "diagnose" && ticket !== null) {
    await Ready.release(needs, ticket);
  }
  if (outcome.status === "errored") {
    await fail(needs, action, ticket, outcome.reason);
  }
  if (ticket !== null && outcome.status === "completed") {
    await moveTicket(needs, ticket, Linear.NEEDS_REVIEW_STATE, () =>
      needs.linear.moveToNeedsReview(ticket),
    );
  }
  if (ticket !== null && outcome.status === "succeeded" && action.action === "diagnose") {
    await verdict(needs, action, ticket, job.value?.sessionId ?? null);
  }
  return jarl.ok(true);
};
