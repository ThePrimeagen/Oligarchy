#!/usr/bin/env -S bun --no-env-file
import * as DecisionApi from "@oligarchy/decision-api";
import * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as Locator from "@oligarchy/locator";
import * as jarl from "jarl";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, type Plan } from "./lib/args.ts";
import { writeTrace } from "./lib/render.ts";

const HELP = `Ask Clef where to click on screenshots and save every zoom round.

Usage:
  scripts/locate.ts <image>... --target "<what to click>" [options]
  scripts/locate.ts <image>... --question "<question naming the cell>" [options]

Images:
  <image>, --image <image>   A PNG, JPEG or WebP screenshot, or a directory of them. Repeat for more.

What to find (one of):
  --target <text>            The thing to click, e.g. "the monitor icon in the menu bar". Each cell
                             is asked: In image 2, does grid cell C3 (column C, row 3) contain <text>?
  --question <text>          Your own question. Name the cell with {cell}, {column} and {row}, or
                             dictate it: "this cell" becomes "grid cell {cell} (column {column},
                             row {row})", and the bare words cell, column and row become the tokens.
  --task <text>              What the click is for, given to Clef as state. Defaults to
                             "Click <target>." or the question as written.

Search (each defaults to v2/oligarchy.json's locator section):
  --grid <n>                 Cells per side, 2 to 8.
  --rounds <list>            One rule per round, as deep as the search goes: highest (the best
                             cell's centre) or pcenter (the probability-weighted centre), e.g.
                             highest,pcenter,pcenter.
  --threshold <p>            Round one's best cell below this is "not found".
  --power <n>                The power pcenter raises each probability to.
  --box-scale <n>            The next round's box, in cells of this round; smaller than --grid.

Output:
  --out <dir>                Where to write. Default scripts/out/<time>-<task>/. Each image gets a
                             directory with round-<n>-in.webp (sent to Clef), round-<n>-out.png
                             (its answer: every cell's p, the point, the next box), final.png,
                             sheet.png (all of it on one page) and result.json; summary.json covers
                             the run.
  --env-file <path>          Also read this env file for CLOUDFLARE_ACCOUNT_ID and
                             CLOUDFLARE_API_TOKEN (CF_ACC and CF_TOKEN work too).

Examples:
  scripts/locate.ts shots/menu.png --target "the Setup entry in the Go menu"
  scripts/locate.ts shots/ --question "Does this cell contain the monitor icon?" --grid 6
  scripts/locate.ts a.png b.png --target "the clock" --rounds highest,highest,pcenter,pcenter
`;

const IMAGE = /\.(png|jpe?g|webp)$/i;

const shown = (path: string): string => {
  const near = relative(process.cwd(), path);
  if (near === "") {
    return ".";
  }
  return near.startsWith("..") ? path : near;
};

const fail = (message: string, code = 1): never => {
  console.error(`locate: ${message}`);
  process.exit(code);
};

const expand = async (paths: ReadonlyArray<string>): Promise<ReadonlyArray<string>> => {
  const found: string[] = [];
  for (const path of paths) {
    const info = await stat(path).catch(() => fail(`${path}: no such file or directory`));
    if (info.isDirectory()) {
      const names = (await readdir(path)).filter((name) => IMAGE.test(name)).toSorted();
      if (names.length === 0) {
        fail(`${path}: no PNG, JPEG or WebP images in it`);
      }
      found.push(...names.map((name) => join(path, name)));
    } else {
      found.push(path);
    }
  }
  return found;
};

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");

const stamp = (): string =>
  new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

const readText = async (
  path: string,
): Promise<jarl.Result<string, Env.FileMissing | Env.FileUnreadable>> => {
  try {
    return jarl.ok(await readFile(path, "utf8"));
  } catch (cause) {
    const missing = cause instanceof Error && "code" in cause && cause.code === "ENOENT";
    return jarl.err(missing ? new Env.FileMissing(path) : new Env.FileUnreadable(path, cause));
  }
};

