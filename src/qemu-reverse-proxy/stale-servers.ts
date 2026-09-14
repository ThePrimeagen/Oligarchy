import { Cause, Effect, Schedule, type Scope, Schema } from "effect";
import * as Servers from "../db/servers.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";

// As often as a server writes its row, so a row is gone within one heartbeat of its tenth
// silent minute.
const SWEEP_INTERVAL = "30 seconds";

const isDatabaseError = Schema.is(Errors.DatabaseError);

// Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own message is the failed SQL.
const detail = (error: unknown): string =>
  isDatabaseError(error)
    ? Render.errorDetail(ExternalFailure.causeOf(error))
    : Render.errorDetail(error);

// Forgets, now and every thirty seconds, the qemu servers silent for ten minutes: a server killed
// without a chance to leave (or cut off from the database that long) leaves the fleet this proxy
// places on, and the dashboard's table, with one info line per row. This process and not the
// servers: the fleet is what this proxy reads, so it is swept while the proxy runs even when no
// server does, and the row's whole story — registered, removed, forgotten — is in one log. The
// delete and its lines are one uninterruptible step, so a shutdown mid-sweep still records what
// went. A sweep that fails is one error line; the next tick runs.
export const forget: Effect.Effect<void, never, Scope.Scope | Servers.ServerStore | Log.Log> =
  Effect.gen(function* () {
    const store = yield* Servers.ServerStore;
    const log = yield* Log.Log;
    const tick = Effect.gen(function* () {
      const forgotten = yield* store.removeStaleServers("qemu");
      for (const url of forgotten) {
        yield* log.info(`server forgotten; ${url} silent for 10 minutes`, {
          location: Log.Locations.server,
        });
      }
    }).pipe(
      Effect.uninterruptible,
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        return log.error(`stale server cleanup failed: ${detail(error)}`, {
          location: Log.Locations.server,
          cause: error,
        });
      }),
    );
    yield* tick.pipe(
      Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)),
      Effect.forkScoped({ startImmediately: true }),
    );
  });
