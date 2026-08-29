// The oligarchy CLI: a main file, not a library. The TypeScript twin of
// cmd/oligarchy-client, it drives an oligarchy control plane (the Go
// oligarchy-server or src/qemu/proxy.ts) over HTTP.
//
//   node --experimental-strip-types src/qemu/cli.ts start [iso] [disk]
//   node --experimental-strip-types src/qemu/cli.ts get-image <id> [-o file]
//   node --experimental-strip-types src/qemu/cli.ts send-keys <id> <keys> [encoding]
//
// start also takes flags ahead of the positionals: -iso, -disk, -disk-size,
// -vars, -code, -m (memory), -smp. The server address comes from
// OLIGARCHY_ADDR (default 127.0.0.1:42069).

import { stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_ADDR = "127.0.0.1:42069";
const DEFAULT_ISO = "omarchy.iso";
const DEFAULT_ENCODING = "oligarchy";

// The POST /start request body, mirroring the Go LaunchConfig JSON shape.
// Every field is always sent, zero values included, exactly like Go.
type LaunchConfig = {
  iso: string;
  disk: string;
  disk_size: string;
  code: string;
  vars: string;
  memory: string;
  smp: number;
};

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
  const env = process.env.OLIGARCHY_ADDR;
  if (env !== undefined && env !== "") {
    return env;
  }
  return DEFAULT_ADDR;
}

const START_FLAGS: readonly string[] = ["iso", "disk", "disk-size", "vars", "code", "m", "smp"];

async function parseStartArgs(args: string[]): Promise<LaunchConfig> {
  const { flags, positionals } = parseFlags(args, START_FLAGS);
  let iso = flags.get("iso") ?? "";
  let disk = flags.get("disk") ?? "";
  let rest = positionals;
  if (iso === "" && rest.length > 0) {
    iso = rest[0];
    rest = rest.slice(1);
  }
  if (disk === "" && rest.length > 0) {
    disk = rest[0];
    rest = rest.slice(1);
  }
  if (rest.length !== 0) {
    throw new Error("usage: oligarchy start [iso] [disk]");
  }
  if (iso === "") {
    iso = DEFAULT_ISO;
  }
  iso = resolve(iso);
  try {
    await stat(iso);
  } catch (err) {
    throw new Error(`iso: ${errorMessage(err)}`);
  }
  if (disk !== "") {
    disk = resolve(disk);
  }
  return {
    iso,
    disk,
    disk_size: flags.get("disk-size") ?? "",
    code: flags.get("code") ?? "",
    vars: flags.get("vars") ?? "",
    memory: flags.get("m") ?? "",
    smp: parseSmp(flags.get("smp") ?? "0"),
  };
}

// Parses -smp the way Go's flag package parses an int flag.
function parseSmp(value: string): number {
  if (!/^[+-]?\d+$/.test(value)) {
    throw new Error(`invalid value "${value}" for flag -smp: parse error`);
  }
  return Number(value);
}

async function cmdStart(args: string[]): Promise<void> {
  const cfg = await parseStartArgs(args);
  const out = JSON.parse(await postJSON("/start", cfg)) as Partial<QemuStartResult>;
  console.log(out.id ?? "");
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
  await new Promise<void>((resolveWrite, reject) => {
    process.stdout.write(data, (err) => {
      if (err === undefined || err === null) {
        resolveWrite();
      } else {
        reject(err);
      }
    });
  });
}

async function cmdSendKeys(args: string[]): Promise<void> {
  const { positionals } = parseFlags(args, []);
  if (positionals.length < 2 || positionals.length > 3) {
    throw new Error("usage: oligarchy send-keys <id> <keys> [encoding]");
  }
  const encoding = positionals.length === 3 ? positionals[2] : DEFAULT_ENCODING;
  await postJSON("/send-keys", {
    id: positionals[0],
    keys: positionals[1],
    encoding,
  });
}

type ParsedArgs = {
  flags: Map<string, string>;
  positionals: string[];
};

// Parses leading -flag/--flag args the way Go's flag package does: parsing
// stops at the first non-flag argument or a bare "--", values come from
// "-flag=value" or the next argument, and unknown flags are an error.
function parseFlags(args: string[], defined: readonly string[]): ParsedArgs {
  const flags = new Map<string, string>();
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.length < 2 || !arg.startsWith("-")) {
      break;
    }
    let name = arg.slice(1);
    if (name.startsWith("-")) {
      if (name === "-") {
        i++;
        break;
      }
      name = name.slice(1);
    }
    if (name.startsWith("-") || name.startsWith("=")) {
      throw new Error(`bad flag syntax: ${arg}`);
    }
    i++;
    let value: string | undefined;
    const eq = name.indexOf("=");
    if (eq !== -1) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (!defined.includes(name)) {
      if (name === "help" || name === "h") {
        throw new Error("flag: help requested");
      }
      throw new Error(`flag provided but not defined: -${name}`);
    }
    if (value === undefined) {
      if (i >= args.length) {
        throw new Error(`flag needs an argument: -${name}`);
      }
      value = args[i];
      i++;
    }
    flags.set(name, value);
  }
  return { flags, positionals: args.slice(i) };
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
  let data: string;
  try {
    data = await res.text();
  } catch (err) {
    return errorMessage(err);
  }
  try {
    const body = JSON.parse(data) as { error?: unknown } | null;
    if (body !== null && typeof body.error === "string" && body.error !== "") {
      return body.error;
    }
  } catch {
    // Not JSON: fall through to the raw body.
  }
  if (data.length > 0) {
    return data;
  }
  return "request failed";
}

function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }
  // Node's fetch buries the useful detail (ECONNREFUSED etc.) in the cause.
  if (err.cause instanceof Error && err.cause.message !== "") {
    return `${err.message}: ${err.cause.message}`;
  }
  return err.message;
}

await main(process.argv.slice(2));
