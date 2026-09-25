import { Effect, Option, Result, Schedule } from "effect";
import * as Automation from "@oligarchy/db/automation";
import * as Diagnosis from "@oligarchy/db/diagnosis";
import * as Sessions from "@oligarchy/db/sessions";
import * as Tests from "@oligarchy/db/tests";
import * as Linear from "@oligarchy/linear/client";
import type * as LinearErrors from "@oligarchy/linear/errors";
import * as Log from "@oligarchy/log/log";
import * as Errors from "./errors.ts";
import * as Find from "./find.ts";
import * as Ready from "./ready.ts";

type Action = Automation.AutomationJobRow;

// errored is the system failing the action, never the test, and always says why.
export type Outcome =
  | { readonly status: "errored"; readonly reason: string }
  | {
      readonly status: Exclude<Automation.FinishStatus, "errored">;
      readonly reason: string | null;
    };

// A drive or mint that ran to its end is completed: the diagnosis judges it. A diagnose that
// ran is succeeded. failed is a diagnosis verdict, not an action's close.
const finished = (action: Action): Outcome => ({
  status: action.action === "diagnose" ? "succeeded" : "completed",
  reason: null,
});

// What an action made of a driver that exited cleanly.
export const judge = Effect.fn("Close.judge")(function* (action: Action) {
  // A diagnose is judged by nothing here: its job was closed before it was queued.
  if (action.action === "diagnose") {
    return finished(action);
  }
  const tests = yield* Tests.TestStore;
  const sessions = yield* Sessions.SessionStore;
  // The driver exiting 0 with the job still open is an agent that quit early, and the action
  // says so rather than reading as a run. The harness closes the job on stop or save.
  const job = yield* tests.findResult(action.resultId);
  if (Option.isNone(job)) {
    return yield* Effect.die(
      new Error(`judge: result ${action.resultId} vanished during the drive`),
    );
  }
  if (Find.isOpen(job.value)) {
    const open: Outcome = {
      status: "errored",
      reason: `driver exited; result ${action.resultId} is ${job.value.status}`,
    };
    return open;
  }
  // A driver closes the job whatever happened to its guest. A session the qemu server errored
  // is the system failing the drive, whatever verdict the driver wrote.
  const sessionId = job.value.sessionId;
  if (sessionId !== null) {
    const session = yield* sessions.getSession(sessionId);
    if (Option.isSome(session) && session.value.status === "errored") {
      const why = session.value.reason === null ? "" : `; ${session.value.reason}`;
      const lost: Outcome = { status: "errored", reason: `session ${sessionId} errored${why}` };
      return lost;
    }
  }
  return finished(action);
});

// Three attempts, then a line. The action is already closed; a board that will not move does
// not reopen it.
export const moveTicket = Effect.fn("Close.moveTicket")(function* (
  ticket: string,
  column: string,
  move: Effect.Effect<void, LinearErrors.LinearError>,
) {
  const log = yield* Log.Log;
  yield* move.pipe(
    Effect.retry(Schedule.recurs(2)),
    Effect.catchTag("LinearError", (error) =>
      log.error(`move to ${column} failed: ${Errors.detail(error)}`, {
        location: Log.Locations.automation,
        agentId: ticket,
        cause: error,
      }),
    ),
  );
});

// The system failed the action. A drive's or mint's job is errored with it, since whatever
// verdict it had is not the test's; a diagnose leaves the job it was judging alone. The ticket
// moves to Errored with the reason. Neither failing unwinds the close: each is a line.
export const fail = Effect.fn("Close.fail")(function* (
  action: Action,
  ticket: string | null,
  reason: string,
) {
  const tests = yield* Tests.TestStore;
  const linear = yield* Linear.Linear;
  const log = yield* Log.Log;
  if (action.action !== "diagnose") {
    yield* tests.errorResult(action.resultId, reason).pipe(
      Effect.retry(Schedule.recurs(2)),
      Effect.catchTag("DatabaseError", (error) =>
        log.error(
          `result errored write failed; ${action.resultId}: ${Errors.detail(error)}`,
          Object.assign(
            { location: Log.Locations.automation, cause: error },
            ticket === null ? undefined : { agentId: ticket },
          ),
        ),
      ),
    );
  }
  if (ticket === null) {
    return;
  }
  yield* moveTicket(
    ticket,
    Linear.ERRORED_STATE,
    linear.moveToErrored(ticket, `${action.action} errored; ${reason}`),
  );
});

