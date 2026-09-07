import { inflateSync } from "node:zlib";
import { Encoding, Result, Schema } from "effect";
import * as Errors from "../shared/errors.ts";

export type ImageProtocol = "kitty" | "iterm" | "ansi";

export const imageProtocol = (env: Readonly<Record<string, string | undefined>>): ImageProtocol => {
  const term = env.TERM ?? "";
  const program = env.TERM_PROGRAM ?? "";
  if (
    env.KITTY_WINDOW_ID !== undefined ||
    term.includes("kitty") ||
    term.includes("ghostty") ||
    program === "ghostty"
  ) {
    return "kitty";
  }
  if (
    program === "iTerm.app" ||
    program === "WezTerm" ||
    env.LC_TERMINAL === "iTerm2" ||
    env.KONSOLE_VERSION !== undefined
  ) {
    return "iterm";
  }
  return "ansi";
};

// Only the kitty protocol can pin an image to a screen cell (ghostty and kitty speak it);
// iTerm's and the half-block fallback only flow inline with the text.
export const canPlaceImages = (protocol: ImageProtocol): boolean => protocol === "kitty";

export type ImageBox = {
  readonly col: number;
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
};

// A terminal cell is about twice as tall as it is wide; the fit assumes that ratio
// because the true cell size in pixels is not knowable without a terminal query.
const CELL_ASPECT = 2;
const CHUNK = 4096;

const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const kittyChunks = (data: string, first: string): string => {
  let out = "";
  for (let i = 0; i < data.length; i += CHUNK) {
    const head = i === 0 ? first : "";
    const more = i + CHUNK < data.length ? 1 : 0;
    out += `\x1b_G${head}m=${String(more)};${data.slice(i, i + CHUNK)}\x1b\\`;
  }
  return out;
};

export const placeImage = (png: Uint8Array, box: ImageBox): string => {
  const header = view(png);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  let cols = box.cols;
  let rows = Math.max(1, Math.round(((height / width) * cols) / CELL_ASPECT));
  if (rows > box.rows) {
    rows = box.rows;
    cols = Math.max(1, Math.round((width / height) * rows * CELL_ASPECT));
  }
  // Same image id every time, so the previous placement goes before the new one lands;
  // q=2 keeps the terminal from answering on stdin, where a readline would read it.
  return `\x1b_Ga=d,d=I,i=1,q=2\x1b\\\x1b[${String(box.row)};${String(box.col)}H${kittyChunks(
    Encoding.encodeBase64(png),
    `a=T,f=100,i=1,q=2,C=1,c=${String(cols)},r=${String(rows)},`,
  )}`;
};

export const clearImages = "\x1b_Ga=d,d=A,q=2\x1b\\";

export type Png = {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
};

// ---------------------------------------------------------------------------
// PNG: QEMU's screendump writes a non-interlaced 8-bit RGB PNG; that is the only shape decoded
// ---------------------------------------------------------------------------

const decodeFailure = (message: string): Result.Result<never, Errors.PngDecodeError> =>
  Result.fail(Errors.PngDecodeError.make({ message }));

// zlib only ever throws an Error; its message is the reason (`incorrect header check`, …).
const zlibError = Schema.decodeUnknownSync(Schema.ErrorInstance());

const inflate = (compressed: Uint8Array): Result.Result<Uint8Array, Errors.PngDecodeError> => {
  try {
    return Result.succeed(inflateSync(compressed));
  } catch (error) {
    return decodeFailure(`bad png data: ${zlibError(error).message}`);
  }
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
};

type Chunks = {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlace: number;
  readonly compressed: Uint8Array;
};

