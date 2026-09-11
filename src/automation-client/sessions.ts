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

const make = Effect.gen(function* () {
  const running = yield* Ref.make<ReadonlyMap<string, ChildProcessSpawner.ChildProcessHandle>>(
    new Map(),
  );
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const run = Effect.fn("Sessions.run")(function* (ticket: string, prompt: string) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* Cli.spawn(OpenCode.BIN, OpenCode.args(prompt));
        yield* Ref.update(running, (map) => mapWith(map, ticket, handle));
        yield* Effect.addFinalizer(() => Ref.update(running, (map) => mapWithout(map, ticket)));
        return yield* Cli.awaitExit(OpenCode.BIN, handle);
      }),
    ).pipe(
      Effect.mapError((error) => Errors.RunFailed.make({ message: error.message, cause: error })),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
  });

  const abort = Effect.fn("Sessions.abort")(function* (ticket: string) {
    const handle = yield* Ref.modify(running, (map) => {
      const found = map.get(ticket);
      return found === undefined ? [undefined, map] : [found, mapWithout(map, ticket)];
    });
    if (handle === undefined) {
      return yield* Errors.unknownSession(ticket, ticket);
    }
    // A child already gone cannot be killed.
    return yield* handle.kill().pipe(Effect.catch(() => Effect.void));
  });

  return { run, abort };
});

export class Sessions extends Context.Service<Sessions>()("@oligarchy/automation-client/Sessions", {
  make,
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
