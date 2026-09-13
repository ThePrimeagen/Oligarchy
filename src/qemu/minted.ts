import { Context, Effect, FileSystem, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as Errors from "../shared/errors.ts";
import * as Iso from "./iso.ts";
import * as Process from "./process.ts";

// The minted disk of an iso is two files beside the iso's own path: the disk with Omarchy
// installed and the firmware copy carrying its boot entry. Present means minted; nothing else
// records it.
export type MintedDisk = { readonly disk: string; readonly vars: string };

export const filesFor = (isoPath: string): MintedDisk => ({
  disk: `${isoPath}.qcow2`,
  vars: `${isoPath}.OVMF_VARS.fd`,
});

export type MintedService = {
  // Keeps a session's disk and firmware copy as the iso's minted disk, over whatever is there.
  readonly save: (
    iso: string,
    from: MintedDisk,
    who: Iso.Who,
  ) => Effect.Effect<void, Errors.SaveFailed>;
};

const make: Effect.Effect<
  MintedService,
  never,
  Iso.Iso | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const isos = yield* Iso.Iso;
  const fs = yield* FileSystem.FileSystem;
  const host = yield* Iso.Host;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const withSpawner = Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner);

  // Written beside the target with this process's pid, as the iso cache writes its downloads,
  // then renamed over the target: a file under the minted name is always a whole one.
  const into = <E>(target: string, write: (partial: string) => Effect.Effect<void, E>) => {
    const partial = `${target}.partial-${String(host.pid)}`;
    return write(partial).pipe(
      Effect.andThen(fs.rename(partial, target)),
      // Best effort: the failure being raised is what matters, not a stray partial.
      Effect.onError(() => Effect.ignore(fs.remove(partial, { force: true }))),
    );
  };

  const save = Effect.fn("Minted.save")(function* (iso: string, from: MintedDisk, who: Iso.Who) {
    const target = filesFor(yield* isos.pathOf(iso));
    // Firmware first, disk last: a disk in place always has its firmware beside it.
    yield* into(target.vars, (partial) => fs.copyFile(from.vars, partial)).pipe(
      Effect.andThen(
        into(target.disk, (partial) => withSpawner(Process.convert(from.disk, partial))),
      ),
      Effect.mapError((error) =>
        Errors.SaveFailed.make({
          message: Process.detail(error),
          cause: error,
          sessionId: who.sessionId,
          agentId: who.agentId,
        }),
      ),
    );
  });

  return { save } satisfies MintedService;
});

export class Minted extends Context.Service<Minted>()("@oligarchy/qemu/Minted", { make }) {
  static readonly layer: Layer.Layer<
    Minted,
    never,
    Iso.Iso | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
  > = Layer.effect(this)(this.make);
}