// The diagnosing agent writes the verdict on the drive's session before it exits. Passed is
// Succeeded and failed is Failed. No session, no row, or a read that will not land is a line:
// guessing a column would be a lie, and the diagnose is already succeeded.
const verdict = Effect.fn("Close.verdict")(function* (
  action: Action,
  ticket: string,
  sessionId: string | null,
) {
  const diagnosis = yield* Diagnosis.DiagnosisStore;
  const linear = yield* Linear.Linear;
  const log = yield* Log.Log;
  const attr = { location: Log.Locations.automation, agentId: ticket };
  if (sessionId === null) {
    yield* log.error(`diagnose verdict missing; ${action.resultId}`, attr);
    return;
  }
  const read = yield* diagnosis
    .getDiagnosis(sessionId)
    .pipe(Effect.retry(Schedule.recurs(2)), Effect.result);
  if (Result.isFailure(read)) {
    yield* log.error(`diagnose verdict read failed; ${sessionId}: ${Errors.detail(read.failure)}`, {
      ...attr,
      cause: read.failure,
    });
    return;
  }
  if (Option.isNone(read.success)) {
    yield* log.error(`diagnose verdict missing; ${sessionId}`, attr);
    return;
  }
  if (read.success.value.verdict === "passed") {
    yield* moveTicket(ticket, Linear.SUCCEEDED_STATE, linear.moveToSucceeded(ticket));
    return;
  }
  yield* moveTicket(ticket, Linear.FAILED_STATE, linear.moveToFailed(ticket));
});

const logOutcome = Effect.fn("Close.logOutcome")(function* (action: Action, outcome: Outcome) {
  const log = yield* Log.Log;
  const attr = { location: Log.Locations.automation };
  if (outcome.status === "errored") {
    yield* log.error(`${action.action} errored; ${outcome.reason}`, attr);
    return;
  }
  yield* log.info(`${action.action} ${outcome.status}`, attr);
});

// True when this call closed the row. Three attempts at the write; a row that still will not
// close stays running for an operator to mark, and the line names the status it should have.
// Then the ticket: a drive or mint gives up its ready label; errored moves to Errored; a drive
// or mint that completed goes to Needs Review; a diagnose that succeeded goes to Succeeded or
// Failed by its verdict; aborted stays where it was.
export const close = Effect.fn("Close.close")(function* (action: Action, outcome: Outcome) {
  const automation = yield* Automation.AutomationStore;
  const tests = yield* Tests.TestStore;
  const linear = yield* Linear.Linear;
  const log = yield* Log.Log;
  const written = yield* automation
    .finish(action.id, outcome.status, outcome.reason)
    .pipe(Effect.retry(Schedule.recurs(2)), Effect.result);
  if (Result.isFailure(written)) {
    yield* log.error(`close write failed; ${action.id} should be ${outcome.status}`, {
      location: Log.Locations.automation,
      cause: written.failure,
    });
    return false;
  }
  // Something else, an abort or a shutdown, closed the row first.
  if (!written.success) {
    return false;
  }
  yield* logOutcome(action, outcome);
  const job = yield* tests.findResult(action.resultId);
  const ticket = Option.isSome(job) ? job.value.linearId : null;
  if (action.action !== "diagnose" && ticket !== null) {
    yield* Ready.release(ticket);
  }
  if (outcome.status === "errored") {
    yield* fail(action, ticket, outcome.reason);
  }
  if (ticket !== null && outcome.status === "completed") {
    yield* moveTicket(ticket, Linear.NEEDS_REVIEW_STATE, linear.moveToNeedsReview(ticket));
  }
  if (ticket !== null && outcome.status === "succeeded" && action.action === "diagnose") {
    yield* verdict(action, ticket, Option.isSome(job) ? job.value.sessionId : null);
  }
  return true;
});
