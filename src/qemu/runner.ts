#!/usr/bin/env -S node --experimental-strip-types
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

if (existsSync(".env")) {
  loadEnvFile();
}

if (process.env.OLIGARCHY_TOKEN === undefined || process.env.OLIGARCHY_TOKEN === "") {
  console.error("OLIGARCHY_TOKEN is not set");
  process.exit(1);
}

if (process.argv.length > 3 || process.argv[2]?.startsWith("-") === true) {
  console.error("usage: ./runner [server-url]");
  process.exit(1);
}

const serverUrl = process.argv[2] ?? "http://127.0.0.1:42069";
const agentId = `runner-${randomUUID().slice(0, 8)}`;
const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

let sessionId: string | undefined;
let intentOpen = false;
let running: ChildProcess | undefined;
let shuttingDown = false;

const COMMANDS = ["start", "get-image", "get-serial", "send-keys", "send-mouse", "intent", "stop", "status", "help", "exit", "quit"];
const STOP_STATUSES = ["succeeded", "failed", "aborted"];

function completer(line: string): [string[], string] {
  const intentArg = /^\s*intent\s+(\S*)$/.exec(line);
  if (intentArg !== null) {
    return [["start", "end"].filter((word) => word.startsWith(intentArg[1])), intentArg[1]];
  }
  const stopArg = /^\s*stop\s+(\S*)$/.exec(line);
  if (stopArg !== null) {
    return [STOP_STATUSES.filter((word) => word.startsWith(stopArg[1])), stopArg[1]];
  }
  const word = line.trimStart();
  if (/\s/.test(word)) {
    return [[], line];
  }
  return [COMMANDS.filter((command) => command.startsWith(word)), word];
}

const rl = createInterface({ input: process.stdin, output: process.stdout, completer });
rl.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

const pending: string[] = [];
let closed = false;
let notify: (() => void) | undefined;
rl.on("line", (line) => {
  pending.push(line);
  notify?.();
});
rl.on("close", () => {
  closed = true;
  notify?.();
});

// Piped input can close stdin while lines are still queued; drain them before shutting down.
async function nextLine(): Promise<string | undefined> {
  for (;;) {
    const line = pending.shift();
    if (line !== undefined) {
      return line;
    }
    if (closed) {
      return undefined;
    }
    await new Promise<void>((resolve) => {
      notify = resolve;
    });
    notify = undefined;
  }
}

type ClientResult = { code: number; stdout: Buffer; stderr: string };

function runClient(args: string[]): Promise<ClientResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", cliPath, "--agent-id", agentId, "--server-url", serverUrl, ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    running = child;
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (cause) => {
      running = undefined;
      reject(cause);
    });
    child.on("close", (code) => {
      running = undefined;
      resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8").trim() });
    });
  });
}

function requireSession(): string | undefined {
  if (sessionId === undefined) {
    console.log("no session. run start first.");
  }
  return sessionId;
}

function unquote(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
}

