// Run from the repository root, with one job or an array of jobs on stdin:
// bun --no-env-file v2/packages/locator/src/trace.ts < jobs.json
// A job is { "screen": "<png path>", "question": "<template naming {cell}>", "task": "<text>",
// "out": "<directory>" }. Each job's directory gets overview.webp (image 1 of every ask), per round
// round-<n>-in.webp (image 2, as Clef was sent it) and round-<n>-out.png (that picture with each
// cell's p, the weighted point and the box the next round looks at), final.png (the screenshot with
// every round's box and the point) and result.json. Rounds and the rest come from oligarchy.json.
import * as DecisionApi from "@oligarchy/decision-api";
import * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import type * as ScreenGrid from "@oligarchy/screen-grid";
import * as jarl from "jarl";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import * as Geometry from "./geometry.ts";
import * as Locator from "./main.ts";

type Job = {
  readonly screen: string;
  readonly question: string;
  readonly task: string;
  readonly out: string;
};

const COLOURS = ["#ff3b30", "#ff9500", "#34c759", "#00c7ff", "#af52de", "#ffffff"];

const crosshair = (x: number, y: number, colour: string, size: number): string =>
  `<circle cx="${x}" cy="${y}" r="${size}" fill="none" stroke="${colour}" stroke-width="3"/>` +
  `<line x1="${x - size * 1.6}" y1="${y}" x2="${x + size * 1.6}" y2="${y}" stroke="${colour}" stroke-width="2"/>` +
  `<line x1="${x}" y1="${y - size * 1.6}" x2="${x}" y2="${y + size * 1.6}" stroke="${colour}" stroke-width="2"/>`;

const rect = (box: ScreenGrid.Box, colour: string, width: number): string =>
  `<rect x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}" fill="none" stroke="${colour}" stroke-width="${width}"/>`;

const svg = (width: number, height: number, parts: ReadonlyArray<string>): Buffer =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`,
  );

// The round's grid picture with what Clef answered drawn over it: each cell tinted red by its p and
// labelled with it, the p^power weighted point, and the box the next round looks at.
const roundOut = async (round: Locator.Round, next: ScreenGrid.Box | null): Promise<Buffer> => {
  const { image, box } = round;
  const scale = (image.width - image.margin) / (box.right - box.left);
  const toPicture = (b: ScreenGrid.Box): ScreenGrid.Box => ({
    left: image.margin + (b.left - box.left) * scale,
    top: image.margin + (b.top - box.top) * scale,
    right: image.margin + (b.right - box.left) * scale,
    bottom: image.margin + (b.bottom - box.top) * scale,
  });
  const size = Math.max(14, Math.round(image.width / 40));
  const parts = round.cells.flatMap((cell) => {
    const b = toPicture(cell.box);
    const cx = (b.left + b.right) / 2;
    const cy = (b.top + b.bottom) / 2;
    const bestCell = cell.p === round.best;
    return [
      `<rect x="${b.left}" y="${b.top}" width="${b.right - b.left}" height="${b.bottom - b.top}" fill="#ff0000" fill-opacity="${(0.45 * cell.p).toFixed(3)}" stroke="${bestCell ? "#ffffff" : "none"}" stroke-width="3"/>`,
      `<text x="${cx}" y="${cy}" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${size}" fill="white" stroke="black" stroke-width="3" paint-order="stroke" text-anchor="middle" dominant-baseline="central">${cell.label} ${cell.p.toFixed(3)}</text>`,
    ];
  });
  if (next !== null) {
    parts.push(rect(toPicture(next), "#00c7ff", 3));
  }
  const point = toPicture({
    left: round.point.x,
    top: round.point.y,
    right: round.point.x,
    bottom: round.point.y,
  });
  parts.push(crosshair(point.left, point.top, "#ff3b30", Math.max(8, size * 0.6)));
  return sharp(image.bytes)
    .composite([{ input: svg(image.width, image.height, parts), top: 0, left: 0 }])
    .png()
    .toBuffer();
};

const finalOut = async (
  bytes: Uint8Array,
  rounds: ReadonlyArray<Locator.Round>,
  pixel: ScreenGrid.Point | null,
): Promise<Buffer> => {
  const { width, height } = await sharp(bytes).metadata();
  const parts = rounds.slice(1).map((round, k) => rect(round.box, COLOURS[k + 1] ?? "#fff", 3));
  if (pixel !== null) {
    parts.push(crosshair(pixel.x, pixel.y, "#ff3b30", 12));
  }
  return sharp(bytes)
    .composite([{ input: svg(width, height, parts), top: 0, left: 0 }])
    .png()
    .toBuffer();
};

const summary = (round: Locator.Round) => ({
  box: round.box,
  best: round.best,
  point: round.point,
  inputTokens: round.inputTokens,
  cells: Object.fromEntries(round.cells.map((cell) => [cell.label, Number(cell.p.toFixed(4))])),
});

