import type * as Db from "@oligarchy/db";
import type * as Stores from "@oligarchy/stores";
import type * as jarl from "jarl";
import type * as Errors from "./errors.ts";
import type { Action, Needs } from "./needs.ts";

// A pending action has no driver to stop, so closing its row is the whole abort; a placement
// that reserved after this wins nothing, because running is written only while the row is still
// pending. A ticket with no job, or a job whose named action is not pending, is NoPendingAction:
// a running action is stopped at its automation client first, which is transport, then closed
// with `running`.
export const abort = async (
  _needs: Pick<Needs, "tests" | "automation" | "linear" | "logger">,
  _ticket: string,
  _action: Stores.Automation.AutomationAction,
): Promise<jarl.Result<void, Errors.NoPendingAction | Db.DatabaseError>> => {
  throw new Error("not implemented");
};

// True when this call closed the running action aborted, once its driver was stopped. A row that
// closed some other way meanwhile finished: it had nothing to abort, and its ticket stays put.
export const running = async (
  _needs: Pick<Needs, "automation" | "linear" | "logger">,
  _ticket: string,
  _action: Action,
): Promise<jarl.Result<boolean, Db.DatabaseError>> => {
  throw new Error("not implemented");
};
