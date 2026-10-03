import * as jarl from "jarl";
import sharp, { type Sharp } from "sharp";

// Screenshots for a decision model: a region of the screen enlarged, a lettered and numbered grid
// drawn over it, encoded as WebP, and the screen box of every cell. Everything is in process; the
// screen is decoded once by open and every view is cut from those pixels.

export const ImageInvalid = jarl.error.define("ScreenGridImageInvalid");
export type ImageInvalid = InstanceType<typeof ImageInvalid>;
export const BoxInvalid = jarl.error.define("ScreenGridBoxInvalid");
export type BoxInvalid = InstanceType<typeof BoxInvalid>;

// Screen pixels. right and bottom are exclusive: a cell's right is the next cell's left.
export type Box = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};
export type Point = { readonly x: number; readonly y: number };

export type Screen = {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly channels: 1 | 2 | 3 | 4;
};

export type Image = {
  readonly bytes: Uint8Array;
  readonly contentType: "image/webp";
  readonly width: number;
  readonly height: number;
};

export type Cell = {
  readonly label: string;
  readonly column: number;
  readonly row: number;
  readonly box: Box;
};

// The picture is the box enlarged to `width` with the labels in a band of `margin` pixels above it
// and to its left. Cells are in screen pixels, not picture pixels.
export type View = Image & {
  readonly box: Box;
  readonly columns: number;
  readonly rows: number;
  readonly margin: number;
  readonly cells: ReadonlyArray<Cell>;
};

export type ViewOptions = {
  readonly box: Box;
  readonly columns: number;
  readonly rows: number;
  readonly width: number;
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const QUALITY = 80;
// libwebp's fastest method: 69 ms a view against 108 ms for the default, at a size Cloudflare's
// request limit still allows.
const EFFORT = 0;

const invalid = (thrown: unknown): ImageInvalid =>
  new ImageInvalid(thrown instanceof Error ? thrown.message : "image could not be decoded");

export const toScreen = (box: Box, u: number, v: number): Point => ({
  x: box.left + u * (box.right - box.left),
  y: box.top + v * (box.bottom - box.top),
});

export const open = (bytes: Uint8Array): Promise<jarl.Result<Screen, ImageInvalid>> =>
  jarl.exec(async () => {
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    return {
      width: info.width,
      height: info.height,
      pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      channels: info.channels,
    };
  }, invalid);

const pixelsOf = (screen: Screen) =>
  sharp(screen.pixels, {
    raw: { width: screen.width, height: screen.height, channels: screen.channels },
  });

const encode = (image: Sharp, width: number, height: number) =>
  jarl.exec(async (): Promise<Image> => {
    const bytes = await image.webp({ quality: QUALITY, effort: EFFORT }).toBuffer();
    return { bytes: new Uint8Array(bytes), contentType: "image/webp", width, height };
  }, invalid);

// The whole screen at `width`, its proportions kept.
export const whole = (screen: Screen, width: number): Promise<jarl.Result<Image, ImageInvalid>> => {
  const height = Math.max(1, Math.round((width * screen.height) / screen.width));
  return encode(
    pixelsOf(screen).resize(width, height, { kernel: "lanczos3", fit: "fill" }),
    width,
    height,
  );
};

const cellsOf = (box: Box, columns: number, rows: number): ReadonlyArray<Cell> => {
  const w = (box.right - box.left) / columns;
  const h = (box.bottom - box.top) / rows;
  return Array.from({ length: rows * columns }, (_, i) => {
    const column = i % columns;
    const row = Math.floor(i / columns);
    return {
      label: `${LETTERS[column]}${row + 1}`,
      column,
      row,
      box: {
        left: box.left + column * w,
        top: box.top + row * h,
        right: box.left + (column + 1) * w,
        bottom: box.top + (row + 1) * h,
      },
    };
  });
};

const overlay = (
  width: number,
  height: number,
  margin: number,
  columns: number,
  rows: number,
): Buffer => {
  const w = width / columns;
  const h = height / rows;
  const size = Math.max(13, Math.round((24 * width) / 1280));
  const text = (x: number, y: number, label: string) =>
    `<text x="${x}" y="${y}" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${size}" fill="yellow" text-anchor="middle" dominant-baseline="central">${label}</text>`;
  const parts: string[] = [];
  for (let i = 1; i < columns; i += 1) {
    parts.push(
      `<line x1="${margin + w * i}" y1="${margin}" x2="${margin + w * i}" y2="${margin + height}" stroke="#00ff00" stroke-width="1"/>`,
    );
  }
  for (let i = 1; i < rows; i += 1) {
    parts.push(
      `<line x1="${margin}" y1="${margin + h * i}" x2="${margin + width}" y2="${margin + h * i}" stroke="#00ff00" stroke-width="1"/>`,
    );
  }
  for (let i = 0; i < columns; i += 1) {
    parts.push(text(margin + w * (i + 0.5), margin / 2, LETTERS[i] ?? "?"));
  }
  for (let i = 0; i < rows; i += 1) {
    parts.push(text(margin / 2, margin + h * (i + 0.5), String(i + 1)));
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width + margin}" height="${height + margin}">${parts.join("")}</svg>`,
  );
};

const boxProblem = (screen: Screen, box: Box): string | null => {
  const sides = [box.left, box.top, box.right, box.bottom];
  if (!sides.every(Number.isInteger)) {
    return "box sides must be whole pixels";
  }
  if (box.right <= box.left || box.bottom <= box.top) {
    return "box is empty";
  }
  if (box.left < 0 || box.top < 0 || box.right > screen.width || box.bottom > screen.height) {
    return `box is not inside the ${screen.width}x${screen.height} screen`;
  }
  return null;
};

export const view = async (
  screen: Screen,
  options: ViewOptions,
): Promise<jarl.Result<View, BoxInvalid | ImageInvalid>> => {
  const { box, columns, rows, width } = options;
  const problem = boxProblem(screen, box);
  if (problem !== null) {
    return jarl.err(new BoxInvalid(problem));
  }
  if (
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 1 ||
    rows < 1 ||
    columns > LETTERS.length
  ) {
    return jarl.err(new BoxInvalid(`a grid of ${columns}x${rows} cannot be labelled`));
  }
  const boxWidth = box.right - box.left;
  const boxHeight = box.bottom - box.top;
  const height = Math.max(1, Math.round((width * boxHeight) / boxWidth));
  const margin = Math.max(20, Math.round((36 * width) / 1280));
  const image = pixelsOf(screen)
    .extract({ left: box.left, top: box.top, width: boxWidth, height: boxHeight })
    .resize(width, height, { kernel: "lanczos3", fit: "fill" })
    .extend({ top: margin, left: margin, background: { r: 0, g: 0, b: 0 } })
    .composite([{ input: overlay(width, height, margin, columns, rows), top: 0, left: 0 }]);
  const encoded = await encode(image, width + margin, height + margin);
  if (jarl.is_err(encoded)) {
    return encoded;
  }
  return jarl.ok({
    ...jarl.value(encoded),
    box,
    columns,
    rows,
    margin,
    cells: cellsOf(box, columns, rows),
  });
};
