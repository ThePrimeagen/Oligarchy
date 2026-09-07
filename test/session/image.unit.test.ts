import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Image from "../../src/session/image.ts";

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
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

type PngOptions = {
  readonly bitDepth?: number;
  readonly colorType?: number;
  readonly interlace?: number;
  readonly filter?: (row: number) => number;
  readonly level?: number;
};

// Encodes 8-bit RGB pixels the way a PNG writer does: one filter byte per row, then deflate.
const makePng = (
  width: number,
  height: number,
  pixels: Uint8Array,
  options: PngOptions = {},
): Uint8Array => {
  const stride = width * 3;
  const filterOf = options.filter ?? (() => 0);
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const filter = filterOf(y);
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const here = pixels[y * stride + x] ?? 0;
      const left = x >= 3 ? (pixels[y * stride + x - 3] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= 3 ? (pixels[(y - 1) * stride + x - 3] ?? 0) : 0;
      const predictor =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? (left + up) >> 1
              : filter === 4
                ? paeth(left, up, upLeft)
                : 0;
      raw[y * (stride + 1) + 1 + x] = (here - predictor) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = options.bitDepth ?? 8;
  ihdr[9] = options.colorType ?? 2;
  ihdr[12] = options.interlace ?? 0;
  const compressed = deflateSync(raw, { level: options.level ?? 6 });
  // Two IDAT chunks: the decoder has to concatenate them.
  const split = Math.floor(compressed.length / 2);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", compressed.subarray(0, split)),
      chunk("IDAT", compressed.subarray(split)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
};

// red, green / blue, white
const TINY_PIXELS = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
const tinyPng = (): Uint8Array => makePng(2, 2, TINY_PIXELS);

const gradient = (width: number, height: number): Uint8Array => {
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      pixels[i] = (x * 7) & 0xff;
      pixels[i + 1] = (y * 13) & 0xff;
      pixels[i + 2] = (x * y) & 0xff;
    }
  }
  return pixels;
};

// xorshift32: incompressible enough that deflate cannot shrink the image below a kitty chunk.
const noise = (width: number, height: number): Uint8Array => {
  const pixels = new Uint8Array(width * height * 3);
  let seed = 0x9e3779b9;
  for (let i = 0; i < pixels.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    pixels[i] = (seed >>> 24) & 0xff;
  }
  return pixels;
};

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

const ESC = String.fromCharCode(27);
// Every kitty graphics command in a rendering: [whole, control data, payload].
const kittyCommands = (text: string): Array<RegExpExecArray> => [
  ...text.matchAll(new RegExp(`${ESC}_G([^;]*);([^${ESC}]*)${ESC}\\\\`, "g")),
];

describe("imageProtocol", () => {
  it("picks kitty for kitty and ghostty terminals", () => {
    expect(Image.imageProtocol({ KITTY_WINDOW_ID: "1" })).toBe("kitty");
    expect(Image.imageProtocol({ TERM: "xterm-kitty" })).toBe("kitty");
    expect(Image.imageProtocol({ TERM: "xterm-ghostty" })).toBe("kitty");
    expect(Image.imageProtocol({ TERM: "dumb", TERM_PROGRAM: "ghostty" })).toBe("kitty");
  });

  it("picks iterm for iTerm, WezTerm and Konsole", () => {
    expect(Image.imageProtocol({ TERM_PROGRAM: "iTerm.app" })).toBe("iterm");
    expect(Image.imageProtocol({ TERM_PROGRAM: "WezTerm" })).toBe("iterm");
    expect(Image.imageProtocol({ LC_TERMINAL: "iTerm2" })).toBe("iterm");
    expect(Image.imageProtocol({ KONSOLE_VERSION: "230800" })).toBe("iterm");
  });

  it("falls back to ansi half-blocks otherwise, and only kitty can place images", () => {
    expect(Image.imageProtocol({})).toBe("ansi");
    expect(Image.imageProtocol({ TERM: "dumb", TERM_PROGRAM: "" })).toBe("ansi");
    expect(Image.imageProtocol({ TERM: "xterm-256color", TERM_PROGRAM: "Apple_Terminal" })).toBe(
      "ansi",
    );
    expect(Image.canPlaceImages("kitty")).toBe(true);
    expect(Image.canPlaceImages("iterm")).toBe(false);
    expect(Image.canPlaceImages("ansi")).toBe(false);
  });
});