const writeRounds = async (
  job: Job,
  bytes: Uint8Array,
  rounds: ReadonlyArray<Locator.Round>,
  options: Locator.Options,
) => {
  const { width, height } = await sharp(bytes).metadata();
  const screen = { width, height };
  for (const [k, round] of rounds.entries()) {
    const next =
      rounds[k + 1]?.box ??
      Geometry.nextBox(round.point, round.box, options.grid, options.boxScale, screen);
    await writeFile(join(job.out, `round-${k + 1}-in.webp`), round.image.bytes);
    await writeFile(
      join(job.out, `round-${k + 1}-out.png`),
      await roundOut(round, k + 1 < options.rounds ? next : null),
    );
  }
};

const traceOne = async (
  locator: ReturnType<typeof Locator.create>,
  options: Locator.Options,
  job: Job,
): Promise<string> => {
  await mkdir(job.out, { recursive: true });
  const bytes = new Uint8Array(await readFile(job.screen));
  const started = Date.now();
  const result = await locator.locate({ screen: bytes, question: job.question, task: job.task });
  const ms = Date.now() - started;
  const base = { screen: resolve(job.screen), question: job.question, task: job.task, ms };
  if (jarl.is_ok(result)) {
    const found = jarl.value(result);
    await writeFile(join(job.out, "overview.webp"), found.overview.bytes);
    await writeRounds(job, bytes, found.rounds, options);
    await writeFile(join(job.out, "final.png"), await finalOut(bytes, found.rounds, found.pixel));
    await writeFile(
      join(job.out, "result.json"),
      JSON.stringify(
        {
          ...base,
          found: { x: found.x, y: found.y, pixel: found.pixel },
          rounds: found.rounds.map(summary),
        },
        null,
        2,
      ),
    );
    return `found (${found.pixel.x.toFixed(1)}, ${found.pixel.y.toFixed(1)}) in ${ms} ms`;
  }
  // NotFound is the one failure that carries a round.
  const { error } = result;
  if ("round" in error) {
    await writeFile(join(job.out, "overview.webp"), error.overview.bytes);
    await writeRounds(job, bytes, [error.round], { ...options, rounds: 1 });
    await writeFile(join(job.out, "final.png"), await finalOut(bytes, [error.round], null));
    await writeFile(
      join(job.out, "result.json"),
      JSON.stringify(
        {
          ...base,
          notFound: { best: error.best, threshold: error.threshold },
          rounds: [summary(error.round)],
        },
        null,
        2,
      ),
    );
    return `not found: ${error.message}`;
  }
  const failure = Object.assign({ name: error.name, message: error.message }, error);
  await writeFile(join(job.out, "result.json"), JSON.stringify({ ...base, failure }, null, 2));
  return `failed: ${error.name}: ${error.message}`;
};

const run = async (): Promise<void> => {
  const loaded = await Env.create(
    Env.cli({
      name: "locator-trace",
      description: "Locate a target on screenshots with live Clef and save every round's pictures",
      sources: Env.source.defaults.map((source): Env.Source => ({
        ...source,
        load: async (io, flags) => {
          const sourceResult = await source.load(io, flags);
          if (jarl.is_err(sourceResult)) return sourceResult;
          const vars = jarl.value(sourceResult);
          return jarl.ok({
            ...vars,
            CLOUDFLARE_ACCOUNT_ID: vars.CLOUDFLARE_ACCOUNT_ID ?? vars.CF_ACC ?? "",
            CLOUDFLARE_API_TOKEN: vars.CLOUDFLARE_API_TOKEN ?? vars.CF_TOKEN ?? "",
          });
        },
      })),
    })
      .needs("cloudflareAccountId", "cloudflareApiToken")
      .done(),
  );
  if (jarl.is_err(loaded)) {
    console.error(loaded.error.message);
    process.exitCode = 1;
    return;
  }
  const env = jarl.value(loaded);
  const settings = env.config.locator;
  const options: Locator.Options = {
    grid: settings.grid,
    rounds: settings.rounds,
    power: settings.power,
    boxScale: settings.boxScale,
    threshold: settings.threshold,
    overviewScale: settings.overviewScale,
    gridImageScale: settings.gridImageScale,
    quality: settings.quality,
    callTimeoutMs: settings.callTimeout,
    retries: settings.retries,
    retryWaitMs: settings.retryWait,
  };
  const dependencies = { http: Http.create({}) };
  const decisionApi = DecisionApi.create(dependencies, {
    accountId: env.vars.cloudflareAccountId,
    token: env.vars.cloudflareApiToken,
  });
  const locator = Locator.create({ "decision-api": decisionApi }, options);

  const input: unknown = JSON.parse(await readFile("/dev/stdin", "utf8"));
  const jobs = (Array.isArray(input) ? input : [input]) as ReadonlyArray<Job>;
  console.log(
    `${jobs.length} job(s); ${options.rounds} rounds of a ${options.grid}x${options.grid} grid`,
  );
  for (const job of jobs) {
    console.log(`${job.out}: ${await traceOne(locator, options, job)}`);
  }
};

await run();
