// The oligarchy CLI: a main file, not a library. It drives the oligarchy
// control plane (src/qemu/proxy.ts) over HTTP.
//
//   node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> start [--iso <path>] [--disk <path>]
//   node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> get-image <id> [-o file]
//   node --experimental-strip-types src/qemu/cli.ts --agent-id <agent> send-keys <id> <keys> [encoding]
//
// The server address comes from OLIGARCHY_ADDR (default 127.0.0.1:42069).
// --agent-id leads every invocation: this client is driven by agents, not
// humans, and every request names the agent so the server can attribute the
// session's actions to it.

import { stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_ADDR = "127.0.0.1:42069";
const DEFAULT_ISO = "omarchy.iso";
const DEFAULT_ENCODING = "oligarchy";

async function main(args: string[]): Promise<void> {
  // --agent-id leads every invocation. This client is used by agents, not
  // humans; a request that names no agent has no business being sent.
  if (args.length < 3 || args[0] !== "--agent-id" || args[1] === "") {
    usage();
    process.exitCode = 2;
    return;
  }
  const agent = args[1];
  try {
    switch (args[2]) {
      case "start":
        await cmdStart(agent, args.slice(3));
        break;
      case "get-image":
        await cmdGetImage(agent, args.slice(3));
        break;
      case "send-keys":
        await cmdSendKeys(agent, args.slice(3));
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
  console.error(`oligarchy is the client for the oligarchy proxy

Usage:
  oligarchy --agent-id <agent> start [--iso <path>] [--disk <path>]
  oligarchy --agent-id <agent> get-image <id> [-o file]
  oligarchy --agent-id <agent> send-keys <id> <keys> [encoding]
`);
}

function addr(): string {
  return process.env.OLIGARCHY_ADDR || DEFAULT_ADDR;
}

async function cmdStart(agent: string, args: string[]): Promise<void> {
  if (args.length % 2 !== 0) {
    throw new Error("usage: oligarchy --agent-id <agent> start [--iso <path>] [--disk <path>]");
  }
  let iso = "";
  let disk = "";
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === "--iso") {
      iso = args[i + 1];
    } else if (args[i] === "--disk") {
      disk = args[i + 1];
    } else {
      throw new Error("usage: oligarchy --agent-id <agent> start [--iso <path>] [--disk <path>]");
    }
  }
  iso = iso === "" ? DEFAULT_ISO : iso;
  // An http(s) iso is the server's to download and cache; only a file path
  // is resolved and checked here.
  if (!iso.startsWith("http://") && !iso.startsWith("https://")) {
    iso = resolve(iso);
    try {
      await stat(iso);
    } catch (err) {
      throw new Error(`iso: ${errorMessage(err)}`);
    }
  }
  const out = JSON.parse(
    await postJSON("/start", {
      iso,
      // An undefined disk is left out of the JSON, so the server creates one.
      disk: disk === "" ? undefined : resolve(disk),
      agent,
    }),
  ) as QemuStartResult;
  console.log(out.id);
}

async function cmdGetImage(agent: string, args: string[]): Promise<void> {
  // The three accepted forms: <id>, <id> -o <file>, and -o <file> <id>.
  let id = "";
  let out = "";
  if (args.length === 1) {
    id = args[0];
  } else if (args.length === 3 && args[1] === "-o") {
    id = args[0];
    out = args[2];
  } else if (args.length === 3 && args[0] === "-o") {
    out = args[1];
    id = args[2];
  } else {
    throw new Error("usage: oligarchy --agent-id <agent> get-image <id> [-o file]");
  }
  const res = await fetch(`http://${addr()}/image?id=${encodeURIComponent(id)}&agent=${encodeURIComponent(agent)}`);
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

async function cmdSendKeys(agent: string, args: string[]): Promise<void> {
  if (args.length < 2 || args.length > 3) {
    throw new Error("usage: oligarchy --agent-id <agent> send-keys <id> <keys> [encoding]");
  }
  const encoding = args.length === 3 ? args[2] : DEFAULT_ENCODING;
  await postJSON("/send-keys", { id: args[0], keys: args[1], encoding, agent });
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

// The server writes errors as {"error": "..."}; anything else (a proxy in
// the way, a wrong port) falls back to the raw body.
async function readAPIError(res: Response): Promise<string> {
  const data = await res.text();
  try {
    return (JSON.parse(data) as { error: string }).error;
  } catch {
    return data || "request failed";
  }
}

function errorMessage(err: unknown): string {
  const e = err as Error;
  // Node's fetch buries the useful detail (ECONNREFUSED etc.) in the cause.
  return e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message;
}

await main(process.argv.slice(2));
