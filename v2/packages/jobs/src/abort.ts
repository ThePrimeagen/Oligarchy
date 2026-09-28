import type * as Db from "@oligarchy/db";
import * as Linear from "@oligarchy/linear";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { moveTicket } from "./close.ts";
import * as Errors from "./errors.ts";
import type { Action, Needs } from "./needs.ts";
import * as Ready from "./ready.ts";

// The ticket of an aborted action: a drive or mint gives up its ready label, then the ticket
// moves to Aborted, three attempts, then a line. The row is already closed.
const settle = async (
  needs: Pick<Needs, "linear" | "logger">,
  ticket: string,
  action: Stores.Automation.AutomationAction,
) => {
  if (action !== "diagnose") {
    await Ready.release(needs, ticket);
  }
  await moveTicket(needs, ticket, Linear.ABORTED_STATE, () => needs.linear.moveToAborted(ticket));
};

// A pending action has no driver to stop, so closing its row is the whole abort; a placement
// that reserved after this wins nothing, because running is written only while the row is still
// pending. A ticket with no job, or a job whose named action is not pending, is NoPendingAction:
// a running action is stopped at its automation client first, which is transport, then closed
// with `running`.
export const abort = async (
  needs: Pick<Needs, "tests" | "automation" | "linear" | "logger">,
  ticket: string,
  action: Stores.Automation.AutomationAction,
): Promise<jarl.Result<void, Errors.NoPendingAction | Db.DatabaseError>> => {
  const nothing = () =>
    jarl.err(new Errors.NoPendingAction(`ticket "${ticket}" has no ${action} to abort`));
  const job = await needs.tests.findResultByLinearId(ticket);
  if (!job.ok) {
    return job;
  }
  if (job.value === undefined) {
    return nothing();
  }
  const aborted = await needs.automation.abortPending(job.value.id, action);
  if (!aborted.ok) {
    return aborted;
  }
  if (!aborted.value) {
    return nothing();
  }
  needs.logger.info(`aborted pending ${action}`, {
    location: Errors.AUTOMATION,
    agentId: ticket,
  });
  await settle(needs, ticket, action);
  return jarl.ok(undefined);
};

// True when this call closed the running action aborted, once its driver was stopped. A row that
// closed some other way meanwhile finished: it had nothing to abort, and its ticket stays put.
export const running = async (
  needs: Pick<Needs, "automation" | "linear" | "logger">,
  ticket: string,
  action: Action,
): Promise<jarl.Result<boolean, Db.DatabaseError>> => {
  const closed = await needs.automation.finish(action.id, "aborted", "aborted");
  if (!closed.ok || !closed.value) {
    return closed;
  }
  await settle(needs, ticket, action.action);
  return closed;
};