function errorMessage(cause: unknown): string {
  const error = cause as Error;
  // Node's fetch and spawn bury the useful detail in the cause.
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

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

function renderImage(png: Buffer): void {
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
    process.stdout.write(`\x1b]1337;File=inline=1;size=${png.length};width=100%;preserveAspectRatio=1:${png.toString("base64")}\x07\n`);
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

type Png = { width: number; height: number; channels: number; pixels: Buffer };

function pixelAt(image: Png, col: number, row: number, scale: number): [number, number, number] {
  const px = Math.min(image.width - 1, Math.floor((col + 0.5) * scale));
  const py = Math.min(image.height - 1, Math.floor((row + 0.5) * scale));
  const i = (py * image.width + px) * image.channels;
  return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]];
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// QEMU's screendump writes non-interlaced 8-bit RGB; that is the only shape decoded here.
function decodePng(png: Buffer): Png {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a png");
  }
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
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(`unsupported png: bit depth ${bitDepth}, color type ${colorType}, interlace ${interlace}`);
  }
  const channels = colorType === 2 ? 3 : 4;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.allocUnsafe(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[rowIn + x];
      const left = x >= channels ? pixels[rowOut + x - channels] : 0;
      const up = y > 0 ? pixels[rowOut + x - stride] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[rowOut + x - stride - channels] : 0;
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
  return { width, height, channels, pixels };
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

async function dispatch(line: string): Promise<void> {
  const command = line.split(/\s+/, 1)[0];
  const rest = line.slice(command.length).trim();
  switch (command) {
    case "start": {
      if (sessionId !== undefined) {
        console.log(`session ${sessionId} is already running. stop it first.`);
        return;
      }
      const words = rest === "" ? [] : rest.split(/\s+/);
      if (words.length > 2) {
        console.log("usage: start [iso] [disk]");
        return;
      }
      const args = ["start"];
      if (words.length >= 1) {
        args.push("--iso", words[0]);
      }
      if (words.length === 2) {
        args.push("--disk", words[1]);
      }
      console.log("booting; a first-time iso download can take a while...");
      const result = await runClient(args);
      if (result.code !== 0) {
        console.log(result.stderr);
        return;
      }
      sessionId = result.stdout.toString("utf8").trim();
      intentOpen = false;
      console.log(`session ${sessionId}`);
      return;
    }
    case "get-image": {
      const id = requireSession();
      if (id === undefined) {
        return;
      }
      const result = await runClient(["get-image", id]);
      if (result.code !== 0) {
        console.log(result.stderr);
        return;
      }
      renderImage(result.stdout);
      return;
    }
    case "get-serial": {
      const id = requireSession();
      if (id === undefined) {
        return;
      }
      const result = await runClient(["get-serial", id]);
      if (result.code !== 0) {
        console.log(result.stderr);
        return;
      }
      const text = result.stdout.toString("utf8");
      console.log(text === "" ? "(serial is empty)" : text);
      return;
    }
    case "send-keys": {
      const id = requireSession();
      if (id === undefined) {
        return;
      }
      if (rest === "") {
        console.log("usage: send-keys <keys>");
        return;
      }
      const result = await runClient(["send-keys", id, unquote(rest)]);
      console.log(result.code === 0 ? "ok" : result.stderr);
      return;
    }
    case "send-mouse": {
      const id = requireSession();
      if (id === undefined) {
        return;
      }
      const words = rest === "" ? [] : rest.split(/\s+/);
      if (words.length < 2 || words.length > 4) {
        console.log("usage: send-mouse <x> <y> [button] [clicks]");
        return;
      }
      const result = await runClient(["send-mouse", id, ...words]);
      console.log(result.code === 0 ? "ok" : result.stderr);
      return;
    }
    case "intent": {
      const id = requireSession();
      if (id === undefined) {
        return;
      }
      const sub = rest.split(/\s+/, 1)[0];
      const message = rest.slice(sub.length).trim();
      if (sub === "start") {
        if (message === "") {
          console.log("usage: intent start <message>");
          return;
        }
        const result = await runClient(["intent", "start", "--session_id", id, "--test_result_id", "manual", "--message", unquote(message)]);
        if (result.code !== 0) {
          console.log(result.stderr);
          return;
        }
        intentOpen = true;
        console.log("ok");
        return;
      }
      if (sub === "end") {
        if (message !== "") {
          console.log("usage: intent end");
          return;
        }
        const result = await runClient(["intent", "end", "--session_id", id]);
        if (result.code !== 0) {
          console.log(result.stderr);
          return;
        }
        intentOpen = false;
        console.log("ok");
        return;
      }
      console.log("usage: intent start <message> | intent end");
      return;
    }
    case "stop": {
      const id = requireSession();
      if (id === undefined) {
        return;
      }
      const words = rest === "" ? [] : rest.split(/\s+/);
      const status = words[0];
      if (status !== undefined && !STOP_STATUSES.includes(status)) {
        console.log("usage: stop [succeeded|failed|aborted] [reason]");
        return;
      }
      const args = ["stop", id];
      if (status !== undefined) {
        args.push(status);
        const reason = rest.slice(status.length).trim();
        if (reason !== "") {
          args.push(unquote(reason));
        }
      }
      const result = await runClient(args);
      if (result.code !== 0) {
        console.log(result.stderr);
        return;
      }
      sessionId = undefined;
      intentOpen = false;
      console.log(`stopped ${id}`);
      return;
    }
    case "status": {
      console.log(`agent   ${agentId}`);
      console.log(`server  ${serverUrl}`);
      console.log(`session ${sessionId ?? "none"}`);
      console.log(`intent  ${intentOpen ? "open" : "none"}`);
      return;
    }
    case "help": {
      console.log("start [iso] [disk]                    boot a qemu session (default iso: omarchy.iso)");
      console.log("get-image                             show the guest display inline");
      console.log("get-serial                            print the guest serial console");
      console.log("send-keys <keys>                      type into the guest, e.g. send-keys hello<ENTER>");
      console.log("send-mouse <x> <y> [button] [clicks]  move, click, or scroll; x and y are 0..1 fractions");
      console.log("intent start <message>                declare what you are about to do");
      console.log("intent end                            close the open intent");
      console.log("stop [status] [reason]                stop the session; status is succeeded, failed, or aborted");
      console.log("status                                show agent, server, session, and intent");
      console.log("exit                                  stop the session and leave");
      return;
    }
    case "exit":
    case "quit": {
      await shutdown();
      return;
    }
    default: {
      console.log(`unknown command: ${command}. tab lists commands; help explains them.`);
    }
  }
}

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  rl.close();
  if (running !== undefined) {
    running.kill();
  }
  if (sessionId !== undefined) {
    if (intentOpen) {
      const ended = await runClient(["intent", "end", "--session_id", sessionId]);
      if (ended.code !== 0) {
        console.log(ended.stderr);
      }
    }
    console.log(`stopping session ${sessionId}`);
    const result = await runClient(["stop", sessionId]);
    console.log(result.code === 0 ? "stopped" : result.stderr);
  }
  process.exit(0);
}

function promptText(): string {
  return sessionId === undefined ? "runner> " : `runner ${sessionId.slice(0, 8)}> `;
}

console.log(`agent  ${agentId}`);
console.log(`server ${serverUrl}`);
console.log('tab lists commands, "help" explains them, "exit" stops the session and leaves');

for (;;) {
  if (shuttingDown) {
    break;
  }
  rl.setPrompt(promptText());
  rl.prompt();
  const line = (await nextLine())?.trim();
  if (line === undefined) {
    await shutdown();
    break;
  }
  if (line === "") {
    continue;
  }
  try {
    await dispatch(line);
  } catch (cause) {
    console.log(errorMessage(cause));
  }
}
