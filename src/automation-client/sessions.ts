import {
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Schedule,
  Semaphore,
} from "effect";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as Cli from "../cli.ts";
import * as HarnessConfig from "../harness/config.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import type * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";
import * as Driver from "./driver.ts";
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
  resume?: string,
  server?: string,
) => Effect.Effect<void, Errors.AtCapacity | Errors.SetupNeeded | Errors.Internal>;

export type RelinquishQemu = (agent: string) => Effect.Effect<void, Errors.Internal>;

// What a ticket holds before its run: what it was reserved as, so an expired drive gives its
// guest slot back and the same reserve again is told from another, and since when.
type Reservation = {
  readonly action: Domain.AutomationAction;
  readonly resume: string | undefined;
  readonly server: string | undefined;
  readonly since: number;
};

const make = (maxJobs: number, reserveQemu: ReserveQemu, relinquishQemu: RelinquishQemu) =>
  Effect.gen(function* () {
    const running = yield* Ref.make<ReadonlyMap<string, ChildProcessSpawner.ChildProcessHandle>>(
      new Map(),
    );
    // The abort under way for a running ticket, done with whether its kill signalled the driver.
    // A run whose child exits meanwhile waits for it: only a child the kill reached is
    // RunAborted, and one that had exited on its own ends as it did.
    const aborts = yield* Ref.make<ReadonlyMap<string, Deferred.Deferred<boolean>>>(new Map());
    // How many runs are admitted against --max-jobs, and which tickets already hold a slot
    // that run will consume. `running` cannot count them: a run is only in it once the driver
    // has spawned, and the slot must be taken before that, so a refused run spawns nothing.
    const slots = yield* Ref.make<{
      readonly count: number;
      readonly reserved: ReadonlyMap<string, Reservation>;
    }>({ count: 0, reserved: new Map() });
    // Set for the whole of shutdown, before any stop, so a reserve that arrives while the
    // drivers are being killed is refused instead of starting another one.
    const halting = yield* Ref.make(false);
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const log = yield* Log.Log;

    const shuttingDown = (ticket: string): Errors.AtCapacity =>
      Errors.AtCapacity.make({ message: "shutting down", agentId: ticket });

    const atCapacity = (ticket: string): Errors.AtCapacity =>
      Errors.AtCapacity.make({
        message: `at capacity: max-jobs is ${String(maxJobs)}`,
        agentId: ticket,
      });

    // Held for the whole /reserve, including the QEMU call. A second /reserve on this
    // server while that one has not answered is refused, not queued behind it.
    const reserveGate = yield* Semaphore.make(1);

    const reserve = Effect.fn("Sessions.reserve")(function* (
      ticket: string,
      action: Domain.AutomationAction,
      resume?: string,
      server?: string,
    ) {
      const ran = yield* reserveGate.withPermitsIfAvailable(1)(
        Effect.gen(function* () {
          if (yield* Ref.get(halting)) {
            return yield* shuttingDown(ticket);
          }
          // The same reserve again, action, iso and pin alike, is the one this ticket already
          // holds: a dispatcher that died before its running write asks again once restarted.
          // It keeps its first deadline, since a drive's guest slot expires on the qemu
          // server's clock, not this one's.
          const held = (yield* Ref.get(slots)).reserved.get(ticket);
          if (held?.action === action && held.resume === resume && held.server === server) {
            return yield* Effect.void;
          }
          if (held !== undefined) {
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
          // A mint installs fresh on the server its lock named, and does not resume. Only a
          // drive names the iso whose disk the slot must boot. The pin is that server.
          if (action === "drive" || action === "mint") {
            yield* reserveQemu(ticket, action === "drive" ? resume : undefined, server);
          }
          // The guest was taken before shutdown was noticed. Give it back rather than hold a
          // slot this process is leaving. A miss is a line; the reserve is still refused.
          if (yield* Ref.get(halting)) {
            if (action === "drive" || action === "mint") {
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
            return yield* shuttingDown(ticket);
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
                reserved: mapWith(current.reserved, ticket, { action, resume, server, since }),
              },
            ] as const;
          });
          if (!admitted) {
            if (action === "drive" || action === "mint") {
              yield* relinquishQemu(ticket);
            }
            return yield* atCapacity(ticket);
          }
          return yield* Effect.void;
        }),
      );
      if (Option.isNone(ran)) {
        return yield* Errors.AtCapacity.make({
          message: "a reserve is already in flight",
          agentId: ticket,
        });
      }
      return yield* Effect.void;
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
        if (reservation.action === "drive" || reservation.action === "mint") {
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

    const run = Effect.fn("Sessions.run")(function* (ticket: string, prompt: string) {
      // Read before consume: the reservation is what says drive, diagnose, or mint,
      // and consume removes it. A missing one fails in consume and spawns nothing.
      // A diagnose still runs under OpenCode. A drive or mint is the harness.
      // The model is oligarchy.json's for that action. This process does not take one.
      const action = (yield* Ref.get(slots)).reserved.get(ticket)?.action ?? "drive";
      const diagnose = action === "diagnose";
      const bin = diagnose ? OpenCode.BIN : Driver.BIN;
      const env = diagnose ? OpenCode.ENV : {};
      const ceiling = diagnose ? OpenCode.CEILING : Driver.CEILING;
      const exceeded = diagnose
        ? `opencode run exceeded ${OpenCode.CEILING}`
        : `driver exceeded ${Driver.CEILING}`;
      return yield* Effect.scoped(
        Effect.gen(function* () {
          // The reservation is the run's first resource: consumed and its release registered
          // in one uninterruptible step, so the slot is given back however the run ends, and
          // last, after the child is reaped and the ticket forgotten.
          yield* Effect.acquireRelease(consume(ticket), () =>
            Ref.update(slots, (held) => ({ ...held, count: held.count - 1 })),
          );
          const args = diagnose
            ? OpenCode.args(
                prompt,
                (yield* HarnessConfig.load.pipe(
                  Effect.mapError((error) =>
                    Errors.RunFailed.make({ message: error.message, cause: error }),
                  ),
                )).models.diagnose,
              )
            : Driver.args({
                prompt,
                agentId: ticket,
                action: action === "mint" ? "mint" : "drive",
              });
          const handle = yield* Cli.spawn(bin, args, env);
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
            ).pipe(Effect.andThen(Ref.update(aborts, (map) => mapWithout(map, ticket)))),
          );
          const exit = yield* Effect.exit(Cli.awaitExit(bin, handle));
          const stopping = (yield* Ref.get(aborts)).get(ticket);
          if (stopping !== undefined && (yield* Deferred.await(stopping))) {
            return yield* Errors.RunAborted.make({ agentId: ticket });
          }
          return yield* exit;
        }),
      ).pipe(
        Effect.catchTag("CliFailed", (error) =>
          Errors.RunFailed.make({ message: error.message, cause: error }),
        ),
        // Leaving the scope kills the child and gives the slot back before the failure is raised.
        Effect.timeoutOrElse({
          duration: ceiling,
          orElse: () => Errors.RunFailed.make({ message: exceeded }),
        }),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
    });

    const abort = Effect.fn("Sessions.abort")(function* (ticket: string) {
      const handle = (yield* Ref.get(running)).get(ticket);
      if (handle === undefined) {
        // A reserve nobody has run still holds a slot, and a drive's guest slot with it.
        // Abort is how the dispatcher gives both back when the pending row was closed
        // under it. A ticket that holds neither is unknown, as it always was.
        const reservation = yield* Ref.modify(slots, (held) => {
          const reserved = held.reserved.get(ticket);
          if (reserved === undefined) {
            return [undefined, held] as const;
          }
          return [
            reserved,
            { count: held.count - 1, reserved: mapWithout(held.reserved, ticket) },
          ] as const;
        });
        if (reservation === undefined) {
          return yield* Errors.unknownSession(ticket, ticket);
        }
        if (reservation.action === "drive" || reservation.action === "mint") {
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
        return yield* Effect.void;
      }
      // Registered before the kill, so the run sees its child end only once it is there.
      const signalled = yield* Deferred.make<boolean>();
      return yield* Ref.update(aborts, (map) => mapWith(map, ticket, signalled)).pipe(
        Effect.andThen(
          handle.kill({
            killSignal: "SIGTERM",
            forceKillAfter: Cli.FORCE_KILL_AFTER,
          }),
        ),
        Effect.as(true),
        Effect.catch((error) =>
          // A child already gone cannot be killed. isRunning can itself fail; treat that as
          // still running so a probe failure does not look like a successful abort.
          Effect.flatMap(handle.isRunning.pipe(Effect.orElseSucceed(() => true)), (alive) =>
            alive
              ? Errors.RunFailed.make({ message: error.message, cause: error })
              : Effect.succeed(false),
          ),
        ),
        Effect.onExit((exit) => Deferred.succeed(signalled, Exit.isSuccess(exit) && exit.value)),
        Effect.asVoid,
      );
    });

    // The automation server is what usually stops a run, by POST /abort. This process can be
    // asked to stop after that server is already gone. A /run handler will not notice: it stays
    // up so a dropped connection does not kill the driver, and the driver keeps waiting on its
    // next response. Shutdown stops every run itself. One that cannot be killed is a line; the
    // others still stop.
    const shutdown = Effect.fn("Sessions.shutdown")(function* () {
      yield* Ref.set(halting, true);
      // Twice: a run that passed the stopping check and spawned while the first pass was
      // killing the others is in the map for the second. A ticket already gone is not an error.
      // One that could not be killed is not asked again.
      const failed = new Set<string>();
      for (let pass = 0; pass < 2; pass++) {
        const tickets: Array<string> = [];
        const seen = new Set<string>();
        for (const ticket of [
          ...(yield* Ref.get(running)).keys(),
          ...(yield* Ref.get(slots)).reserved.keys(),
        ]) {
          if (seen.has(ticket) || failed.has(ticket)) {
            continue;
          }
          seen.add(ticket);
          tickets.push(ticket);
        }
        yield* Effect.forEach(
          tickets,
          (ticket) =>
            abort(ticket).pipe(
              Effect.catch((error) => {
                if (error._tag === "UnknownSession") {
                  return Effect.void;
                }
                failed.add(ticket);
                return log.error(`shutdown stop failed: ${Render.headline(error)}`, {
                  location: Log.Locations.automationClient,
                  agentId: ticket,
                  cause: error,
                });
              }),
            ),
          { concurrency: "unbounded", discard: true },
        );
        yield* Effect.yieldNow;
      }
    });

    return {
      reserve,
      run,
      abort,
      shutdown,
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
