import { Cause, Clock, Context, Effect, Layer, Ref, Schedule, Semaphore } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as Cli from "../cli.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import type * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";
import * as OpenCode from "./opencode.ts";

// A reservation is a promise that a run follows at once; the dispatcher POSTs /run right after
// /reserve answers. One nobody runs (the dispatcher died in between) would hold a slot, and a
// drive's guest slot with it, until this process restarted. Ten minutes unused and it is given
// back, as a guest with no command is. In memory only: nothing durable records a reservation,
// so a restart starts clean and a restarted dispatcher can place the job anew.
const RESERVATION_TIMEOUT = "10 minutes";
const RESERVATION_TIMEOUT_MS = 10 * 60 * 1000;
const RESERVATION_SWEEP = "10 seconds";

const mapWith = <V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> =>
  new Map([...map, [key, value]]);

const mapWithout = <V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> => {
  const next = new Map(map);
  next.delete(key);
  return next;
};

export type ReserveQemu = (
  agent: string,
) => Effect.Effect<void, Errors.AtCapacity | Errors.Internal>;

export type RelinquishQemu = (agent: string) => Effect.Effect<void, Errors.Internal>;

// What a ticket holds before its run: which kind, so an expired drive gives its guest slot back,
// and since when.
type Reservation = {
  readonly action: Domain.AutomationAction;
  readonly since: number;
};

