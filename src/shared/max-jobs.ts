import { Cause, Effect, Option, Schedule, type Scope, Schema } from "effect";
import * as Servers from "../db/servers.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "./errors.ts";

// How often a qemu server or automation-client re-reads its servers.max_jobs: once a minute, so
// an operator's change on the website lands without a restart, and a busy tick is not every
// heartbeat.
export const INTERVAL = "1 minute";

const isDatabaseError = Schema.is(Errors.DatabaseError);

const detail = (error: unknown): string =>
  isDatabaseError(error)
    ? Render.errorDetail(ExternalFailure.causeOf(error))
    : Render.errorDetail(error);

// What Sessions exposes for capacity: the limit in force, and a write that takes effect on the
// next reserve. Lowering below the current count does not kill work already held; it only
// refuses new reservations until the count falls.
export type Capacity = {
  readonly maxJobs: Effect.Effect<number>;
  readonly setMaxJobs: (maxJobs: number) => Effect.Effect<void>;
};

// Reads this process's servers.max_jobs now and every minute. A null (row not yet seeded, or
// gone) leaves the in-memory limit alone. A change is one info line and Sessions.setMaxJobs.
// A read that fails is one error line; the next tick still runs. Started with the announce
// scope so a shutdown stops the polls with the heartbeat.
export const follow = (
  url: string,
  capacity: Capacity,
  attribution: Log.ProcessAttribution,
): Effect.Effect<void, never, Scope.Scope | Servers.ServerStore | Log.Log> =>
  Effect.gen(function* () {
    const store = yield* Servers.ServerStore;
    const log = yield* Log.Log;
    const tick = Effect.gen(function* () {
      const desired = yield* store.maxJobsFor(url);
      if (Option.isNone(desired)) {
        return;
      }
      const current = yield* capacity.maxJobs;
      if (desired.value === current) {
        return;
      }
      yield* capacity.setMaxJobs(desired.value);
      yield* log.info(`max-jobs set to ${String(desired.value)}`, attribution);
    }).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        return log.error(`max-jobs follow failed: ${detail(error)}`, {
          ...attribution,
          cause: error,
        });
      }),
    );
    yield* tick.pipe(
      Effect.repeat(Schedule.spaced(INTERVAL)),
      Effect.forkScoped({ startImmediately: true }),
    );
  });
