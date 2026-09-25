import { Effect, Schedule } from "effect";
import * as Linear from "@oligarchy/linear/client";
import * as LinearErrors from "@oligarchy/linear/errors";
import * as Log from "@oligarchy/log/log";
import * as Errors from "./errors.ts";

// Ready is the label on the ticket of a pending drive or mint; a diagnose is never labeled.

// Linear drops a webhook delivery unanswered after five seconds, and a cold label lookup is up to
// four requests of ten seconds each.
const MARK_BUDGET = "3 seconds";

// The action row is already queued whatever Linear answers: one attempt inside the webhook's
// deadline, then the line. The board watch labels a pending action's ticket it finds unlabeled.
export const mark = Effect.fn("Ready.mark")(function* (ticket: string) {
  const linear = yield* Linear.Linear;
  const log = yield* Log.Log;
  yield* linear.markReady(ticket).pipe(
    Effect.timeoutOrElse({
      duration: MARK_BUDGET,
      orElse: () =>
        LinearErrors.LinearError.make({
          operation: "markReady",
          message: `linear: labeling ${ticket} ready failed: no answer within ${MARK_BUDGET}`,
        }),
    }),
    Effect.catch((error) =>
      log.error(`ready label add failed: ${Errors.detail(error)}`, {
        location: Log.Locations.automation,
        agentId: ticket,
        cause: error,
      }),
    ),
  );
});

// The action row is already closed. A Linear miss must not reopen it; three attempts, then the
// line.
export const release = Effect.fn("Ready.release")(function* (ticket: string) {
  const linear = yield* Linear.Linear;
  const log = yield* Log.Log;
  yield* linear.clearReady(ticket).pipe(
    Effect.retry(Schedule.recurs(2)),
    Effect.catch((error) =>
      log.error(`ready label clear failed: ${Errors.detail(error)}`, {
        location: Log.Locations.automation,
        agentId: ticket,
        cause: error,
      }),
    ),
  );
});
