// The oligarchy CLI: a main file, not a library. The TypeScript twin of
// cmd/oligarchy-client, it drives an oligarchy control plane (the Go
// oligarchy-server or src/qemu/proxy.ts) over HTTP.
//
//   node --experimental-strip-types src/qemu/cli.ts start [iso] [disk]
//   node --experimental-strip-types src/qemu/cli.ts get-image <id> [-o file]
//   node --experimental-strip-types src/qemu/cli.ts send-keys <id> <keys> [encoding]
//
// The server address comes from OLIGARCHY_ADDR (default 127.0.0.1:42069).

import { stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_ADDR = "127.0.0.1:42069";
const DEFAULT_ISO = "omarchy.iso";
const DEFAULT_ENCODING = "oligarchy";

async function main(args: string[]): Promise<void> {
  if (args.length < 1) {
    usage();
    process.exitCode = 2;
    return;
  }
  try {
    switch (args[0]) {
      case "start":
        await cmdStart(args.slice(1));
        break;
      case "get-image":
        await cmdGetImage(args.slice(1));
        break;
      case "send-keys":
        await cmdSendKeys(args.slice(1));
        break;
      default:
        usage();
        process.exitCode = 2;
    }
  } catch (err) {
    console.error(errorMessage(err));
    process.exitCode = 1;
  }
}

function usage(): void {
  console.error(`oligarchy is the client for oligarchy-server

Usage:
  oligarchy start [iso] [disk]
  oligarchy get-image <id> [-o file]
  oligarchy send-keys <id> <keys> [encoding]
`);
}

function addr(): string {
  return process.env.OLIGARCHY_ADDR ?? DEFAULT_ADDR;
}

async function cmdStart(args: string[]): Promise<void> {
  if (args.length > 2) {
    throw new Error("usage: oligarchy start [iso] [disk]");
  }
  const iso = resolve(args.length > 0 ? args[0] : DEFAULT_ISO);
  try {
    await stat(iso);
  } catch (err) {
    throw new Error(`iso: ${errorMessage(err)}`);
  }
  // An undefined disk is left out of the JSON, so the server creates one.
  const disk = args.length === 2 ? resolve(args[1]) : undefined;
  const out = JSON.parse(await postJSON("/start", { iso, disk })) as QemuStartResult;
  console.log(out.id);
}

async function cmdGetImage(args: string[]): Promise<void> {
  let id = "";
  let out = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o" && i + 1 < args.length) {
      out = args[i + 1];
      i++;
      continue;
    }
    if (id === "" && !args[i].startsWith("-")) {
      id = args[i];
      continue;
    }
    throw new Error("usage: oligarchy get-image <id> [-o file]");
  }
  if (id === "") {
    throw new Error("usage: oligarchy get-image <id> [-o file]");
  }
  const res = await fetch(`http://${addr()}/image?id=${encodeURIComponent(id)}`);
  if (res.status !== 200) {
    throw new Error(await readAPIError(res));
  }
  const data = Buffer.from(await res.arrayBuffer());
  if (out !== "") {
    await writeFile(out, data, { mode: 0o644 });
    return;
  }
  await new Promise<void>((done, fail) => {
    process.stdout.write(data, (err) => (err ? fail(err) : done()));
  });
}

async function cmdSendKeys(args: string[]): Promise<void> {
  if (args.length < 2 || args.length > 3) {
    throw new Error("usage: oligarchy send-keys <id> <keys> [encoding]");
  }
  const encoding = args.length === 3 ? args[2] : DEFAULT_ENCODING;
  await postJSON("/send-keys", { id: args[0], keys: args[1], encoding });
}

async function postJSON(path: string, body: unknown): Promise<string> {
  const res = await fetch(`http://${addr()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(await readAPIError(res));
  }
  return res.text();
}

// Extracts {"error": "..."} from a failed response; falls back to the raw
// body, then to a generic message, matching the Go client.
async function readAPIError(res: Response): Promise<string> {
  const data = await res.text();
  try {
    const body = JSON.parse(data) as { error?: unknown };
    if (typeof body.error === "string" && body.error !== "") {
      return body.error;
    }
  } catch {
    // Not JSON: fall through to the raw body.
  }
  if (data !== "") {
    return data;
  }
  return "request failed";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // Node's fetch buries the useful detail (ECONNREFUSED etc.) in the cause.
    return err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message;
  }
  return String(err);
}

await main(process.argv.slice(2));
