import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { loadEnvFile } from "node:process";

if (existsSync(".env")) {
  loadEnvFile();
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:42069";
const DEFAULT_ISO = "omarchy.iso";
const DEFAULT_ENCODING = "oligarchy";
const START_TIMEOUT_MS = 45 * 60 * 1000;

export const CLIENT_ACTIONS = [
  "start",
  "get-image",
  "get-serial",
  "send-keys",
  "send-mouse",
  "intent",
  "stop",
  "help",
  "status",
  "exit",
] as const;

export type RunnerOptions = {
  serverUrl?: string;
  agentId?: string;
  token?: string;
  fetch?: typeof fetch;
  postStart?: (serverUrl: string, body: unknown, token: string) => Promise<string>;
};

export type RunnerState = {
  serverUrl: string;
  agentId: string;
  token: string;
  fetch: typeof fetch;
  postStart: (serverUrl: string, body: unknown, token: string) => Promise<string>;
  sessionId?: string;
  activeIntent?: string;
  testResultId?: string;
  startingPromise?: Promise<string>;
};

export function createRunner(options: RunnerOptions = {}): RunnerState {
  const token = options.token ?? process.env.OLIGARCHY_TOKEN ?? "";
  if (token === "") {
    throw new Error("OLIGARCHY_TOKEN is not set");
  }
  return {
    serverUrl: options.serverUrl ?? DEFAULT_SERVER_URL,
    agentId: options.agentId ?? `runner-${randomUUID().slice(0, 8)}`,
    token,
    fetch: options.fetch ?? globalThis.fetch,
    postStart: options.postStart ?? defaultPostStart,
  };
}

export function formatTerminalImage(data: Buffer): string {
  if (data.length === 0) {
    throw new Error("Cannot display empty image");
  }
  const b64 = data.toString("base64");
  return `\x1b]1337;File=inline=1;width=auto;height=auto:${b64}\x07\n`;
}

export function completeRunnerLine(runner: RunnerState, line: string): [string[], string] {
  const trimmed = line.trimStart();
  const parts = trimmed.split(/\s+/);

  if (parts.length <= 1 && !line.endsWith(" ")) {
    const prefix = parts[0] ?? "";
    const hits = CLIENT_ACTIONS.filter((cmd) => cmd.startsWith(prefix));
    return [hits, prefix];
  }

  const cmd = parts[0];
  if (cmd === "intent") {
    const subcommands = ["start", "end"];
    if (parts.length === 2 && !line.endsWith(" ")) {
      const prefix = parts[1];
      const hits = subcommands.filter((sub) => sub.startsWith(prefix));
      return [hits, prefix];
    }
    if (parts.length === 1 || (parts.length === 2 && line.endsWith(" "))) {
      return [subcommands, ""];
    }
  }

  return [[], ""];
}

function parseArgs(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escape = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) {
    args.push(current);
  }
  return args;
}

function defaultPostStart(serverUrl: string, body: unknown, token: string): Promise<string> {
  const url = new URL(`${serverUrl}/start`);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const payload = JSON.stringify(body);
  return new Promise<string>((resolveReq, reject) => {
    const req = send(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("error", reject);
        res.on("end", () => {
          const status = res.statusCode!;
          if (status >= 200 && status < 300) {
            resolveReq(data);
          } else {
            let message = data;
            try {
              const parsed = JSON.parse(data) as { error?: string };
              if (parsed.error !== undefined) {
                message = parsed.error;
              }
            } catch {}
            reject(new Error(message || "start: request failed"));
          }
        });
      },
    );
    req.setTimeout(START_TIMEOUT_MS, () => req.destroy(new Error("start: no response within timeout")));
    req.on("error", reject);
    req.end(payload);
  });
}

