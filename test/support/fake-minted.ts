import { Effect, Layer, Option } from "effect";
import type * as ApiErrors from "@oligarchy/routes/errors";
import type * as Iso from "../../src/qemu/iso.ts";
import * as Minted from "../../src/qemu/minted.ts";

export type Save = {
  readonly iso: string;
  readonly from: Minted.MintedDisk;
  readonly who: Iso.Who;
};

export type Script = {
  // Scripts the save's failure; a save that is not scripted succeeds.
  readonly save?: (save: Save) => Effect.Effect<void, ApiErrors.SaveFailed>;
  // What this machine holds for an iso; nothing is minted unless scripted. An Effect lets a test
  // hold the lookup open.
  readonly find?: (
    iso: string,
  ) => Option.Option<Minted.MintedDisk> | Effect.Effect<Option.Option<Minted.MintedDisk>>;
};

export type FakeMinted = {
  readonly saves: Array<Save>;
  readonly finds: Array<string>;
  readonly layer: Layer.Layer<Minted.Minted>;
};

// A Minted that records every save and lookup and keeps nothing on disk.
export const fakeMinted = (script: Script = {}): FakeMinted => {
  const saves: Array<Save> = [];
  const finds: Array<string> = [];
  const service = Minted.Minted.of({
    find: (iso) =>
      Effect.suspend(() => {
        finds.push(iso);
        const found = script.find?.(iso) ?? Option.none();
        return Effect.isEffect(found) ? found : Effect.succeed(found);
      }),
    save: (iso, from, who) =>
      Effect.suspend(() => {
        const save = { iso, from, who };
        saves.push(save);
        return script.save?.(save) ?? Effect.void;
      }),
  });
  return { saves, finds, layer: Layer.succeed(Minted.Minted)(service) };
};
