import { Effect, Option } from "effect";
import * as Automation from "@oligarchy/db/automation";
import type * as DbErrors from "@oligarchy/db/errors";
import * as Tests from "@oligarchy/db/tests";
import * as Linear from "@oligarchy/linear/client";
import * as Find from "./find.ts";
import * as Open from "./open.ts";

const isDuplicate = (error: DbErrors.DatabaseError): boolean =>
  String(error.cause).includes("duplicate key");

// Automation Needed is a drive, unless the job is the mint install: that action is a mint, not a
// drive, so it is claimed ahead of the resumes waiting on it. A job whose definition is gone is
// a drive.
export const driveOrMint = Effect.fn("Board.driveOrMint")(function* (job: Find.Job) {
  const tests = yield* Tests.TestStore;
  const name = yield* tests.definitionName(job.definitionId);
  const action: Automation.AutomationAction = Option.contains(name, Open.MINT_DEFINITION)
    ? "mint"
    : "drive";
  return action;
});

// Whether a ticket moving into the column asks anything of its job, before the job is looked up.
export const asks = (column: string): boolean =>
  column === Linear.AUTOMATION_NEEDED_STATE || column === Linear.NEEDS_REVIEW_STATE;

// The action a column asks of the job whose ticket moved into it: Automation Needed a drive or a
// mint, Needs Review a diagnose (the mint's too), any other column none.
export const actionFor = Effect.fn("Board.actionFor")(function* (column: string, job: Find.Job) {
  if (column === Linear.AUTOMATION_NEEDED_STATE) {
    return Option.some(yield* driveOrMint(job));
  }
  if (column === Linear.NEEDS_REVIEW_STATE) {
    return Option.some<Automation.AutomationAction>("diagnose");
  }
  return Option.none<Automation.AutomationAction>();
});

export type Enqueued =
  | { readonly result: "queued"; readonly action: Automation.AutomationAction }
  | {
      readonly result: "duplicate";
      readonly action: Automation.AutomationAction;
      readonly status: Automation.AutomationJobRow["status"];
    };

// The (result, action) unique index keeps one row, so a second insert is a duplicate, named by
// the status of the row it hit. Any other failed insert is that failure.
export const enqueue = Effect.fn("Board.enqueue")(function* (
  job: Find.Job,
  action: Automation.AutomationAction,
) {
  const automation = yield* Automation.AutomationStore;
  const inserted = yield* automation.enqueue({ resultId: job.id, action }).pipe(
    Effect.as(true),
    Effect.catchTag("DatabaseError", (error) =>
      isDuplicate(error) ? Effect.succeed(false) : Effect.fail(error),
    ),
  );
  if (inserted) {
    const queued: Enqueued = { result: "queued", action };
    return queued;
  }
  const kept = yield* Find.status(job, action);
  const duplicate: Enqueued = {
    result: "duplicate",
    action,
    status: Option.getOrElse(kept, () => "pending" as const),
  };
  return duplicate;
});
