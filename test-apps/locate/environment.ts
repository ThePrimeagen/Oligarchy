import * as Env from "@oligarchy/env";
import * as Cloudflare from "../shared/cloudflare.ts";

export const environment = Env.cli({
  name: "locate",
  description:
    "Ask Clef where to click on screenshots and save every zoom round: what each round sent, what Clef answered, the final point and a sheet of it all. Give --target or --question. The search is oligarchy.json's locator section, each flag given overriding its field for this run. Exits 1 when a Clef call failed",
  sources: Cloudflare.sources,
})
  .flags({
    images: Env.args.screenshots(),
    target: Env.args.target(false),
    question: Env.args.question(false),
    task: Env.args.task(false),
    grid: Env.args.grid(false),
    rounds: Env.args.rounds(false),
    threshold: Env.args.threshold(false),
    power: Env.args.power(false),
    boxScale: Env.args.boxScale(false),
    model: Env.args.decisionModel(false),
    out: Env.args.out(false),
  })
  .needs("cloudflareAccountId", "cloudflareApiToken")
  .done();

export type Run = NonNullable<(typeof environment)["runs"]>;
