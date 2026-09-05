import { inflateSync } from "node:zlib";

const imageProtocol = (() => {
  const term = process.env.TERM ?? "";
  const program = process.env.TERM_PROGRAM ?? "";
  if (process.env.KITTY_WINDOW_ID !== undefined || term.includes("kitty") || term.includes("ghostty") || program === "ghostty") {
    return "kitty";
  }
  if (program === "iTerm.app" || program === "WezTerm" || process.env.LC_TERMINAL === "iTerm2" || process.env.KONSOLE_VERSION !== undefined) {
    return "iterm";
  }
  return "ansi";
})();

// Only the kitty protocol can pin an image to a screen cell (ghostty and kitty speak it);
// iTerm's and the half-block fallback only flow inline with the text.
export const canPlaceImages = imageProtocol === "kitty";

export type ImageBox = { col: number; row: number; cols: number; rows: number };

// A terminal cell is about twice as tall as it is wide; the fit assumes that ratio
// because the true cell size in pixels is not knowable without a terminal query.
const CELL_ASPECT = 2;

export function placeImage(png: Buffer, box: ImageBox): void {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  let cols = box.cols;
  let rows = Math.max(1, Math.round(((height / width) * cols) / CELL_ASPECT));
  if (rows > box.rows) {
    rows = box.rows;
    cols = Math.max(1, Math.round((width / height) * rows * CELL_ASPECT));
  }
  const data = png.toString("base64");
  // Same image id every time, so the previous placement goes before the new one lands;
  // q=2 keeps the terminal from answering on stdin, where a readline would read it.
  let out = `\x1b_Ga=d,d=I,i=1,q=2\x1b\\\x1b[${box.row};${box.col}H`;
  for (let i = 0; i < data.length; i += 4096) {
    const first = i === 0 ? `a=T,f=100,i=1,q=2,C=1,c=${cols},r=${rows},` : "";
    const more = i + 4096 < data.length ? 1 : 0;
    out += `\x1b_G${first}m=${more};${data.slice(i, i + 4096)}\x1b\\`;
  }
  process.stdout.write(out);
}

export function clearImages(): void {
  process.stdout.write("\x1b_Ga=d,d=A,q=2\x1b\\");
}

export function renderImage(png: Buffer): void {
  const cols = process.stdout.columns ?? 80;
  if (imageProtocol === "kitty") {
    const data = png.toString("base64");
    for (let i = 0; i < data.length; i += 4096) {
      const first = i === 0 ? `a=T,f=100,c=${cols},` : "";
      const more = i + 4096 < data.length ? 1 : 0;
      process.stdout.write(`\x1b_G${first}m=${more};${data.slice(i, i + 4096)}\x1b\\`);
    }
    process.stdout.write("\n");
    return;
  }
  if (imageProtocol === "iterm") {
    process.stdout.write(`\x1b]1337;File=inline=1;size=${png.length};width=100%:${png.toString("base64")}\x07\n`);
    return;
  }
  const image = decodePng(png);
  const outCols = Math.min(cols, image.width);
  const scale = image.width / outCols;
  const outRows = Math.round(image.height / scale);
  let text = "";
  for (let row = 0; row < outRows; row += 2) {
    for (let col = 0; col < outCols; col++) {
      const [r, g, b] = pixelAt(image, col, row, scale);
      text += `\x1b[38;2;${r};${g};${b}m`;
      if (row + 1 < outRows) {
        const [br, bg, bb] = pixelAt(image, col, row + 1, scale);
        text += `\x1b[48;2;${br};${bg};${bb}m▀`;
      } else {
        text += "\x1b[49m▀";
      }
    }
    text += "\x1b[0m\n";
  }
  process.stdout.write(text);
}

type Png = { width: number; height: number; pixels: Buffer };

function pixelAt(image: Png, col: number, row: number, scale: number): [number, number, number] {
  const px = Math.min(image.width - 1, Math.floor((col + 0.5) * scale));
  const py = Math.min(image.height - 1, Math.floor((row + 0.5) * scale));
  const i = (py * image.width + px) * 3;
  return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]];
}

// QEMU's screendump writes a non-interlaced 8-bit RGB PNG; that is the only shape decoded here.
function decodePng(png: Buffer): Png {
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    if (type === "IHDR") {
      width = png.readUInt32BE(offset + 8);
      height = png.readUInt32BE(offset + 12);
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
  if (bitDepth !== 8 || colorType !== 2 || interlace !== 0) {
    throw new Error(`unsupported png: bit depth ${bitDepth}, color type ${colorType}, interlace ${interlace}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const pixels = Buffer.allocUnsafe(height * stride);
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
        throw new Error(`bad png filter ${filter}`);
      }
      pixels[rowOut + x] = unfiltered & 0xff;
    }
  }
  return { width, height, pixels };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}
