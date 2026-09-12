import { Context, Effect, Layer, Ref } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as Cli from "../cli.ts";
import * as Errors from "../shared/errors.ts";
import * as OpenCode from "./opencode.ts";

const mapWith = <V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> =>
  new Map([...map, [key, value]]);

const mapWithout = <V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> => {
  const next = new Map(map);
  next.delete(key);
  return next;
};

const withItem = <T>(set: ReadonlySet<T>, item: T): ReadonlySet<T> => new Set([...set, item]);

const without = <T>(set: ReadonlySet<T>, item: T): ReadonlySet<T> => {
  const next = new Set(set);
  next.delete(item);
  return next;
};

const make = (maxJobs: number) =>
  Effect.gen(function* () {
    const running = yield* Ref.make<ReadonlyMap<string, ChildProcessSpawner.ChildProcessHandle>>(
      new Map(),
    );
    // How many runs are admitted against --max-jobs, and which tickets already hold a slot
    // that run will consume. `running` cannot count them: a run is only in it once OpenCode
    // has spawned, and the slot must be taken before that, so a refused run spawns nothing.
    const slots = yield* Ref.make<{
      readonly count: number;
      readonly reserved: ReadonlySet<string>;
    }>({ count: 0, reserved: new Set() });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const atCapacity = (ticket: string): Errors.AtCapacity =>
      Errors.AtCapacity.make({
        message: `at capacity: max-jobs is ${String(maxJobs)}`,
        agentId: ticket,
      });

    const reserve = Effect.fn("Sessions.reserve")(function* (ticket: string) {
      const admitted = yield* Ref.modify(slots, (held) => {
        if (held.reserved.has(ticket)) {
          return [true, held] as const;
        }
        if (held.count >= maxJobs) {
          return [false, held] as const;
        }
        return [
          true,
          { count: held.count + 1, reserved: withItem(held.reserved, ticket) },
        ] as const;
      });
      if (!admitted) {
        return yield* atCapacity(ticket);
      }
    });

    const admit = (ticket: string): Effect.Effect<void, Errors.AtCapacity> =>
      Effect.flatMap(
        Ref.modify(slots, (held) => {
          if (held.reserved.has(ticket)) {
            return [true, { count: held.count, reserved: without(held.reserved, ticket) }] as const;
          }
          if (held.count >= maxJobs) {
            return [false, held] as const;
          }
          return [true, { count: held.count + 1, reserved: held.reserved }] as const;
        }),
        (admitted) => (admitted ? Effect.void : atCapacity(ticket)),
      );

    const run = Effect.fn("Sessions.run")(function* (ticket: string, prompt: string) {
      return yield* Effect.scoped(
        Effect.gen(function* () {
          // The slot is the run's first resource: taken (or consumed from reserve) and its
          // release registered in one uninterruptible step, so it is given back however the
          // run ends, and last, after the child is reaped and the ticket forgotten.
          yield* Effect.acquireRelease(admit(ticket), () =>
            Ref.update(slots, (held) => ({ ...held, count: held.count - 1 })),
          );
          const handle = yield* Cli.spawn(OpenCode.BIN, OpenCode.args(prompt));
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

    return { reserve, run, abort };
  });

export class Sessions extends Context.Service<Sessions>()("@oligarchy/automation-client/Sessions", {
  make,
}) {
  static readonly layer = (
    maxJobs: number,
  ): Layer.Layer<Sessions, never, ChildProcessSpawner.ChildProcessSpawner> =>
    Layer.effect(this)(this.make(maxJobs));
}
