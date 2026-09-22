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
