import { Cause, Effect, Schedule, type Scope } from "effect";
import * as Servers from "@oligarchy/db/servers";
import * as Log from "@oligarchy/log/log";
import * as Member from "./member.ts";

// Forgets, now and as often as a member writes its row, the servers of one kind silent for ten
// minutes, one info line per row under the process's own attribution, so a row is gone within one
// heartbeat of its tenth silent minute. The process that reads a kind sweeps it — the qemu
// reverse proxy its fleet, the automation server its clients — and not the servers themselves, so
// a kind is swept while its reader runs even when no server does. A sweep that fails is one error
// line; the next tick runs.
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
        return log.error(`stale server cleanup failed: ${Member.detail(error)}`, {
          ...attribution,
          cause: error,
        });
      }),
      // Uninterruptible with its lines inside, so a shutdown mid-sweep waits for the delete and
      // still records what went, or that it failed.
      Effect.uninterruptible,
    );
    yield* tick.pipe(
      Effect.repeat(Schedule.spaced(Member.HEARTBEAT_INTERVAL)),
      Effect.forkScoped({ startImmediately: true }),
    );
  });
