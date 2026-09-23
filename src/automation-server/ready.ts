import { Effect, Schedule, Schema } from "effect";
import * as Linear from "../ctrl/linear.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";

const isDatabaseError = Schema.is(Errors.DatabaseError);

const detail = (error: unknown): string =>
  isDatabaseError(error)
    ? Render.errorDetail(ExternalFailure.causeOf(error))
    : Render.errorDetail(error);

// Linear drops a webhook delivery unanswered after five seconds, and a cold label lookup is up to
// four requests of ten seconds each.
const MARK_BUDGET = "3 seconds";

// The job row is already queued whatever Linear answers: one attempt inside the webhook's deadline,
// then the log. The board watch labels a pending job's ticket it finds unlabeled.
export const mark = Effect.fn("markReady")(function* (identifier: string) {
  const linear = yield* Linear.Linear;
  const log = yield* Log.Log;
  yield* linear.markReady(identifier).pipe(
    Effect.timeoutOrElse({
      duration: MARK_BUDGET,
      orElse: () =>
        Errors.LinearError.make({
          operation: "markReady",
          message: `linear: labeling ${identifier} ready failed: no answer within ${MARK_BUDGET}`,
        }),
    }),
    Effect.catch((error) =>
      log.error(`ready label add failed: ${detail(error)}`, {
        location: Log.Locations.automation,
        agentId: identifier,
        cause: error,
      }),
    ),
  );
});

// The job row is already closed. A Linear miss must not reopen it; two immediate retries, then the log.
export const release = Effect.fn("releaseReady")(function* (identifier: string) {
  const linear = yield* Linear.Linear;
  const log = yield* Log.Log;
  yield* linear.clearReady(identifier).pipe(
    Effect.retry(Schedule.recurs(2)),
    Effect.catch((error) =>
      log.error(`ready label clear failed: ${detail(error)}`, {
        location: Log.Locations.automation,
        agentId: identifier,
        cause: error,
      }),
    ),
  );
});