async function requestJson(
  runner: RunnerState,
  path: string,
  method: string,
  body?: unknown,
): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${runner.token}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await runner.fetch(`${runner.serverUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (res.status < 200 || res.status >= 300) {
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error !== undefined) {
        message = parsed.error;
      }
    } catch {}
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  return text;
}

export async function stopRunnerSession(
  runner: RunnerState,
  status?: "succeeded" | "failed" | "aborted",
  reason?: string,
): Promise<string> {
  if (runner.sessionId === undefined) {
    return "No active session.";
  }
  const sessionId = runner.sessionId;

  await requestJson(runner, "/stop", "POST", {
    id: sessionId,
    agent: runner.agentId,
    status,
    reason,
  });

  runner.sessionId = undefined;
  runner.activeIntent = undefined;
  runner.agentId = `runner-${randomUUID().slice(0, 8)}`;
  return `Session ${sessionId} stopped${status !== undefined ? ` (${status}${reason !== undefined ? `: ${reason}` : ""})` : ""}.`;
}

export async function executeRunnerLine(runner: RunnerState, line: string): Promise<string> {
  const trimmed = line.trim();
  if (trimmed === "") {
    return "";
  }

  const parts = parseArgs(trimmed);
  const command = parts[0];

  switch (command) {
    case "help": {
      return [
        "Available actions:",
        "  start [--iso <path|url>] [--disk <path>]  Start a QEMU session",
        "  get-image [-o <path>]                    Capture display and show inline",
        "  get-serial [-o <path>]                   Read guest serial output",
        "  send-keys <keys> [encoding]              Send key string (e.g. 'hello<ENTER>')",
        "  send-mouse <x> <y> [button] [clicks]     Send mouse pointer / click (0..1 coords)",
        "  intent start --message <msg>             Declare intent",
        "  intent <message>                         Declare intent shorthand",
        "  intent end                               Complete active intent",
        "  intent                                   Show current active intent",
        "  stop [status] [reason]                   Stop current QEMU session",
        "  status                                   Show current runner state",
        "  exit / quit                              Stop session and exit runner",
      ].join("\n");
    }

    case "status": {
      return [
        `Server URL:    ${runner.serverUrl}`,
        `Agent ID:      ${runner.agentId}`,
        `Session ID:    ${runner.sessionId ?? "(none)"}`,
        `Active Intent: ${runner.activeIntent ?? "(none)"}`,
      ].join("\n");
    }

    case "start": {
      if (runner.sessionId !== undefined) {
        throw new Error(`A session is already running (${runner.sessionId}). Stop it before starting a new one.`);
      }
      if (runner.startingPromise !== undefined) {
        throw new Error("A session is currently starting. Please wait.");
      }

      let iso = DEFAULT_ISO;
      let disk: string | undefined;

      for (let i = 1; i < parts.length; i++) {
        if (parts[i] === "--iso") {
          if (parts[i + 1] === undefined) {
            throw new Error("Missing value for --iso");
          }
          iso = parts[++i];
        } else if (parts[i].startsWith("--iso=")) {
          const val = parts[i].slice(6);
          if (val === "") {
            throw new Error("Missing value for --iso");
          }
          iso = val;
        } else if (parts[i] === "--disk") {
          if (parts[i + 1] === undefined) {
            throw new Error("Missing value for --disk");
          }
          disk = parts[++i];
        } else if (parts[i].startsWith("--disk=")) {
          const val = parts[i].slice(7);
          if (val === "") {
            throw new Error("Missing value for --disk");
          }
          disk = val;
        } else {
          throw new Error(`Unknown option for start: ${parts[i]}`);
        }
      }

      if (!iso.startsWith("http://") && !iso.startsWith("https://")) {
        iso = resolve(iso);
      }
      if (disk !== undefined) {
        disk = resolve(disk);
      }

      const startPayload: { iso: string; disk?: string; agent: string } = {
        iso,
        agent: runner.agentId,
      };
      if (disk !== undefined) {
        startPayload.disk = disk;
      }

      const starting = runner.postStart(runner.serverUrl, startPayload, runner.token);
      runner.startingPromise = starting;

      let raw: string;
      try {
        raw = await starting;
      } finally {
        runner.startingPromise = undefined;
      }

      const parsed = JSON.parse(raw) as { id: string };
      runner.sessionId = parsed.id;
      return `Session started: ${parsed.id}`;
    }

    case "get-image": {
      if (runner.sessionId === undefined) {
        throw new Error("No active session. Run 'start' first.");
      }

      let outputPath: string | undefined;
      for (let i = 1; i < parts.length; i++) {
        if ((parts[i] === "-o" || parts[i] === "--output") && parts[i + 1] !== undefined) {
          outputPath = parts[++i];
        }
      }

      const headers = { Authorization: `Bearer ${runner.token}` };
      const url = `${runner.serverUrl}/image?id=${encodeURIComponent(runner.sessionId)}&agent=${encodeURIComponent(runner.agentId)}`;
      const res = await runner.fetch(url, { headers });
      if (res.status !== 200) {
        const text = await res.text();
        throw new Error(text || `Failed to get image (${res.status})`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (outputPath !== undefined) {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(resolve(outputPath), buffer);
        return `Image saved to ${outputPath}`;
      }

      return formatTerminalImage(buffer);
    }

    case "get-serial": {
      if (runner.sessionId === undefined) {
        throw new Error("No active session. Run 'start' first.");
      }

      let outputPath: string | undefined;
      for (let i = 1; i < parts.length; i++) {
        if ((parts[i] === "-o" || parts[i] === "--output") && parts[i + 1] !== undefined) {
          outputPath = parts[++i];
        }
      }

      const headers = { Authorization: `Bearer ${runner.token}` };
      const url = `${runner.serverUrl}/serial?id=${encodeURIComponent(runner.sessionId)}&agent=${encodeURIComponent(runner.agentId)}`;
      const res = await runner.fetch(url, { headers });
      if (res.status !== 200) {
        const text = await res.text();
        throw new Error(text || `Failed to get serial (${res.status})`);
      }

      const text = await res.text();
      if (outputPath !== undefined) {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(resolve(outputPath), text);
        return `Serial output saved to ${outputPath}`;
      }
      return text;
    }

    case "send-keys": {
      if (runner.sessionId === undefined) {
        throw new Error("No active session. Run 'start' first.");
      }
      const rawAfterCmd = trimmed.slice(command.length).trim();
      if (rawAfterCmd === "") {
        throw new Error("send-keys requires keys argument (e.g. send-keys \"hello<ENTER>\")");
      }
      let keys = rawAfterCmd;
      if (
        (keys.startsWith('"') && keys.endsWith('"'))
        || (keys.startsWith("'") && keys.endsWith("'"))
      ) {
        keys = keys.slice(1, -1);
      }

      await requestJson(runner, "/send-keys", "POST", {
        id: runner.sessionId,
        keys,
        encoding: DEFAULT_ENCODING,
        agent: runner.agentId,
      });
      return "Keys sent: ok";
    }

    case "send-mouse": {
      if (runner.sessionId === undefined) {
        throw new Error("No active session. Run 'start' first.");
      }
      if (parts[1] === undefined || parts[2] === undefined) {
        throw new Error("send-mouse requires x and y arguments (e.g. send-mouse 0.5 0.5 [button] [clicks])");
      }
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const button = parts[3];
      const clicks = parts[4] !== undefined ? parseInt(parts[4], 10) : undefined;

      await requestJson(runner, "/send-mouse", "POST", {
        id: runner.sessionId,
        x,
        y,
        button,
        clicks,
        agent: runner.agentId,
      });
      return "Mouse event sent: ok";
    }

    case "intent": {
      if (parts.length === 1) {
        return runner.activeIntent !== undefined
          ? `Active intent: "${runner.activeIntent}"`
          : "No active intent.";
      }

      const sub = parts[1];
      if (sub === "start" || (sub !== "end" && parts.length > 1)) {
        if (runner.sessionId === undefined) {
          throw new Error("No active session. Run 'start' first.");
        }
        let message = "";
        let testResultId = runner.testResultId ?? `intent-${Date.now()}`;
        const startIdx = sub === "start" ? 2 : 1;

        for (let i = startIdx; i < parts.length; i++) {
          if (parts[i] === "--message" && parts[i + 1] !== undefined) {
            message = parts[++i];
          } else if (parts[i].startsWith("--message=")) {
            message = parts[i].slice(10);
          } else if (parts[i] === "--test_result_id" && parts[i + 1] !== undefined) {
            testResultId = parts[++i];
          } else if (parts[i].startsWith("--test_result_id=")) {
            testResultId = parts[i].slice(17);
          } else if (message === "") {
            message = parts[i];
          } else {
            message += ` ${parts[i]}`;
          }
        }

        if (message === "") {
          throw new Error("intent requires a message (e.g. intent \"installing OS\" or intent start --message \"installing OS\")");
        }

        await requestJson(runner, "/intent/start", "POST", {
          id: runner.sessionId,
          agent: runner.agentId,
          test_result_id: testResultId,
          message,
        });
        runner.activeIntent = message;
        runner.testResultId = testResultId;
        return `Intent started: "${message}"`;
      }

      if (sub === "end") {
        if (runner.sessionId === undefined) {
          throw new Error("No active session. Run 'start' first.");
        }
        await requestJson(runner, "/intent/end", "POST", {
          id: runner.sessionId,
          agent: runner.agentId,
        });
        const finished = runner.activeIntent;
        runner.activeIntent = undefined;
        return `Intent ended: "${finished ?? ""}"`;
      }

      throw new Error(`Unknown intent subcommand: ${sub}. Use 'intent start' or 'intent end'.`);
    }

    case "stop": {
      if (runner.sessionId === undefined) {
        throw new Error("No active session. Run 'start' first.");
      }
      const status = parts[1] as "succeeded" | "failed" | "aborted" | undefined;
      const reason = parts[2];
      return await stopRunnerSession(runner, status, reason);
    }

    case "exit":
    case "quit": {
      if (runner.sessionId !== undefined) {
        await stopRunnerSession(runner, "aborted", "runner exited");
      }
      return "Goodbye!";
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

export async function runInteractiveSession(serverUrl?: string): Promise<void> {
  const runner = createRunner({ serverUrl });

  let cleanupRunning = false;
  const cleanup = async () => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    if (runner.startingPromise !== undefined) {
      try {
        const raw = await runner.startingPromise;
        const parsed = JSON.parse(raw) as { id: string };
        runner.sessionId = parsed.id;
      } catch {}
    }
    if (runner.sessionId !== undefined) {
      try {
        await stopRunnerSession(runner, "aborted", "runner terminated");
      } catch (err) {
        console.error(`Failed to stop session: ${(err as Error).message}`);
      }
    }
  };

  process.once("SIGINT", () => {
    void cleanup().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void cleanup().then(() => process.exit(0));
  });
  process.once("SIGHUP", () => {
    void cleanup().then(() => process.exit(0));
  });

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
    completer: (line: string) => completeRunnerLine(runner, line),
  });

  rl.prompt();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === "exit" || trimmed === "quit") {
      await cleanup();
      break;
    }

    try {
      const output = await executeRunnerLine(runner, line);
      if (output !== "") {
        console.log(output);
      }
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
    }

    rl.prompt();
  }

  await cleanup();
  rl.close();
}

if (process.argv[1] === import.meta.filename) {
  let serverUrl: string | undefined;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--server-url" && process.argv[i + 1] !== undefined) {
      serverUrl = process.argv[++i];
    } else if (arg.startsWith("--server-url=")) {
      serverUrl = arg.slice(13);
    } else if (!arg.startsWith("-") && serverUrl === undefined) {
      serverUrl = arg;
    }
  }
  await runInteractiveSession(serverUrl);
}
