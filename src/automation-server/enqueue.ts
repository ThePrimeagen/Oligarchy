import { Effect, Option } from "effect";
import * as Automation from "../db/automation.ts";
import * as Tests from "../db/tests.ts";
import * as Errors from "../shared/errors.ts";

const isDuplicateJob = (error: Errors.DatabaseError): boolean =>
  String(error.cause).includes("duplicate key");

// Automation Needed is a drive, unless this result is the mint install: that job is a
// mint, not a drive, so it is claimed ahead of the resumes waiting on it. Needs Review
// stays a diagnose.
export const queuedAction = (
  action: Automation.AutomationAction,
  definition: Option.Option<string>,
): Automation.AutomationAction =>
  action === "drive" && Option.isSome(definition) && definition.value === "mint" ? "mint" : action;

// The (result, action) unique index keeps one row, so a second insert is a duplicate, named by
// the status of the row it hit.
export const enqueueResult = Effect.fn("enqueueResult")(function* (
  resultId: string,
  action: Automation.AutomationAction,
) {
  const automation = yield* Automation.AutomationStore;
  const outcome = yield* automation.enqueue({ resultId, action }).pipe(
    Effect.as("queued" as const),
    Effect.catchTag("DatabaseError", (error) =>
      isDuplicateJob(error) ? Effect.succeed("duplicate" as const) : Effect.fail(error),
    ),
  );
  if (outcome === "duplicate") {
    const status = yield* automation.jobStatus(resultId, action);
    return {
      result: outcome,
      action,
      status: Option.getOrElse(status, () => "pending" as const),
    };
  }
  return { result: outcome, action };
});

// A missing result is not a job.
export const enqueueTicket = Effect.fn("enqueueTicket")(function* (
  ticket: string,
  action: Automation.AutomationAction,
) {
  const tests = yield* Tests.TestStore;
  const found = yield* tests.findResultByLinearId(ticket);
  if (Option.isNone(found)) {
    return { result: "missing" as const };
  }
  const definition = yield* tests.definitionName(found.value.definitionId);
  return yield* enqueueResult(found.value.id, queuedAction(action, definition));
});
