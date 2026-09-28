import type * as Db from "@oligarchy/db";
import type * as Linear from "@oligarchy/linear";
import type * as Stores from "@oligarchy/stores";
import type * as jarl from "jarl";
import type { Job, Needs } from "./needs.ts";

type AutomationAction = Stores.Automation.AutomationAction;

// Automation Needed is a drive, unless the job is the mint install: that action is a mint, not a
// drive, so it is claimed ahead of the resumes waiting on it. A job whose definition is gone is
// a drive.
export const driveOrMint = async (
  _needs: Pick<Needs, "tests">,
  _job: Job,
): Promise<jarl.Result<AutomationAction, Db.DatabaseError>> => {
  throw new Error("not implemented");
};

// The two columns that ask an action of the job whose ticket moves into them.
export type Asking = typeof Linear.AUTOMATION_NEEDED_STATE | typeof Linear.NEEDS_REVIEW_STATE;

// Whether a ticket moving into the column asks anything of its job, before the job is looked up.
export const asks = (_column: string): _column is Asking => {
  throw new Error("not implemented");
};

// The action a column asks of the job whose ticket moved into it: Automation Needed a drive or a
// mint, Needs Review a diagnose (the mint's too).
export const actionFor = async (
  _needs: Pick<Needs, "tests">,
  _column: Asking,
  _job: Job,
): Promise<jarl.Result<AutomationAction, Db.DatabaseError>> => {
  throw new Error("not implemented");
};

export type Duplicate = {
  readonly result: "duplicate";
  readonly action: AutomationAction;
  readonly status: Stores.Automation.JobStatus;
};

export type Enqueued = { readonly result: "queued"; readonly action: AutomationAction } | Duplicate;

// A pending row is the queue. Anything else the unique index kept is named by its status.
export const already = (_duplicate: Duplicate): string => {
  throw new Error("not implemented");
};

// The (result, action) unique index keeps one row, so a second insert is a duplicate, named by
// the status of the row it hit. Any other failed insert is that failure.
export const enqueue = async (
  _needs: Pick<Needs, "automation">,
  _job: Job,
  _action: AutomationAction,
): Promise<jarl.Result<Enqueued, Db.DatabaseError>> => {
  throw new Error("not implemented");
};