describe("renderImage", () => {
  it("kitty: one transmit-and-display command in 4096-byte base64 chunks, then a newline", () => {
    const png = makePng(40, 40, noise(40, 40));
    const data = base64(png);
    expect(data.length).toBeGreaterThan(4096);
    const rendered = Result.getOrThrow(Image.renderImage(png, "kitty", 120));
    const chunks = kittyCommands(rendered);
    expect(chunks.length).toBe(Math.ceil(data.length / 4096));
    expect(chunks[0]?.[1]).toBe("a=T,f=100,c=120,m=1");
    expect(chunks.at(-1)?.[1]).toBe("m=0");
    expect(chunks.map((match) => match[2]).join("")).toBe(data);
    expect(chunks.slice(0, -1).every((match) => match[2]?.length === 4096)).toBe(true);
    expect(rendered.endsWith("\x1b\\\n")).toBe(true);
  });

  it("kitty: a small image is one chunk with m=0", () => {
    const png = tinyPng();
    expect(Result.getOrThrow(Image.renderImage(png, "kitty", 80))).toBe(
      `\x1b_Ga=T,f=100,c=80,m=0;${base64(png)}\x1b\\\n`,
    );
  });

  it("iterm: the inline file protocol", () => {
    const png = tinyPng();
    expect(Result.getOrThrow(Image.renderImage(png, "iterm", 80))).toBe(
      `\x1b]1337;File=inline=1;size=${String(png.length)};width=100%:${base64(png)}\x07\n`,
    );
  });

  it("ansi: two rows per line of half-blocks, top as foreground and bottom as background", () => {
    expect(Result.getOrThrow(Image.renderImage(tinyPng(), "ansi", 80))).toBe(
      "\x1b[38;2;255;0;0m\x1b[48;2;0;0;255m▀\x1b[38;2;0;255;0m\x1b[48;2;255;255;255m▀\x1b[0m\n",
    );
  });

  it("ansi: an odd last row has no background", () => {
    const pixels = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(Result.getOrThrow(Image.renderImage(makePng(1, 3, pixels), "ansi", 80))).toBe(
      "\x1b[38;2;10;20;30m\x1b[48;2;40;50;60m▀\x1b[0m\n\x1b[38;2;70;80;90m\x1b[49m▀\x1b[0m\n",
    );
  });

  it("ansi: a wide image is sampled down to the terminal's columns", () => {
    const png = makePng(8, 2, gradient(8, 2));
    const rendered = Result.getOrThrow(Image.renderImage(png, "ansi", 4));
    expect(rendered.match(/▀/g)).toHaveLength(4);
    expect(rendered.endsWith("\x1b[0m\n")).toBe(true);
  });

  it("ansi: decoding failures are returned, not thrown", () => {
    const result = Image.renderImage(makePng(2, 2, TINY_PIXELS, { bitDepth: 16 }), "ansi", 80);
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe("placeImage and clearImages", () => {
  it("deletes the previous placement by id, moves to the box and places with a fit that keeps the aspect", () => {
    const png = tinyPng();
    const out = Image.placeImage(png, { col: 42, row: 2, cols: 58, rows: 23 });
    expect(out).toBe(
      `\x1b_Ga=d,d=I,i=1,q=2\x1b\\\x1b[2;42H\x1b_Ga=T,f=100,i=1,q=2,C=1,c=46,r=23,m=0;${base64(png)}\x1b\\`,
    );
  });

  it("fits a wide image by width when it is short enough", () => {
    const png = makePng(8, 2, gradient(8, 2));
    const out = Image.placeImage(png, { col: 42, row: 2, cols: 58, rows: 23 });
    expect(out).toContain(",c=58,r=7,");
  });

  it("chunks a large placement and keeps the placement flags on the first chunk only", () => {
    const png = makePng(40, 40, noise(40, 40));
    const out = Image.placeImage(png, { col: 42, row: 2, cols: 58, rows: 23 });
    const chunks = kittyCommands(out);
    expect(chunks[0]?.[1]).toMatch(/^a=T,f=100,i=1,q=2,C=1,c=\d+,r=\d+,m=1$/);
    expect(chunks.at(-1)?.[1]).toBe("m=0");
    expect(chunks.map((match) => match[2]).join("")).toBe(base64(png));
  });

  it("clearImages deletes every placement quietly", () => {
    expect(Image.clearImages).toBe("\x1b_Ga=d,d=A,q=2\x1b\\");
  });
});

describe("decodePng", () => {
  it("decodes every filter type and several IDAT chunks back to the pixels", () => {
    const pixels = gradient(9, 10);
    const png = makePng(9, 10, pixels, { filter: (row) => row % 5 });
    const decoded = Result.getOrThrow(Image.decodePng(png));
    expect(decoded.width).toBe(9);
    expect(decoded.height).toBe(10);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(pixels));
  });

  it("round-trips pixels through zlib's deflateSync at every compression level", () => {
    for (const [pixels, size, level] of [
      [noise(30, 30), 30, 0],
      [TINY_PIXELS, 2, 1],
      [gradient(64, 64), 64, 6],
      [gradient(64, 64), 64, 9],
    ] as const) {
      const decoded = Result.getOrThrow(Image.decodePng(makePng(size, size, pixels, { level })));
      expect(Array.from(decoded.pixels)).toEqual(Array.from(pixels));
    }
  });

  it("decodes a screendump-sized image with the filters a PNG writer picks", () => {
    const pixels = gradient(320, 200);
    const png = makePng(320, 200, pixels, { filter: (row) => (row * 3) % 5 });
    const decoded = Result.getOrThrow(Image.decodePng(png));
    expect(decoded.width).toBe(320);
    expect(decoded.height).toBe(200);
    expect(decoded.pixels.length).toBe(320 * 200 * 3);
    expect(Buffer.from(decoded.pixels).equals(Buffer.from(pixels))).toBe(true);
  });

  it("rejects 16-bit, non-RGB and interlaced images with the exact message", () => {
    const failure = (options: PngOptions) => {
      const result = Image.decodePng(makePng(2, 2, TINY_PIXELS, options));
      if (Result.isSuccess(result)) {
        throw new Error("expected a decode failure");
      }
      return result.failure;
    };
    expect(failure({ bitDepth: 16 })).toMatchObject({
      _tag: "PngDecodeError",
      message: "unsupported png: bit depth 16, color type 2, interlace 0",
    });
    expect(failure({ colorType: 6 }).message).toBe(
      "unsupported png: bit depth 8, color type 6, interlace 0",
    );
    expect(failure({ interlace: 1 }).message).toBe(
      "unsupported png: bit depth 8, color type 2, interlace 1",
    );
  });

  it("rejects an unknown filter byte", () => {
    const result = Image.decodePng(makePng(2, 2, TINY_PIXELS, { filter: () => 5 }));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toBe("bad png filter 5");
    }
  });

  it("rejects a corrupt deflate stream with zlib's reason, as a failure not a throw", () => {
    const png = tinyPng();
    const corrupt = new Uint8Array(png);
    // The first IDAT payload starts after the signature (8), IHDR (25) and the IDAT header (8).
    corrupt[41] = 0xff;
    corrupt[42] = 0xff;
    const result = Image.decodePng(corrupt);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "PngDecodeError",
        message: "bad png data: incorrect header check",
      });
    }
  });

  it("rejects a deflate stream cut short with zlib's reason", () => {
    const raw = Buffer.alloc(2 * 7);
    for (let y = 0; y < 2; y++) {
      raw.set(TINY_PIXELS.subarray(y * 6, y * 6 + 6), y * 7 + 1);
    }
    const compressed = deflateSync(raw);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(2, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const truncated = new Uint8Array(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", compressed.subarray(0, compressed.length - 4)),
        chunk("IEND", Buffer.alloc(0)),
      ]),
    );
    const result = Image.decodePng(truncated);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "PngDecodeError",
        message: "bad png data: unexpected end of file",
      });
    }
    expect(Result.isFailure(Image.renderImage(truncated, "ansi", 80))).toBe(true);
  });
});