const chunks = (png: Uint8Array): Chunks => {
  const header = view(png);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Array<Uint8Array> = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = header.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (type === "IHDR") {
      width = header.getUint32(offset + 8);
      height = header.getUint32(offset + 12);
      bitDepth = png[offset + 16];
      colorType = png[offset + 17];
      interlace = png[offset + 20];
    } else if (type === "IDAT") {
      idat.push(png.subarray(offset + 8, offset + 8 + length));
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  const compressed = new Uint8Array(idat.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of idat) {
    compressed.set(part, at);
    at += part.length;
  }
  return { width, height, bitDepth, colorType, interlace, compressed };
};

// Undoes the per-row filter each scanline was written with (one filter byte, then the row).
const unfilter = (
  raw: Uint8Array,
  width: number,
  height: number,
): Result.Result<Uint8Array, Errors.PngDecodeError> => {
  const stride = width * 3;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[rowIn + x];
      const left = x >= 3 ? pixels[rowOut + x - 3] : 0;
      const up = y > 0 ? pixels[rowOut + x - stride] : 0;
      const upLeft = y > 0 && x >= 3 ? pixels[rowOut + x - stride - 3] : 0;
      let unfiltered: number;
      if (filter === 0) {
        unfiltered = value;
      } else if (filter === 1) {
        unfiltered = value + left;
      } else if (filter === 2) {
        unfiltered = value + up;
      } else if (filter === 3) {
        unfiltered = value + ((left + up) >> 1);
      } else if (filter === 4) {
        unfiltered = value + paeth(left, up, upLeft);
      } else {
        return decodeFailure(`bad png filter ${String(filter)}`);
      }
      pixels[rowOut + x] = unfiltered & 0xff;
    }
  }
  return Result.succeed(pixels);
};

export const decodePng = (png: Uint8Array): Result.Result<Png, Errors.PngDecodeError> => {
  const { width, height, bitDepth, colorType, interlace, compressed } = chunks(png);
  if (bitDepth !== 8 || colorType !== 2 || interlace !== 0) {
    return decodeFailure(
      `unsupported png: bit depth ${String(bitDepth)}, color type ${String(colorType)}, interlace ${String(interlace)}`,
    );
  }
  return Result.map(
    Result.flatMap(inflate(compressed), (raw) => unfilter(raw, width, height)),
    (pixels) => ({ width, height, pixels }),
  );
};

const pixelAt = (
  image: Png,
  col: number,
  row: number,
  scale: number,
): readonly [number, number, number] => {
  const px = Math.min(image.width - 1, Math.floor((col + 0.5) * scale));
  const py = Math.min(image.height - 1, Math.floor((row + 0.5) * scale));
  const i = (py * image.width + px) * 3;
  return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]];
};

const halfBlocks = (image: Png, columns: number): string => {
  const outCols = Math.min(columns, image.width);
  const scale = image.width / outCols;
  const outRows = Math.round(image.height / scale);
  let text = "";
  for (let row = 0; row < outRows; row += 2) {
    for (let col = 0; col < outCols; col++) {
      const [r, g, b] = pixelAt(image, col, row, scale);
      text += `\x1b[38;2;${String(r)};${String(g)};${String(b)}m`;
      if (row + 1 < outRows) {
        const [br, bg, bb] = pixelAt(image, col, row + 1, scale);
        text += `\x1b[48;2;${String(br)};${String(bg)};${String(bb)}m▀`;
      } else {
        text += "\x1b[49m▀";
      }
    }
    text += "\x1b[0m\n";
  }
  return text;
};

export const renderImage = (
  png: Uint8Array,
  protocol: ImageProtocol,
  columns: number,
): Result.Result<string, Errors.PngDecodeError> => {
  switch (protocol) {
    case "kitty":
      return Result.succeed(
        `${kittyChunks(Encoding.encodeBase64(png), `a=T,f=100,c=${String(columns)},`)}\n`,
      );
    case "iterm":
      return Result.succeed(
        `\x1b]1337;File=inline=1;size=${String(png.length)};width=100%:${Encoding.encodeBase64(png)}\x07\n`,
      );
    case "ansi":
      return Result.map(decodePng(png), (image) => halfBlocks(image, columns));
  }
  return protocol satisfies never;
};
