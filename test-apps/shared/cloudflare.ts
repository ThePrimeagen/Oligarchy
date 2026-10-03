import * as Env from "@oligarchy/env";
import * as jarl from "jarl";

// V2's sources, with CF_ACC and CF_TOKEN standing in for CLOUDFLARE_ACCOUNT_ID and
// CLOUDFLARE_API_TOKEN where only those are set.
export const sources: ReadonlyArray<Env.Source> = Env.source.defaults.map((source): Env.Source => ({
  ...source,
  load: async (io, flags) => {
    const loaded = await source.load(io, flags);
    if (jarl.is_err(loaded)) {
      return loaded;
    }
    const vars = jarl.value(loaded);
    return jarl.ok({
      ...vars,
      CLOUDFLARE_ACCOUNT_ID: vars.CLOUDFLARE_ACCOUNT_ID ?? vars.CF_ACC ?? "",
      CLOUDFLARE_API_TOKEN: vars.CLOUDFLARE_API_TOKEN ?? vars.CF_TOKEN ?? "",
    });
  },
}));
