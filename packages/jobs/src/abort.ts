import { Effect, Option } from "effect";
import * as Automation from "@oligarchy/db/automation";
import * as Linear from "@oligarchy/linear/client";
import * as Log from "@oligarchy/log/log";
import * as Close from "./close.ts";
import * as Errors from "./errors.ts";
import * as Find from "./find.ts";
import * as Ready from "./ready.ts";

// The ticket of an aborted action: a drive or mint gives up its ready label, then the ticket
// moves to Aborted, three attempts, then a line. The row is already closed.
const settle = Effect.fn("Abort.settle")(function* (
  ticket: string,
  action: Automation.AutomationAction,
) {
  const linear = yield* Linear.Linear;
  if (action !== "diagnose") {
    yield* Ready.release(ticket);
  }
  yield* Close.moveTicket(ticket, Linear.ABORTED_STATE, linear.moveToAborted(ticket));
});

// A pending action has no driver to stop, so closing its row is the whole abort; a placement
// that reserved after this wins nothing, because running is written only while the row is still
// pending. A ticket with no job, or a job whose named action is not pending, is NoPendingAction:
// a running action is stopped at its automation client first, which is transport, then closed
// with `running`.
export const abort = Effect.fn("Abort.abort")(function* (
  ticket: string,
  action: Automation.AutomationAction,
) {
  const automation = yield* Automation.AutomationStore;
  const log = yield* Log.Log;
  const job = yield* Find.byTicket(ticket);
  if (Option.isNone(job) || !(yield* automation.abortPending(job.value.id, action))) {
    return yield* Errors.NoPendingAction.make({ ticket, action });
  }
  yield* log.info(`aborted pending ${action}`, {
    location: Log.Locations.automation,
    agentId: ticket,
  });
  return yield* settle(ticket, action);
});

// True when this call closed the running action aborted, once its driver was stopped. A row that
// closed some other way meanwhile finished: it had nothing to abort, and its ticket stays put.
export const running = Effect.fn("Abort.running")(function* (
  ticket: string,
  action: Automation.AutomationJobRow,
) {
  const automation = yield* Automation.AutomationStore;
  if (!(yield* automation.finish(action.id, "aborted", "aborted"))) {
    return false;
  }
  yield* settle(ticket, action.action);
  return true;
});
