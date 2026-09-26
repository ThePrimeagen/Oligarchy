import { Cause, Effect, Ref, Schedule, type Scope, Schema } from "effect";
import * as DbErrors from "@oligarchy/db/errors";
import * as ProcessStats from "@oligarchy/db/process-stats";
import * as Servers from "@oligarchy/db/servers";
import * as ExternalFailure from "@oligarchy/log/external-failure";
import * as Log from "@oligarchy/log/log";
import * as Render from "@oligarchy/log/render";
import * as Host from "./host.ts";
import * as ProcessUsage from "./process.ts";

// Every thirty seconds, and the dashboard polls as often: a member's row is never more than one
// poll behind, and three missed writes are what the page calls silent.
export const HEARTBEAT_INTERVAL = "30 seconds";

const isDatabaseError = Schema.is(DbErrors.DatabaseError);

// Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own message is the failed SQL.
export const detail = (error: unknown): string =>
  isDatabaseError(error)
    ? Render.errorDetail(ExternalFailure.causeOf(error))
    : Render.errorDetail(error);

// A server that announces itself to the fleet. The template writes the rows; a member says only
// what it alone knows. One requirement type per hook: a single one does not infer when `report`
// needs one service and `onJoin` another.
export type Member<RReport, EReport, RJoin, EJoin, RLeave, ELeave> = {
  readonly type: Servers.ServerType;
  readonly url: string;
  readonly name: string;
  // Where this member's lines land.
  readonly attribution: Log.Attribution;
  // Each tick: the guests it runs and the jobs it holds. The template adds the host's memory and
  // cpu from the sampler, and this process's from the reader.
  readonly report: Effect.Effect<
    { readonly qemus: number; readonly jobs: number },
    EReport,
    RReport
  >;
  // Once on joining, retried each tick until it succeeds: reclaim what a previous incarnation
  // under this url left behind.
  readonly onJoin?: Effect.Effect<void, EJoin, RJoin>;
  // Before the servers row is deleted on shutdown.
  readonly onLeave?: Effect.Effect<void, ELeave, RLeave>;
};

// Announces `member`: its `servers` row is written now and every thirty seconds with its guests
// and the host's stats, and the row's generation counts the writes, so a number that stops moving
// is a server that stopped without a chance to leave. The same tick inserts a `process_stats`
// row: its jobs, this process's memory (VmRSS of it and every child that still answers, or ps's
// rss on macOS) and its cpu busy over the last thirty seconds. Each failure is one error line
// under the member's attribution, and the rest of the tick and the next tick still run. A
// shutdown deletes the servers row only: the readings stay so they can be graphed later.
// Registered before the loop so the fiber is interrupted first; a write in flight finishes (the
// write is uninterruptible). A delete that fails is one `unannounce failed` line; the process
// still exits.
// A hook a member leaves out needs nothing and fails with nothing.
export const announce = <
  RReport = never,
  EReport = never,
  RJoin = never,
  EJoin = never,
  RLeave = never,
  ELeave = never,
>(
  member: Member<RReport, EReport, RJoin, EJoin, RLeave, ELeave>,
): Effect.Effect<
  void,
  never,
  | RReport
  | RJoin
  | RLeave
  | Scope.Scope
  | Host.Host
  | ProcessUsage.ProcessUsage
  | Servers.ServerStore
  | ProcessStats.ProcessStatsStore
  | Log.Log
> =>
  Effect.gen(function* () {
    const host = yield* Host.Host;
    const usage = yield* ProcessUsage.ProcessUsage;
    const store = yield* Servers.ServerStore;
    const processStore = yield* ProcessStats.ProcessStatsStore;
    const log = yield* Log.Log;
    const failed = (text: string) => (cause: Cause.Cause<unknown>) => {
      const error = Cause.squash(cause);
      return log.error(`${text}: ${detail(error)}`, { ...member.attribution, cause: error });
    };
    const writeServers = (qemus: number) =>
      host.collect.pipe(
        Effect.flatMap((stats) =>
          Effect.uninterruptible(
            store.heartbeat(member.url, member.type, member.name, {
              qemus,
              memory: { totalBytes: stats.memory.totalBytes, usedBytes: stats.memory.usedBytes },
              cpu: { mean1m: stats.cpu.mean1m, mean2m: stats.cpu.mean2m, mean3m: stats.cpu.mean3m },
            }),
          ),
        ),
        Effect.catchCause(failed("heartbeat failed")),
      );
    const writeProcess = (jobs: number) =>
      usage.collect.pipe(
        Effect.flatMap((sample) =>
          Effect.uninterruptible(
            processStore.report(member.name, member.type, {
              jobs,
              memoryBytes: sample.memoryBytes,
              cpuPercent: sample.cpuPercent,
            }),
          ),
        ),
        Effect.catchCause(failed("process stats failed")),
      );
    const onJoin = member.onJoin;
    const joined = yield* Ref.make(onJoin === undefined);
    const join =
      onJoin === undefined
        ? Effect.void
        : Effect.gen(function* () {
            if (yield* Ref.get(joined)) {
              return;
            }
            yield* onJoin;
            yield* Ref.set(joined, true);
          }).pipe(Effect.catchCause(failed("join failed")));
    // join and both writes log their own failures, so what reaches the last catch is the report's.
    const tick = Effect.gen(function* () {
      yield* join;
      const counts = yield* member.report;
      yield* writeServers(counts.qemus);
      yield* writeProcess(counts.jobs);
    }).pipe(Effect.catchCause(failed("report failed")));
    const leave =
      member.onLeave === undefined
        ? Effect.void
        : member.onLeave.pipe(Effect.catchCause(failed("leave failed")));
    // Before the loop: close interrupts the fiber first, then this runs.
    yield* Effect.addFinalizer(() =>
      leave.pipe(
        Effect.andThen(store.removeServer(member.url)),
        Effect.catchCause(failed("unannounce failed")),
        Effect.asVoid,
      ),
    );
    yield* tick.pipe(
      Effect.repeat(Schedule.spaced(HEARTBEAT_INTERVAL)),
      Effect.forkScoped({ startImmediately: true }),
    );
  });