const loadEnv = async (plan: Plan) => {
  const io: Env.Io = {
    argv: plan.envFile === null ? [] : ["--env-file", plan.envFile],
    env: process.env,
    readFile: readText,
  };
  return Env.create(
    Env.cli({
      name: "locate",
      description: "Ask Clef where to click on screenshots",
      sources: Env.source.defaults.map((source): Env.Source => ({
        ...source,
        load: async (sourceIo, flags) => {
          const loaded = await source.load(sourceIo, flags);
          if (jarl.is_err(loaded)) return loaded;
          const vars = jarl.value(loaded);
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
    io,
  );
};

const roundsLine = (rounds: ReadonlyArray<Locator.Round>): string =>
  rounds
    .map((round) => {
      const best = round.cells.find((cell) => cell.p === round.best);
      return `${round.pick} ${best?.label ?? "?"} ${round.best.toFixed(2)}`;
    })
    .join("  >  ");

const summaryOf = (round: Locator.Round) => ({
  pick: round.pick,
  box: round.box,
  best: round.best,
  point: round.point,
  inputTokens: round.inputTokens,
  cells: Object.fromEntries(round.cells.map((cell) => [cell.label, Number(cell.p.toFixed(4))])),
});

const run = async (): Promise<void> => {
  const parsed = parse(process.argv.slice(2));
  if (!parsed.ok) {
    fail(`${parsed.message}\nRun scripts/locate.ts --help for the options.`, 2);
    return;
  }
  if ("help" in parsed) {
    console.log(HELP);
    return;
  }
  const { plan } = parsed;
  const images = await expand(plan.images);

  const loaded = await loadEnv(plan);
  if (jarl.is_err(loaded)) {
    fail(loaded.error.message);
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
    ...plan.overrides,
  };
  if (options.boxScale >= options.grid) {
    fail(`box scale ${options.boxScale} must be smaller than the grid (${options.grid})`, 2);
  }
  const decisionApi = DecisionApi.create(
    { http: Http.create({}) },
    { accountId: env.vars.cloudflareAccountId, token: env.vars.cloudflareApiToken },
  );
  const locator = Locator.create({ "decision-api": decisionApi }, options);

  const out = resolve(
    plan.out ??
      join(dirname(fileURLToPath(import.meta.url)), "out", `${stamp()}-${slug(plan.task)}`),
  );
  await mkdir(out, { recursive: true });
  console.log(`question  ${plan.question}`);
  console.log(`task      ${plan.task}`);
  console.log(
    `search    ${options.grid}x${options.grid}, rounds ${options.rounds.join(" ")}, threshold ${options.threshold}`,
  );
  console.log(`out       ${shown(out)}\n`);

  const used = new Set<string>();
  const results: unknown[] = [];
  let failures = 0;
  for (const image of images) {
    let name = slug(basename(image, extname(image))) || "image";
    for (let n = 2; used.has(name); n += 1) {
      name = `${slug(basename(image, extname(image)))}-${n}`;
    }
    used.add(name);
    const dir = join(out, name);
    await mkdir(dir, { recursive: true });
    const screen = new Uint8Array(await readFile(image));
    const started = Date.now();
    const result = await locator.locate({ screen, question: plan.question, task: plan.task });
    const ms = Date.now() - started;
    const base = { image: resolve(image), question: plan.question, task: plan.task, options, ms };
    let line: string;
    let record: object;
    if (jarl.is_ok(result)) {
      const found = jarl.value(result);
      await writeTrace(dir, screen, {
        overview: found.overview,
        rounds: found.rounds,
        pixel: found.pixel,
      });
      line = `found (${Math.round(found.pixel.x)}, ${Math.round(found.pixel.y)}) [${found.x.toFixed(3)}, ${found.y.toFixed(3)}]  ${roundsLine(found.rounds)}`;
      record = {
        ...base,
        found: { x: found.x, y: found.y, pixel: found.pixel },
        rounds: found.rounds.map(summaryOf),
      };
    } else if ("round" in result.error) {
      // NotFound is the one failure that carries a round.
      const { error } = result;
      await writeTrace(dir, screen, {
        overview: error.overview,
        rounds: [error.round],
        pixel: null,
      });
      line = `not found (best ${error.best.toFixed(2)} < ${error.threshold})  ${roundsLine([error.round])}`;
      record = {
        ...base,
        notFound: { best: error.best, threshold: error.threshold },
        rounds: [summaryOf(error.round)],
      };
    } else {
      const { error } = result;
      failures += 1;
      line = `failed: ${error.name}: ${error.message}`;
      record = {
        ...base,
        failure: Object.assign({ name: error.name, message: error.message }, error),
      };
    }
    await writeFile(join(dir, "result.json"), JSON.stringify(record, null, 2));
    results.push(record);
    const look = shown(join(dir, "failure" in record ? "result.json" : "sheet.png"));
    console.log(`${basename(image)}\n  ${line}\n  ${look}`);
  }
  await writeFile(join(out, "summary.json"), JSON.stringify(results, null, 2));
  if (failures > 0) {
    process.exitCode = 1;
  }
};

await run();
