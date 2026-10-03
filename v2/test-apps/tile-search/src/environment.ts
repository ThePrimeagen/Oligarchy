import * as Env from "@oligarchy/env";
import * as jarl from "jarl";

// V2's sources, with CF_ACC and CF_TOKEN standing in for CLOUDFLARE_ACCOUNT_ID and
// CLOUDFLARE_API_TOKEN where only those are set.
const sources: ReadonlyArray<Env.Source> = Env.source.defaults.map((source): Env.Source => ({
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

export const environment = Env.cli({
  name: "tile-search",
  description: [
    "Point at screenshots and ask where to click: each round grids the picture, asks Clef one question per cell, and zooms in on the answer.",
    "Every step is printed and saved: each round's box, rule, best cells, point and the whole grid of probabilities, the picture Clef was sent and the same picture with its answer drawn on, the final click and a close-up of it, and a sheet per image.",
    "--model clef,clef-flash compares models and --runs repeats every search; report.md then adds how often each answer repeated and the timing quantiles.",
    "Give --target or --question. The search is oligarchy.json's locator section, each search flag given overriding its field for this run. Exits 1 when a Clef call failed.",
  ].join("\n"),
  sources,
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
    model: Env.args.decisionModels(false),
    runs: Env.args.runs(false),
    out: Env.args.out(false),
  })
  .needs("cloudflareAccountId", "cloudflareApiToken")
  .done();

export type Run = NonNullable<(typeof environment)["runs"]>;
