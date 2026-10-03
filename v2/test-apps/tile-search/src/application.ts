import type * as App from "@oligarchy/app";
import type * as Http from "@oligarchy/http";
import * as jarl from "jarl";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import type { Run } from "./environment.ts";
import { phrase } from "./question.ts";
import { writeTrace } from "./render.ts";
import { type Attempt, type Outcome, outcomeText, report, stepLines, stepOf } from "./report.ts";
import { type Locators, searchOf } from "./services.ts";

export const Refused = jarl.error.define("TileSearchRefused");
export const Failed = jarl.error.define("TileSearchFailed");

const IMAGE = /\.(png|jpe?g|webp)$/i;

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");

const stamp = (): string =>
  new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

const shown = (path: string): string => {
  const near = relative(process.cwd(), path);
  if (near === "") {
    return ".";
  }
  return near.startsWith("..") ? path : near;
};

// Each path a file, or a directory whose images are taken in name order.
const expand = async (
  paths: ReadonlyArray<string>,
): Promise<jarl.Result<ReadonlyArray<string>, InstanceType<typeof Refused>>> => {
  const found: string[] = [];
  for (const path of paths) {
    const info = await stat(path).catch(() => null);
    if (info === null) {
      return jarl.err(new Refused(`${path}: no such file or directory`));
    }
    if (!info.isDirectory()) {
      found.push(path);
      continue;
    }
    const names = (await readdir(path)).filter((name) => IMAGE.test(name)).toSorted();
    if (names.length === 0) {
      return jarl.err(new Refused(`${path}: no PNG, JPEG or WebP images in it`));
    }
    found.push(...names.map((name) => join(path, name)));
  }
  return jarl.ok(found);
};

// A directory name per image, from its file name, unique within the run.
const namesOf = (images: ReadonlyArray<string>): ReadonlyArray<string> => {
  const used = new Set<string>();
  return images.map((image) => {
    const stem = slug(basename(image, extname(image))) || "image";
    let name = stem;
    for (let n = 2; used.has(name); n += 1) {
      name = `${stem}-${n}`;
    }
    used.add(name);
    return name;
  });
};

export const main =
  (options: {
    // One locator per --model.
    readonly locators: Locators;
    // Every Clef call's wall time since it was last emptied, filled by the locators' decision-api.
    readonly calls: Array<number>;
    readonly write: (line: string) => void;
    // Where a run without --out writes: a directory named for the time and the task goes under it.
    readonly outRoot: string;
  }) =>
  async (app: App.App<Run, Http.Http>) => {
    const { flags } = app.environment;
    const { locators, calls, write } = options;
    const phrased = phrase(flags);
    if (!phrased.ok) {
      return jarl.err(new Refused(phrased.message));
    }
    const search = searchOf(app.environment);
    if (search.boxScale >= search.grid) {
      return jarl.err(
        new Refused(`box scale ${search.boxScale} must be smaller than the grid (${search.grid})`),
      );
    }
    const expanded = await expand(flags.images);
    if (jarl.is_err(expanded)) {
      return expanded;
    }
    const images = jarl.value(expanded);
    const names = namesOf(images);
    const screens = await Promise.all(
      images.map(async (image) => new Uint8Array(await readFile(image))),
    );
    const { question, task } = phrased;
    const models = flags.model;
    const out = resolve(flags.out ?? join(options.outRoot, `${stamp()}-${slug(task)}`));
    await mkdir(out, { recursive: true });
    write(`question  ${question}`);
    write(`task      ${task}`);
    write(
      `search    ${search.grid}x${search.grid}, rounds ${search.rounds.join(" ")}, threshold ${search.threshold}`,
    );
    write(`models    ${models.join(", ")}; ${flags.runs} run(s) of ${images.length} image(s)`);
    write(`out       ${shown(out)}\n`);

    const attempts: Attempt[] = [];
    for (let run = 1; run <= flags.runs; run += 1) {
      // Alternated, so neither model always asks first.
      const order = run % 2 === 1 ? models : models.toReversed();
      for (const model of order) {
        const locator = locators.get(model);
        if (locator === undefined) {
          continue;
        }
        for (const [index, image] of images.entries()) {
          const name = names[index] ?? "image";
          const screen = screens[index] ?? new Uint8Array();
          calls.length = 0;
          const started = performance.now();
          const result = await locator.locate({ screen, question, task, signal: app.signal });
          const timing = {
            totalMs: Math.round(performance.now() - started),
            clefCallsMs: [...calls],
          };
          const dir = join(out, model, name);
          let outcome: Outcome;
          let rounds;
          if (jarl.is_ok(result)) {
            const found = jarl.value(result);
            outcome = { kind: "found", pixel: found.pixel, x: found.x, y: found.y };
            rounds = found.rounds;
            if (run === 1) {
              await mkdir(dir, { recursive: true });
              await writeTrace(dir, screen, found);
            }
          } else if ("round" in result.error) {
            // NotFound is the one failure that carries a round.
            const notFound = result.error;
            outcome = { kind: "notFound", best: notFound.best, threshold: notFound.threshold };
            rounds = [notFound.round];
            if (run === 1) {
              await mkdir(dir, { recursive: true });
              await writeTrace(dir, screen, {
                overview: notFound.overview,
                rounds,
                pixel: null,
              });
            }
          } else {
            outcome = { kind: "failed", name: result.error.name, message: result.error.message };
            rounds = [];
          }
          const attempt: Attempt = {
            run,
            model,
            image: name,
            outcome,
            steps: rounds.map(stepOf),
            timing,
          };
          attempts.push(attempt);
          const took = `${timing.totalMs} ms (Clef calls ${timing.clefCallsMs.join(" + ")} ms)`;
          if (run === 1) {
            await mkdir(dir, { recursive: true });
            await writeFile(
              join(dir, "result.json"),
              JSON.stringify({ ...attempt, path: resolve(image), question, task, search }, null, 2),
            );
            write(`${basename(image)}, ${model}: ${outcomeText(outcome)}, ${took}`);
            for (const [k, step] of attempt.steps.entries()) {
              for (const line of stepLines(step, k)) {
                write(line);
              }
            }
            write(
              `  ${shown(join(dir, outcome.kind === "failed" ? "result.json" : "sheet.png"))}\n`,
            );
          } else {
            write(`run ${run}/${flags.runs}  ${model}  ${name}: ${outcomeText(outcome)}, ${took}`);
          }
        }
      }
    }

    const header = { question, task, search, models, runs: flags.runs, images: names };
    await writeFile(join(out, "attempts.json"), JSON.stringify(attempts, null, 2));
    await writeFile(join(out, "report.md"), report(header, attempts));
    write(`\nreport    ${shown(join(out, "report.md"))}`);
    const failures = attempts.filter((each) => each.outcome.kind === "failed").length;
    return failures === 0
      ? jarl.ok(undefined)
      : jarl.err(new Failed(`${failures} of ${attempts.length} searches failed; see report.md`));
  };
