import { Context, Effect, Layer, Ref } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as Cli from "../cli.ts";
import * as Errors from "../shared/errors.ts";
import * as OpenCode from "./opencode.ts";

export const MaxJobs = Context.Reference<number>("@oligarchy/automation-client/sessions/MaxJobs", {
  defaultValue: () => 1,
});

const mapWith = <V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> =>
  new Map([...map, [key, value]]);

const mapWithout = <V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> => {
  const next = new Map(map);
  next.delete(key);
  return next;
};

const make = Effect.gen(function* () {
  const running = yield* Ref.make<ReadonlyMap<string, ChildProcessSpawner.ChildProcessHandle>>(
    new Map(),
  );
  const jobs = yield* Ref.make(0);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const maxJobs = yield* MaxJobs;

  const run = Effect.fn("Sessions.run")(function* (ticket: string, prompt: string) {
    const reserved = yield* Ref.modify(jobs, (n) =>
      n >= maxJobs ? ([false, n] as const) : ([true, n + 1] as const),
    );
    if (!reserved) {
      return yield* Errors.AtCapacity.make({});
    }
    return yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Ref.update(jobs, (n) => n - 1));
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
      Effect.mapError((error) => Errors.RunFailed.make({ message: error.message, cause: error })),
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
          // A child already gone cannot be killed. isRunning can itself fail; treat that as still
          // running so a probe failure does not look like a successful abort.
          Effect.flatMap(handle.isRunning.pipe(Effect.orElseSucceed(() => true)), (alive) =>
            alive ? Errors.RunFailed.make({ message: error.message, cause: error }) : Effect.void,
          ),
        ),
      );
  });

  return { run, abort, jobs: Ref.get(jobs) };
});

export class Sessions extends Context.Service<Sessions>()("@oligarchy/automation-client/Sessions", {
  make,
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
