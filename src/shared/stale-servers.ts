import { Cause, Effect, Schedule, type Scope, Schema } from "effect";
import * as DbErrors from "@oligarchy/db/errors";
import * as Servers from "@oligarchy/db/servers";
import * as ExternalFailure from "@oligarchy/log/external-failure";
import * as Log from "@oligarchy/log/log";
import * as Render from "@oligarchy/log/render";

// As often as a server writes its row, so a row is gone within one heartbeat of its tenth
// silent minute.
const SWEEP_INTERVAL = "30 seconds";

const isDatabaseError = Schema.is(DbErrors.DatabaseError);

// Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own message is the failed SQL.
const detail = (error: unknown): string =>
  isDatabaseError(error)
    ? Render.errorDetail(ExternalFailure.causeOf(error))
    : Render.errorDetail(error);

// Forgets, now and every thirty seconds, the servers of one kind silent for ten minutes, one info
// line per row under the process's own attribution. The process that reads a kind sweeps it — the
// qemu reverse proxy its fleet, the automation server its clients — and not the servers
// themselves, so a kind is swept while its reader runs even when no server does. A sweep that
// fails is one error line; the next tick runs.
export const forget = (
  type: Servers.ServerType,
): Effect.Effect<void, never, Scope.Scope | Servers.ServerStore | Log.Log> =>
  Effect.gen(function* () {
    const store = yield* Servers.ServerStore;
    const log = yield* Log.Log;
    const attribution = yield* Log.ProcessAttribution;
    const tick = Effect.gen(function* () {
      const forgotten = yield* store.removeStaleServers(type);
      for (const url of forgotten) {
        yield* log.info(`server forgotten; ${url} silent for 10 minutes`, attribution);
      }
    }).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        return log.error(`stale server cleanup failed: ${detail(error)}`, {
          ...attribution,
          cause: error,
        });
      }),
      // Uninterruptible with its lines inside, so a shutdown mid-sweep waits for the delete and
      // still records what went, or that it failed.
      Effect.uninterruptible,
    );
    yield* tick.pipe(
      Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)),
      Effect.forkScoped({ startImmediately: true }),
    );
  });
