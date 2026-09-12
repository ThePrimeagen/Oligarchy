import { Cause, Effect, Schedule, type Scope, Schema } from "effect";
import * as ProcessStats from "../db/process-stats.ts";
import * as Servers from "../db/servers.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as ProcessUsage from "../shared/process-usage.ts";
import * as Sessions from "./sessions.ts";

// Every thirty seconds, and the dashboard polls as often: a server's row is never more than one
// poll behind, and three missed writes are what the page calls silent.
const HEARTBEAT_INTERVAL = "30 seconds";

const isDatabaseError = Schema.is(Errors.DatabaseError);

// Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own message is the failed SQL.
const detail = (error: unknown): string =>
  isDatabaseError(error)
    ? Render.errorDetail(ExternalFailure.causeOf(error))
    : Render.errorDetail(error);

// Announces this server under `url`: its `servers` row is written now and every thirty seconds
// with what it knows of itself — a qemu server, this process boots nothing else — and the row's
// generation counts the writes, so a number that stops moving is a server that stopped without a
// chance to leave. The same tick writes `process_stats`: current jobs, current VmRSS, and the
// cpu busy over the last thirty seconds. A write that fails is one error line; the other write
// and the next tick still run. The rows are this process's word on itself, so a shutdown
// deletes them: registered before the loop so the fiber is interrupted first, a write in
// flight finishes (the write is uninterruptible), then the rows go. A delete that fails is one
// `unannounce failed` line; the process still exits.
export const announce = (
  url: string,
): Effect.Effect<
  void,
  never,
  | Scope.Scope
  | Sessions.Sessions
  | ProcessUsage.ProcessUsage
  | Servers.ServerStore
  | ProcessStats.ProcessStatsStore
  | Log.Log
> =>
  Effect.gen(function* () {
    const sessions = yield* Sessions.Sessions;
    const usage = yield* ProcessUsage.ProcessUsage;
    const store = yield* Servers.ServerStore;
    const processStore = yield* ProcessStats.ProcessStatsStore;
    const log = yield* Log.Log;
    const failed = (text: string) => (cause: Cause.Cause<unknown>) => {
      const error = Cause.squash(cause);
      return log.error(`${text}: ${detail(error)}`, {
        location: Log.Locations.server,
        cause: error,
      });
    };
    const writeHeartbeat = sessions.stats.pipe(
      Effect.flatMap((stats) =>
        Effect.uninterruptible(
          store.heartbeat(url, "qemu", {
            qemus: stats.qemus,
            memory: { totalBytes: stats.memory.totalBytes, usedBytes: stats.memory.usedBytes },
            cpu: { mean1m: stats.cpu.mean1m, mean2m: stats.cpu.mean2m, mean3m: stats.cpu.mean3m },
          }),
        ),
      ),
      Effect.catchCause(failed("heartbeat failed")),
    );
    const writeProcess = Effect.gen(function* () {
      const jobs = yield* sessions.jobs;
      const sample = yield* usage.collect;
      yield* Effect.uninterruptible(
        processStore.report(url, "qemu", {
          jobs,
          memoryBytes: sample.memoryBytes,
          cpuPercent: sample.cpuPercent,
        }),
      );
    }).pipe(Effect.catchCause(failed("process stats failed")));
    const tick = writeHeartbeat.pipe(Effect.andThen(writeProcess));
    // Before the loop: close interrupts the fiber first, then this runs.
    yield* Effect.addFinalizer(() =>
      processStore
        .remove(url)
        .pipe(
          Effect.catchCause(failed("unannounce process stats failed")),
          Effect.andThen(
            store.removeServer(url).pipe(Effect.catchCause(failed("unannounce failed"))),
          ),
          Effect.asVoid,
        ),
    );
    yield* tick.pipe(
      Effect.repeat(Schedule.spaced(HEARTBEAT_INTERVAL)),
      Effect.forkScoped({ startImmediately: true }),
    );
  });
