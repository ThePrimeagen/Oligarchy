import type * as Locator from "@oligarchy/locator";
import type * as ScreenGrid from "@oligarchy/screen-grid";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

// What one locate left behind, found or not: the overview Clef saw every round, each round, and the
// point clicked (null when round one was below the threshold).
export type Trace = {
  readonly overview: ScreenGrid.Image;
  readonly rounds: ReadonlyArray<Locator.Round>;
  readonly pixel: ScreenGrid.Point | null;
};

const BOX_COLOURS = ["#ff9500", "#34c759", "#00c7ff", "#af52de", "#ffffff"];
const SHEET_TILE = 640;
const SHEET_GAP = 10;

const crosshair = (x: number, y: number, colour: string, size: number): string =>
  `<circle cx="${x}" cy="${y}" r="${size}" fill="none" stroke="${colour}" stroke-width="3"/>` +
  `<line x1="${x - size * 1.6}" y1="${y}" x2="${x + size * 1.6}" y2="${y}" stroke="${colour}" stroke-width="2"/>` +
  `<line x1="${x}" y1="${y - size * 1.6}" x2="${x}" y2="${y + size * 1.6}" stroke="${colour}" stroke-width="2"/>`;

const rect = (box: ScreenGrid.Box, colour: string): string =>
  `<rect x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}" fill="none" stroke="${colour}" stroke-width="3"/>`;

const svg = (width: number, height: number, parts: ReadonlyArray<string>): Buffer =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`,
  );

// The round's grid picture with Clef's answer over it: each cell tinted red by its p and labelled
// with it, the best cell outlined, the round's point, and the box the next round looks at.
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
    const best = cell.p === round.best;
    return [
      `<rect x="${b.left}" y="${b.top}" width="${b.right - b.left}" height="${b.bottom - b.top}" fill="#ff0000" fill-opacity="${(0.45 * cell.p).toFixed(3)}" stroke="${best ? "#ffffff" : "none"}" stroke-width="3"/>`,
      `<text x="${(b.left + b.right) / 2}" y="${(b.top + b.bottom) / 2}" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${size}" fill="white" stroke="black" stroke-width="3" paint-order="stroke" text-anchor="middle" dominant-baseline="central">${cell.label} ${cell.p.toFixed(3)}</text>`,
    ];
  });
  if (next !== null) {
    parts.push(rect(toPicture(next), "#00c7ff"));
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

// The screenshot with every later round's box and the point clicked.
const finalOut = async (screen: Uint8Array, trace: Trace): Promise<Buffer> => {
  const { width, height } = await sharp(screen).metadata();
  const parts = trace.rounds
    .slice(1)
    .map((round, k) => rect(round.box, BOX_COLOURS[k % BOX_COLOURS.length] ?? "#ffffff"));
  if (trace.pixel !== null) {
    parts.push(crosshair(trace.pixel.x, trace.pixel.y, "#ff3b30", 12));
  }
  return sharp(screen)
    .composite([{ input: svg(width, height, parts), top: 0, left: 0 }])
    .png()
    .toBuffer();
};

// Each round's in beside its out, top to bottom, with the final picture across the bottom.
const sheet = async (
  pictures: ReadonlyArray<readonly [Buffer | Uint8Array, Buffer]>,
  final: Buffer,
) => {
  const fit = async (input: Buffer | Uint8Array, width: number) => {
    const resized = await sharp(input).resize({ width }).png().toBuffer();
    const { height } = await sharp(resized).metadata();
    return { input: resized, height };
  };
  const tiles: { input: Buffer; top: number; left: number }[] = [];
  let top = 0;
  for (const [sent, answered] of pictures) {
    const a = await fit(sent, SHEET_TILE);
    const b = await fit(answered, SHEET_TILE);
    tiles.push(
      { input: a.input, top, left: 0 },
      { input: b.input, top, left: SHEET_TILE + SHEET_GAP },
    );
    top += Math.max(a.height, b.height) + SHEET_GAP;
  }
  const width = 2 * SHEET_TILE + SHEET_GAP;
  const bottom = await fit(final, width);
  tiles.push({ input: bottom.input, top, left: 0 });
  return sharp({
    create: { width, height: top + bottom.height, channels: 3, background: "#000000" },
  })
    .composite(tiles)
    .png()
    .toBuffer();
};

// overview.webp, round-<n>-in.webp (as Clef was sent it), round-<n>-out.png, final.png and
// sheet.png, all in `out`.
export const writeTrace = async (out: string, screen: Uint8Array, trace: Trace): Promise<void> => {
  await writeFile(join(out, "overview.webp"), trace.overview.bytes);
  const pictures: Array<readonly [Uint8Array, Buffer]> = [];
  for (const [k, round] of trace.rounds.entries()) {
    const answered = await roundOut(round, trace.rounds[k + 1]?.box ?? null);
    await writeFile(join(out, `round-${k + 1}-in.webp`), round.image.bytes);
    await writeFile(join(out, `round-${k + 1}-out.png`), answered);
    pictures.push([round.image.bytes, answered]);
  }
  const final = await finalOut(screen, trace);
  await writeFile(join(out, "final.png"), final);
  await writeFile(join(out, "sheet.png"), await sheet(pictures, final));
};
