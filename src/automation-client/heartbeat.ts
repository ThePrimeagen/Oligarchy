import { Cause, Effect, Schedule, type Scope, Schema } from "effect";
import * as Servers from "../db/servers.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Stats from "../qemu/stats.ts";
import * as Errors from "../shared/errors.ts";
import * as Sessions from "./sessions.ts";

// Every thirty seconds, and the dashboard polls as often: a client's row is never more than one
// poll behind, and three missed writes are what the page calls silent.
const HEARTBEAT_INTERVAL = "30 seconds";

const isDatabaseError = Schema.is(Errors.DatabaseError);

// Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own message is the failed SQL.
const detail = (error: unknown): string =>
  isDatabaseError(error)
    ? Render.errorDetail(ExternalFailure.causeOf(error))
    : Render.errorDetail(error);

// Announces this process under `url`: its `servers` row is written now and every thirty seconds
// as an automation-client, with the host's stats and qemus 0 — this process boots no guests —
// jobs the running count, and max_jobs the --max-jobs it was started with. The row's
// generation counts the writes, so a number that stops moving is a client that stopped without
// a chance to leave. A tick that fails is one error line; the next tick runs. The row is this
// process's word on itself, so a shutdown deletes it: registered before the loop so the fiber
// is interrupted first, a write in flight finishes (the write is uninterruptible), then the
// row goes. A delete that fails is one `unannounce failed` line; the process still exits.
export const announce = (
  url: string,
  maxJobs: number,
): Effect.Effect<
  void,
  never,
  Scope.Scope | Stats.Stats | Sessions.Sessions | Servers.ServerStore | Log.Log
> =>
  Effect.gen(function* () {
    const stats = yield* Stats.Stats;
    const sessions = yield* Sessions.Sessions;
    const store = yield* Servers.ServerStore;
    const log = yield* Log.Log;
    const tick = Effect.gen(function* () {
      const collected = yield* stats.collect(0);
      const jobs = yield* sessions.jobs;
      yield* Effect.uninterruptible(
        store.heartbeat(
          url,
          "automation-client",
          {
            qemus: collected.qemus,
            memory: {
              totalBytes: collected.memory.totalBytes,
              usedBytes: collected.memory.usedBytes,
            },
            cpu: {
              mean1m: collected.cpu.mean1m,
              mean2m: collected.cpu.mean2m,
              mean3m: collected.cpu.mean3m,
            },
          },
          jobs,
          maxJobs,
        ),
      );
    }).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        return log.error(`heartbeat failed: ${detail(error)}`, {
          location: Log.Locations.automationClient,
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
            location: Log.Locations.automationClient,
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
