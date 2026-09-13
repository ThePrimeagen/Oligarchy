import { Context, Effect, FileSystem, Layer, Option, Semaphore } from "effect";
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
  // The iso's minted disk on this machine: both files beside the iso's path, or none.
  readonly find: (iso: string) => Effect.Effect<Option.Option<MintedDisk>>;
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
  // Two sessions of one iso saving at once would write the same partial; one save at a time
  // keeps each disk whole and beside its own firmware.
  const oneAtATime = yield* Semaphore.make(1);

  // Written beside the target with this process's pid, as the iso cache writes its downloads;
  // `publish` renames over the target once both files are whole, so a failed copy or convert
  // leaves the pair already there untouched.
  const partialOf = (target: string) => `${target}.partial-${String(host.pid)}`;
  const discard = (partial: string) =>
    // Best effort: the failure being raised is what matters, not a stray partial.
    Effect.ignore(fs.remove(partial, { force: true }));

  // Presence is the whole record; a stat that fails for any reason is a file that is not there.
  const present = (file: string): Effect.Effect<boolean> =>
    fs.stat(file).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );

  const find = Effect.fn("Minted.find")(function* (iso: string) {
    const files = filesFor(yield* isos.pathOf(iso));
    return (yield* present(files.disk)) && (yield* present(files.vars))
      ? Option.some(files)
      : Option.none<MintedDisk>();
  });

  const save = Effect.fn("Minted.save")(function* (iso: string, from: MintedDisk, who: Iso.Who) {
    const target = filesFor(yield* isos.pathOf(iso));
    const vars = partialOf(target.vars);
    const disk = partialOf(target.disk);
    // Both staged, then both published, firmware first: a disk in place always has its own
    // firmware beside it, and a convert that fails replaces nothing.
    yield* oneAtATime
      .withPermits(1)(
        Effect.gen(function* () {
          yield* fs.copyFile(from.vars, vars).pipe(Effect.onError(() => discard(vars)));
          yield* withSpawner(Process.convert(from.disk, disk)).pipe(
            Effect.onError(() => Effect.andThen(discard(disk), discard(vars))),
          );
          yield* fs
            .rename(vars, target.vars)
            .pipe(Effect.onError(() => Effect.andThen(discard(vars), discard(disk))));
          yield* fs.rename(disk, target.disk).pipe(Effect.onError(() => discard(disk)));
        }),
      )
      .pipe(
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

  return { find, save } satisfies MintedService;
});

export class Minted extends Context.Service<Minted>()("@oligarchy/qemu/Minted", { make }) {
  static readonly layer: Layer.Layer<
    Minted,
    never,
    Iso.Iso | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
  > = Layer.effect(this)(this.make);
}
