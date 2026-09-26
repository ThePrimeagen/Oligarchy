import { Effect, Option } from "effect";
import * as Automation from "@oligarchy/db/automation";
import * as DbErrors from "@oligarchy/db/errors";
import * as ProcessStats from "@oligarchy/db/process-stats";
import * as Servers from "@oligarchy/db/servers";
import * as View from "./view.ts";

// A screen registers what it wants. `once` is read when viz opens and kept: a
// fact that does not move. `cycle` is read then and every refresh: status, and
// the latest tickets.
export type Mode = "once" | "cycle";

export type Need<A, E = DbErrors.DatabaseError, R = never> = {
  readonly mode: Mode;
  readonly read: Effect.Effect<A, E, R>;
};

export type Needs<M, S, Q, E, R> = {
  readonly machines: Need<M, E, R>;
  readonly series: Need<S, E, R>;
  readonly queue: Need<Q, E, R>;
};

export type Board<M, S, Q> = {
  readonly machines: M;
  readonly series: S;
  readonly queue: Q;
  readonly readAt: number;
};

export type Live = Board<
  ReadonlyArray<Servers.Machine>,
  ReadonlyArray<ProcessStats.Series>,
  Automation.AutomationQueue
>;

// Taken when there is no previous value, and again on a cycle-need. A once-need
// with a previous value is the value already kept.
export const pull = <A, E, R>(
  need: Need<A, E, R>,
  previous: Option.Option<A>,
): Effect.Effect<A, E, R> =>
  need.mode === "once" && Option.isSome(previous) ? Effect.succeed(previous.value) : need.read;

export const collect = <M, S, Q, E, R>(
  needs: Needs<M, S, Q, E, R>,
  previous: Option.Option<Board<M, S, Q>>,
  readAt: number,
): Effect.Effect<Board<M, S, Q>, E, R> =>
  Effect.gen(function* () {
    return {
      readAt,
      machines: yield* pull(
        needs.machines,
        Option.map(previous, (found) => found.machines),
      ),
      series: yield* pull(
        needs.series,
        Option.map(previous, (found) => found.series),
      ),
      queue: yield* pull(
        needs.queue,
        Option.map(previous, (found) => found.queue),
      ),
    };
  });

// What this screen registers. Machines and their readings are status. The queue
// is the latest finished tickets, cut at `tickets`; running and pending are whole.
export const board = (tickets: number) =>
  Effect.gen(function* () {
    const servers = yield* Servers.ServerStore;
    const processStats = yield* ProcessStats.ProcessStatsStore;
    const automation = yield* Automation.AutomationStore;
    return {
      machines: { mode: "cycle" as const, read: servers.listMachines() },
      series: { mode: "cycle" as const, read: processStats.listSeries(View.SERIES_SAMPLES) },
      queue: { mode: "cycle" as const, read: automation.listJobs(tickets) },
    };
  });
