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

type Entry = ChildProcessSpawner.ChildProcessHandle | "starting";

const make = Effect.gen(function* () {
  const running = yield* Ref.make<ReadonlyMap<string, Entry>>(new Map());
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const maxJobs = yield* MaxJobs;

  const run = Effect.fn("Sessions.run")(function* (ticket: string, prompt: string) {
    const reserved = yield* Ref.modify(running, (map) => {
      if (map.has(ticket)) {
        return ["duplicate", map] as const;
      }
      if (map.size >= maxJobs) {
        return ["full", map] as const;
      }
      return ["ok", mapWith(map, ticket, "starting")] as const;
    });
    if (reserved === "full") {
      return yield* Errors.AtCapacity.make({});
    }
    if (reserved === "duplicate") {
      return yield* Effect.die(`ticket "${ticket}" is already running`);
    }
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* Cli.spawn(OpenCode.BIN, OpenCode.args(prompt));
        const claimed = yield* Ref.modify(running, (map) =>
          map.get(ticket) === "starting"
            ? ([true, mapWith(map, ticket, handle)] as const)
            : ([false, map] as const),
        );
        if (!claimed) {
          // Aborted while starting; the slot is already gone.
          yield* handle
            .kill({
              killSignal: "SIGTERM",
              forceKillAfter: Cli.FORCE_KILL_AFTER,
            })
            .pipe(Effect.orElseSucceed(() => undefined));
          return yield* Effect.void;
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
      // A spawn that failed still holds "starting"; drop it so the slot can be reused.
      Effect.ensuring(
        Ref.update(running, (map) =>
          map.get(ticket) === "starting" ? mapWithout(map, ticket) : map,
        ),
      ),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
  });

  const abort = Effect.fn("Sessions.abort")(function* (ticket: string) {
    const entry = (yield* Ref.get(running)).get(ticket);
    if (entry === undefined) {
      return yield* Errors.unknownSession(ticket, ticket);
    }
    if (entry === "starting") {
      yield* Ref.update(running, (map) =>
        map.get(ticket) === "starting" ? mapWithout(map, ticket) : map,
      );
      return yield* Effect.void;
    }
    const handle = entry;
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

  const jobs = Effect.map(Ref.get(running), (map) => map.size);

  return { run, abort, jobs };
});

export class Sessions extends Context.Service<Sessions>()("@oligarchy/automation-client/Sessions", {
  make,
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
