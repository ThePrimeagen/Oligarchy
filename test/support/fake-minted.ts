import { Effect, Layer } from "effect";
import type * as Iso from "../../src/qemu/iso.ts";
import * as Minted from "../../src/qemu/minted.ts";
import type * as Errors from "../../src/shared/errors.ts";

export type Save = {
  readonly iso: string;
  readonly from: Minted.MintedDisk;
  readonly who: Iso.Who;
};

export type Script = {
  // Scripts the save's failure; a save that is not scripted succeeds.
  readonly save?: (save: Save) => Effect.Effect<void, Errors.SaveFailed>;
};

export type FakeMinted = {
  readonly saves: Array<Save>;
  readonly layer: Layer.Layer<Minted.Minted>;
};

// A Minted that records every save and keeps nothing on disk.
export const fakeMinted = (script: Script = {}): FakeMinted => {
  const saves: Array<Save> = [];
  const service = Minted.Minted.of({
    save: (iso, from, who) =>
      Effect.suspend(() => {
        const save = { iso, from, who };
        saves.push(save);
        return script.save?.(save) ?? Effect.void;
      }),
  });
  return { saves, layer: Layer.succeed(Minted.Minted)(service) };
};
