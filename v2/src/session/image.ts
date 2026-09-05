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

const isPngDecodeError = Schema.is(Errors.PngDecodeError);

const fail = (message: string): never => {
  throw Errors.PngDecodeError.make({ message });
};

// ---------------------------------------------------------------------------
// inflate: the deflate decoder QEMU's screendumps need (RFC 1950/1951), nothing more
// ---------------------------------------------------------------------------

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

type Huffman = { readonly counts: Uint16Array; readonly symbols: Uint16Array };

const huffman = (lengths: ReadonlyArray<number>): Huffman => {
  const counts = new Uint16Array(16);
  for (const length of lengths) {
    counts[length] = (counts[length] ?? 0) + 1;
  }
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let length = 1; length < 16; length++) {
    offsets[length] = (offsets[length - 1] ?? 0) + (counts[length - 1] ?? 0);
  }
  const symbols = new Uint16Array(lengths.length);
  for (const [symbol, length] of lengths.entries()) {
    if (length !== 0) {
      const at = offsets[length] ?? 0;
      symbols[at] = symbol;
      offsets[length] = at + 1;
    }
  }
  return { counts, symbols };
};

const FIXED_LITERALS = huffman([
  ...Array.from({ length: 144 }, () => 8),
  ...Array.from({ length: 112 }, () => 9),
  ...Array.from({ length: 24 }, () => 7),
  ...Array.from({ length: 8 }, () => 8),
]);
const FIXED_DISTANCES = huffman(Array.from({ length: 30 }, () => 5));

const inflate = (data: Uint8Array, expected: number): Uint8Array => {
  if (data.length < 2) {
    return fail("bad png data: truncated zlib stream");
  }
  const cmf = data[0] ?? 0;
  const flg = data[1] ?? 0;
  if ((cmf & 0x0f) !== 8 || ((cmf << 8) | flg) % 31 !== 0 || (flg & 0x20) !== 0) {
    return fail("bad png data: not a zlib stream");
  }
  let pos = 2;
  let bits = 0;
  let bitCount = 0;
  let out = new Uint8Array(Math.max(expected, 1));
  let length = 0;

  const readBit = (): number => {
    if (bitCount === 0) {
      if (pos >= data.length) {
        return fail("bad png data: unexpected end of deflate stream");
      }
      bits = data[pos] ?? 0;
      pos++;
      bitCount = 8;
    }
    const bit = bits & 1;
    bits >>= 1;
    bitCount--;
    return bit;
  };
  const readBits = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i++) {
      value |= readBit() << i;
    }
    return value;
  };
  const push = (byte: number): void => {
    if (length === out.length) {
      const grown = new Uint8Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    out[length] = byte;
    length++;
  };
  const decodeSymbol = (table: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let bitLength = 1; bitLength < 16; bitLength++) {
      code |= readBit();
      const count = table.counts[bitLength] ?? 0;
      if (code - count < first) {
        return table.symbols[index + (code - first)] ?? fail("bad png data: bad huffman code");
      }
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    return fail("bad png data: bad huffman code");
  };
  const inflateBlock = (literals: Huffman, distances: Huffman): void => {
    for (;;) {
      const symbol = decodeSymbol(literals);
      if (symbol < 256) {
        push(symbol);
      } else if (symbol === 256) {
        return;
      } else {
        const lengthIndex = symbol - 257;
        if (lengthIndex >= LENGTH_BASE.length) {
          return fail("bad png data: bad length code");
        }
        const copy = (LENGTH_BASE[lengthIndex] ?? 0) + readBits(LENGTH_EXTRA[lengthIndex] ?? 0);
        const distanceIndex = decodeSymbol(distances);
        if (distanceIndex >= DIST_BASE.length) {
          return fail("bad png data: bad distance code");
        }
        const distance = (DIST_BASE[distanceIndex] ?? 0) + readBits(DIST_EXTRA[distanceIndex] ?? 0);
        if (distance > length) {
          return fail("bad png data: distance too far back");
        }
        for (let i = 0; i < copy; i++) {
          push(out[length - distance] ?? 0);
        }
      }
    }
  };
  const dynamicTables = (): readonly [Huffman, Huffman] => {
    const literalCount = readBits(5) + 257;
    const distanceCount = readBits(5) + 1;
    const codeLengthCount = readBits(4) + 4;
    const codeLengths: Array<number> = Array.from({ length: 19 }, () => 0);
    for (let i = 0; i < codeLengthCount; i++) {
      codeLengths[CODE_LENGTH_ORDER[i] ?? 0] = readBits(3);
    }
    const codeTable = huffman(codeLengths);
    const lengths: Array<number> = [];
    while (lengths.length < literalCount + distanceCount) {
      const symbol = decodeSymbol(codeTable);
      if (symbol < 16) {
        lengths.push(symbol);
      } else if (symbol === 16) {
        const previous = lengths.at(-1);
        if (previous === undefined) {
          return fail("bad png data: repeat with no previous length");
        }
        const repeat = 3 + readBits(2);
        for (let i = 0; i < repeat; i++) {
          lengths.push(previous);
        }
      } else {
        const repeat = symbol === 17 ? 3 + readBits(3) : 11 + readBits(7);
        for (let i = 0; i < repeat; i++) {
          lengths.push(0);
        }
      }
    }
    if (lengths.length > literalCount + distanceCount) {
      return fail("bad png data: too many code lengths");
    }
    return [huffman(lengths.slice(0, literalCount)), huffman(lengths.slice(literalCount))];
  };

  let final = 0;
  while (final === 0) {
    final = readBit();
    const type = readBits(2);
    if (type === 0) {
      bits = 0;
      bitCount = 0;
      if (pos + 4 > data.length) {
        return fail("bad png data: truncated stored block");
      }
      const stored = (data[pos] ?? 0) | ((data[pos + 1] ?? 0) << 8);
      const check = (data[pos + 2] ?? 0) | ((data[pos + 3] ?? 0) << 8);
      pos += 4;
      if ((stored ^ 0xffff) !== check || pos + stored > data.length) {
        return fail("bad png data: bad stored block");
      }
      for (let i = 0; i < stored; i++) {
        push(data[pos + i] ?? 0);
      }
      pos += stored;
    } else if (type === 1) {
      inflateBlock(FIXED_LITERALS, FIXED_DISTANCES);
    } else if (type === 2) {
      const [literals, distances] = dynamicTables();
      inflateBlock(literals, distances);
    } else {
      return fail("bad png data: reserved block type");
    }
  }
  return out.subarray(0, length);
};

