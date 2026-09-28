import type * as Db from "@oligarchy/db";
import * as Linear from "@oligarchy/linear";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import type { Job, Needs } from "./needs.ts";
import { MINT_DEFINITION } from "./open.ts";

type AutomationAction = Stores.Automation.AutomationAction;

const isDuplicate = (error: Db.DatabaseError): boolean =>
  String(error.cause).includes("duplicate key");

// Automation Needed is a drive, unless the job is the mint install: that action is a mint, not a
// drive, so it is claimed ahead of the resumes waiting on it. A job whose definition is gone is
// a drive.
export const driveOrMint = async (
  needs: Pick<Needs, "tests">,
  job: Job,
): Promise<jarl.Result<AutomationAction, Db.DatabaseError>> => {
  const name = await needs.tests.definitionName(job.definitionId);
  if (!name.ok) {
    return name;
  }
  return jarl.ok(name.value === MINT_DEFINITION ? "mint" : "drive");
};

// The two columns that ask an action of the job whose ticket moves into them.
export type Asking = typeof Linear.AUTOMATION_NEEDED_STATE | typeof Linear.NEEDS_REVIEW_STATE;

// Whether a ticket moving into the column asks anything of its job, before the job is looked up.
export const asks = (column: string): column is Asking =>
  column === Linear.AUTOMATION_NEEDED_STATE || column === Linear.NEEDS_REVIEW_STATE;

// The action a column asks of the job whose ticket moved into it: Automation Needed a drive or a
// mint, Needs Review a diagnose (the mint's too).
export const actionFor = async (
  needs: Pick<Needs, "tests">,
  column: Asking,
  job: Job,
): Promise<jarl.Result<AutomationAction, Db.DatabaseError>> =>
  column === Linear.AUTOMATION_NEEDED_STATE ? driveOrMint(needs, job) : jarl.ok("diagnose");

export type Duplicate = {
  readonly result: "duplicate";
  readonly action: AutomationAction;
  readonly status: Stores.Automation.JobStatus;
};

export type Enqueued = { readonly result: "queued"; readonly action: AutomationAction } | Duplicate;

// A pending row is the queue. Anything else the unique index kept is named by its status.
export const already = (duplicate: Duplicate): string =>
  `${duplicate.action} already ${duplicate.status === "pending" ? "queued" : duplicate.status}`;

// The (result, action) unique index keeps one row, so a second insert is a duplicate, named by
// the status of the row it hit. Any other failed insert is that failure.
export const enqueue = async (
  needs: Pick<Needs, "automation">,
  job: Job,
  action: AutomationAction,
): Promise<jarl.Result<Enqueued, Db.DatabaseError>> => {
  const inserted = await needs.automation.enqueue({ resultId: job.id, action });
  if (inserted.ok) {
    return jarl.ok({ result: "queued", action });
  }
  if (!isDuplicate(inserted.error)) {
    return inserted;
  }
  const kept = await needs.automation.jobStatus(job.id, action);
  if (!kept.ok) {
    return kept;
  }
  // The row the insert hit was deleted before it could be read, by the old-row sweep. Its
  // status is unknown, so it reads as the queue this insert would have joined.
  return jarl.ok({ result: "duplicate", action, status: kept.value ?? "pending" });
};
