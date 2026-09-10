import { Cause, Effect, Schedule, type Scope, Schema } from "effect";
import * as Servers from "../db/servers.ts";
import type * as DbSchema from "../db/schema.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import type * as Stats from "./stats.ts";

// Every thirty seconds, and the dashboard polls as often: a server's row is never more than one
// poll behind, and three missed writes are what the page calls silent.
const HEARTBEAT_INTERVAL = "30 seconds";

const isDatabaseError = Schema.is(Errors.DatabaseError);

// Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own message is the failed SQL.
const detail = (error: unknown): string =>
  isDatabaseError(error)
    ? Render.errorDetail(ExternalFailure.causeOf(error))
    : Render.errorDetail(error);

export const hostRow = (host: Stats.HostStats): DbSchema.HostRowStats => ({
  memory: { totalBytes: host.memory.totalBytes, usedBytes: host.memory.usedBytes },
  cpu: { mean1m: host.cpu.mean1m, mean2m: host.cpu.mean2m, mean3m: host.cpu.mean3m },
});

// Announces this process under `url` and `type`: its `servers` row is written now and every
// thirty seconds with the stats effect's answer, and the row's generation counts the writes, so
// a number that stops moving is a process that stopped without a chance to leave. A tick that
// fails is one error line; the next tick runs. The row is this process's word on itself, so a
// shutdown deletes it: registered before the loop so the fiber is interrupted first, a write in
// flight finishes (the write is uninterruptible), then the row goes. A delete that fails is one
// `unannounce failed` line; the process still exits.
export const announce = (
  url: string,
  type: Servers.ServerType,
  stats: Effect.Effect<DbSchema.ServerStats>,
): Effect.Effect<void, never, Scope.Scope | Servers.ServerStore | Log.Log> =>
  Effect.gen(function* () {
    const store = yield* Servers.ServerStore;
    const log = yield* Log.Log;
    const attribution = yield* Log.ProcessAttribution;
    const tick = stats.pipe(
      Effect.flatMap((row) => Effect.uninterruptible(store.heartbeat(url, type, row))),
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        return log.error(`heartbeat failed: ${detail(error)}`, {
          ...attribution,
          cause: error,
        });
      }),
    );
    // Before the loop: close interrupts the fiber first, then this runs.
    yield* Effect.addFinalizer(() =>
      store.removeServer(url).pipe(
        Effect.catchCause((cause) => {
          const error = Cause.squash(cause);
          return log.error(`unannounce failed: ${detail(error)}`, {
            ...attribution,
            cause: error,
          });
        }),
        Effect.asVoid,
      ),
    );
    yield* tick.pipe(
      Effect.repeat(Schedule.spaced(HEARTBEAT_INTERVAL)),
      Effect.forkScoped({ startImmediately: true }),
    );
  });
