import type * as App from "@oligarchy/app";
import type * as Locator from "@oligarchy/locator";
import * as jarl from "jarl";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import type { Run } from "./environment.ts";
import { phrase } from "./question.ts";
import { writeTrace } from "./render.ts";
import { searchOf } from "./services.ts";

export const Refused = jarl.error.define("LocateRefused");
export const Failed = jarl.error.define("LocateFailed");

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

export const main =
  (options: {
    // Every Clef call's wall time since it was last emptied, filled by the services.
    readonly calls: Array<number>;
    readonly write: (line: string) => void;
    // Where a run without --out writes: a directory named for the time and the task goes under it.
    readonly outRoot: string;
  }) =>
  async (app: App.App<Run, Locator.Locator>) => {
    const { flags } = app.environment;
    const { calls, write } = options;
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
    const { question, task } = phrased;
    const out = resolve(flags.out ?? join(options.outRoot, `${stamp()}-${slug(task)}`));
    await mkdir(out, { recursive: true });
    write(`question  ${question}`);
    write(`task      ${task}`);
    write(`model     ${flags.model}`);
    write(
      `search    ${search.grid}x${search.grid}, rounds ${search.rounds.join(" ")}, threshold ${search.threshold}`,
    );
    write(`out       ${shown(out)}\n`);

    const used = new Set<string>();
    const results: unknown[] = [];
    let failures = 0;
    for (const image of images) {
      const stem = slug(basename(image, extname(image))) || "image";
      let name = stem;
      for (let n = 2; used.has(name); n += 1) {
        name = `${stem}-${n}`;
      }
      used.add(name);
      const dir = join(out, name);
      await mkdir(dir, { recursive: true });
      const screen = new Uint8Array(await readFile(image));
      calls.length = 0;
      const started = performance.now();
      const result = await app.services.locator.locate({
        screen,
        question,
        task,
        signal: app.signal,
      });
      const ms = Math.round(performance.now() - started);
      const timing = { totalMs: ms, clefCallsMs: [...calls] };
      const base = { image: resolve(image), question, task, model: flags.model, search, timing };
      let line: string;
      let record: object;
      if (jarl.is_ok(result)) {
        const found = jarl.value(result);
        await writeTrace(dir, screen, found);
        line = `found (${Math.round(found.pixel.x)}, ${Math.round(found.pixel.y)}) [${found.x.toFixed(3)}, ${found.y.toFixed(3)}]  ${roundsLine(found.rounds)}`;
        record = {
          ...base,
          found: { x: found.x, y: found.y, pixel: found.pixel },
          rounds: found.rounds.map(summaryOf),
        };
      } else if ("round" in result.error) {
        // NotFound is the one failure that carries a round.
        const notFound = result.error;
        await writeTrace(dir, screen, {
          overview: notFound.overview,
          rounds: [notFound.round],
          pixel: null,
        });
        line = `not found (best ${notFound.best.toFixed(2)} < ${notFound.threshold})  ${roundsLine([notFound.round])}`;
        record = {
          ...base,
          notFound: { best: notFound.best, threshold: notFound.threshold },
          rounds: [summaryOf(notFound.round)],
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
      write(
        `${basename(image)}\n  ${line}\n  ${ms} ms (Clef calls ${timing.clefCallsMs.join(" + ")} ms)\n  ${look}`,
      );
    }
    await writeFile(join(out, "summary.json"), JSON.stringify(results, null, 2));
    return failures === 0
      ? jarl.ok(undefined)
      : jarl.err(
          new Failed(`${failures} of ${images.length} images failed; see their result.json`),
        );
  };