// ---------------------------------------------------------------------------
// PNG: QEMU's screendump writes a non-interlaced 8-bit RGB PNG; that is the only shape decoded
// ---------------------------------------------------------------------------

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

const decode = (png: Uint8Array): Png => {
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
      bitDepth = png[offset + 16] ?? 0;
      colorType = png[offset + 17] ?? 0;
      interlace = png[offset + 20] ?? 0;
    } else if (type === "IDAT") {
      idat.push(png.subarray(offset + 8, offset + 8 + length));
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  if (bitDepth !== 8 || colorType !== 2 || interlace !== 0) {
    return fail(
      `unsupported png: bit depth ${String(bitDepth)}, color type ${String(colorType)}, interlace ${String(interlace)}`,
    );
  }
  const compressed = new Uint8Array(idat.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of idat) {
    compressed.set(part, at);
    at += part.length;
  }
  const stride = width * 3;
  const raw = inflate(compressed, height * (stride + 1));
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[rowIn + x] ?? 0;
      const left = x >= 3 ? (pixels[rowOut + x - 3] ?? 0) : 0;
      const up = y > 0 ? (pixels[rowOut + x - stride] ?? 0) : 0;
      const upLeft = y > 0 && x >= 3 ? (pixels[rowOut + x - stride - 3] ?? 0) : 0;
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
        return fail(`bad png filter ${String(filter)}`);
      }
      pixels[rowOut + x] = unfiltered & 0xff;
    }
  }
  return { width, height, pixels };
};

export const decodePng = (png: Uint8Array): Result.Result<Png, Errors.PngDecodeError> => {
  try {
    return Result.succeed(decode(png));
  } catch (error) {
    if (isPngDecodeError(error)) {
      return Result.fail(error);
    }
    throw error;
  }
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
  return [image.pixels[i] ?? 0, image.pixels[i + 1] ?? 0, image.pixels[i + 2] ?? 0];
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