const make = (maxJobs: number, reserveQemu: ReserveQemu, relinquishQemu: RelinquishQemu) =>
  Effect.gen(function* () {
    const running = yield* Ref.make<ReadonlyMap<string, ChildProcessSpawner.ChildProcessHandle>>(
      new Map(),
    );
    // How many runs are admitted against --max-jobs, and which tickets already hold a slot
    // that run will consume. `running` cannot count them: a run is only in it once OpenCode
    // has spawned, and the slot must be taken before that, so a refused run spawns nothing.
    const slots = yield* Ref.make<{
      readonly count: number;
      readonly reserved: ReadonlyMap<string, Reservation>;
    }>({ count: 0, reserved: new Map() });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const log = yield* Log.Log;

    const atCapacity = (ticket: string): Errors.AtCapacity =>
      Errors.AtCapacity.make({
        message: `at capacity: max-jobs is ${String(maxJobs)}`,
        agentId: ticket,
      });

    // One reserve at a time: two tickets must not both reserve QEMU when only one local
    // slot remains.
    const reserveGate = yield* Semaphore.make(1);

    const reserve = Effect.fn("Sessions.reserve")(function* (
      ticket: string,
      action: Domain.AutomationAction,
    ) {
      return yield* reserveGate.withPermits(1)(
        Effect.gen(function* () {
          const held = yield* Ref.get(slots);
          if (held.reserved.has(ticket)) {
            return yield* Errors.BadRequest.make({
              message: "already reserved",
              agentId: ticket,
            });
          }
          // A drive boots a guest, so QEMU first: this client cannot hold a slot until the
          // guest host has one, and a full client still asks, then gives that slot back rather
          // than leak it. A diagnose reads the session back and boots nothing: a guest slot it
          // took would never be consumed by a start, nor given back, and would be gone for as
          // long as that qemu server lived.
          if (action === "drive") {
            yield* reserveQemu(ticket);
          }
          const since = yield* Clock.currentTimeMillis;
          const admitted = yield* Ref.modify(slots, (current) => {
            if (current.count >= maxJobs) {
              return [false, current] as const;
            }
            return [
              true,
              {
                count: current.count + 1,
                reserved: mapWith(current.reserved, ticket, { action, since }),
              },
            ] as const;
          });
          if (!admitted) {
            if (action === "drive") {
              yield* relinquishQemu(ticket);
            }
            return yield* atCapacity(ticket);
          }
          return yield* Effect.void;
        }),
      );
    });

    const consume = (ticket: string): Effect.Effect<void, Errors.BadRequest> =>
      Effect.flatMap(
        Ref.modify(slots, (held) =>
          held.reserved.has(ticket)
            ? ([true, { count: held.count, reserved: mapWithout(held.reserved, ticket) }] as const)
            : ([false, held] as const),
        ),
        (held) =>
          held
            ? Effect.void
            : Errors.BadRequest.make({ message: "no reservation", agentId: ticket }),
      );

    // Every reservation past the deadline leaves the reserved set and gives its slot back in one
    // step, so a run arriving late is refused rather than admitted twice; then a drive's guest
    // slot is given back, each failure its own line so the others still go.
    const expire = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const expired = yield* Ref.modify(slots, (held) => {
        const gone: Array<[string, Reservation]> = [];
        const kept = new Map<string, Reservation>();
        for (const [ticket, reservation] of held.reserved) {
          if (now - reservation.since >= RESERVATION_TIMEOUT_MS) {
            gone.push([ticket, reservation]);
          } else {
            kept.set(ticket, reservation);
          }
        }
        return [gone, { count: held.count - gone.length, reserved: kept }] as const;
      });
      for (const [ticket, reservation] of expired) {
        yield* log.warning(`reservation expired; unused for ${RESERVATION_TIMEOUT}`, {
          location: Log.Locations.automationClient,
          agentId: ticket,
        });
        if (reservation.action === "drive") {
          yield* relinquishQemu(ticket).pipe(
            Effect.catch((error) =>
              log.error(`relinquish failed: ${Render.headline(error)}`, {
                location: Log.Locations.automationClient,
                agentId: ticket,
                cause: error,
              }),
            ),
          );
        }
      }
    });
    yield* expire.pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        return log.error(`reservation sweep failed: ${Render.errorDetail(error)}`, {
          location: Log.Locations.automationClient,
          cause: error,
        });
      }),
      Effect.repeat(Schedule.spaced(RESERVATION_SWEEP)),
      Effect.forkScoped,
    );

    const run = Effect.fn("Sessions.run")(function* (
      ticket: string,
      prompt: string,
      model: string,
    ) {
      return yield* Effect.scoped(
        Effect.gen(function* () {
          // The reservation is the run's first resource: consumed and its release registered
          // in one uninterruptible step, so the slot is given back however the run ends, and
          // last, after the child is reaped and the ticket forgotten.
          yield* Effect.acquireRelease(consume(ticket), () =>
            Ref.update(slots, (held) => ({ ...held, count: held.count - 1 })),
          );
          const handle = yield* Cli.spawn(OpenCode.BIN, OpenCode.args(prompt, model), OpenCode.ENV);
          const claimed = yield* Ref.modify(running, (map) =>
            map.has(ticket)
              ? ([false, map] as const)
              : ([true, mapWith(map, ticket, handle)] as const),
          );
          if (!claimed) {
            return yield* Effect.die(`ticket "${ticket}" is already running`);
          }
          yield* Effect.addFinalizer(() =>
            Ref.update(running, (map) =>
              map.get(ticket) === handle ? mapWithout(map, ticket) : map,
            ),
          );
          return yield* Cli.awaitExit(OpenCode.BIN, handle);
        }),
      ).pipe(
        Effect.catchTag("CliFailed", (error) =>
          Errors.RunFailed.make({ message: error.message, cause: error }),
        ),
        // Leaving the scope kills the child and gives the slot back before the failure is raised.
        Effect.timeoutOrElse({
          duration: OpenCode.CEILING,
          orElse: () =>
            Errors.RunFailed.make({ message: `opencode run exceeded ${OpenCode.CEILING}` }),
        }),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
    });

    const abort = Effect.fn("Sessions.abort")(function* (ticket: string) {
      const handle = (yield* Ref.get(running)).get(ticket);
      if (handle === undefined) {
        return yield* Errors.unknownSession(ticket, ticket);
      }
      return yield* handle
        .kill({
          killSignal: "SIGTERM",
          forceKillAfter: Cli.FORCE_KILL_AFTER,
        })
        .pipe(
          Effect.catch((error) =>
            // A child already gone cannot be killed. isRunning can itself fail; treat that as
            // still running so a probe failure does not look like a successful abort.
            Effect.flatMap(handle.isRunning.pipe(Effect.orElseSucceed(() => true)), (alive) =>
              alive ? Errors.RunFailed.make({ message: error.message, cause: error }) : Effect.void,
            ),
          ),
        );
    });

    return {
      reserve,
      run,
      abort,
      // How many runs this process currently holds against --max-jobs: reserved plus running.
      jobs: Effect.map(Ref.get(slots), (held) => held.count),
    };
  });

export class Sessions extends Context.Service<Sessions>()("@oligarchy/automation-client/Sessions", {
  make,
}) {
  static readonly layer = (
    maxJobs: number,
    reserveQemu: ReserveQemu,
    relinquishQemu: RelinquishQemu,
  ): Layer.Layer<Sessions, never, ChildProcessSpawner.ChildProcessSpawner | Log.Log> =>
    Layer.effect(this)(this.make(maxJobs, reserveQemu, relinquishQemu));
}
