import { PassThrough } from "node:stream";
import type * as Readline from "../../src/session/readline.ts";

export type FakeTty = {
  readonly input: Readline.Input & PassThrough;
  readonly output: Readline.Output & PassThrough;
  // Everything written to the output so far, decoded as utf8.
  readonly written: () => string;
  // Feed bytes to the input as a terminal would.
  readonly type: (text: string) => void;
  // Close the input, as a terminal hangup or a closed pipe does.
  readonly end: () => void;
  // Emit one parsed keypress, as `emitKeypressEvents` would after decoding the bytes.
  readonly keypress: (text: string | undefined, key: Readline.Key) => void;
};

// A Readable/Writable pair that looks like a terminal to readline, the picker and the follow
// view: `isTTY`, `columns` and `rows` are what they read; nothing else of a real tty is needed.
export const fakeTty = (
  options: { readonly columns?: number; readonly rows?: number; readonly isTTY?: boolean } = {},
): FakeTty => {
  const isTTY = options.isTTY ?? true;
  const input = Object.assign(new PassThrough(), {
    isTTY,
    isRaw: false,
    setRawMode(mode: boolean) {
      this.isRaw = mode;
      return this;
    },
  });
  const output = Object.assign(new PassThrough(), {
    isTTY,
    columns: options.columns ?? 100,
    rows: options.rows ?? 24,
  });
  let written = "";
  output.setEncoding("utf8");
  output.on("data", (data: string) => {
    written += data;
  });
  return {
    input,
    output,
    written: () => written,
    type: (text) => {
      input.write(text);
    },
    end: () => {
      input.end();
    },
    keypress: (text, key) => {
      input.emit("keypress", text, key);
    },
  };
};

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
// CSI sequences, kitty graphics commands and OSC strings.
const ANSI = new RegExp(
  `${ESC}\\[[0-9;?]*[A-Za-z]|${ESC}_G[^${ESC}]*${ESC}\\\\|${ESC}\\][^${BEL}]*${BEL}`,
  "g",
);

export const stripAnsi = (text: string): string => text.replace(ANSI, "");
