import * as Env from "@oligarchy/env";
import * as Cloudflare from "../shared/cloudflare.ts";

export const environment = Env.cli({
  name: "decision-smoke",
  description:
    "Make one live Clef decision and print it, to see that the account, the token and decision-api work",
  sources: Cloudflare.sources,
})
  .flags({ model: Env.args.decisionModel(false) })
  .needs("cloudflareAccountId", "cloudflareApiToken")
  .done();

export type Run = NonNullable<(typeof environment)["runs"]>;
