import { readFile, rm } from "node:fs/promises";
import { connect as netConnect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSONStreamParser } from "../qmp/json-stream.ts";
import { parseKeys } from "./keys.ts";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

export type QemuProxy = {
  readonly greeting: QemuGreetingResponse;
  readonly pending: Map<number | "greeting", Pending>;
  nextId: number;
  socket?: Socket;
};

/** Dials a QMP unix socket and completes the QMP handshake. */
export async function connect(path: string): Promise<QemuProxy> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const sock = netConnect(path);
    sock.once("connect", () => resolve(sock));
    sock.once("error", reject);
  });
  return fromSocket(socket);
}

/**
 * Takes a connected QMP socket, reads the greeting, and completes
 * capabilities negotiation.
 */
export async function fromSocket(socket: Socket): Promise<QemuProxy> {
  const pending = new Map<number | "greeting", Pending>();
  const greeting = new Promise<unknown>((resolve, reject) => {
    pending.set("greeting", { resolve, reject });
  });

  const parser = new JSONStreamParser();
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    try {
      parser.push(chunk);
      for (let msg = parser.pull(); msg !== undefined; msg = parser.pull()) {
        if ("QMP" in msg) {
          pending.get("greeting")?.resolve(msg);
          pending.delete("greeting");
          continue;
        }
        if ("event" in msg) {
          continue;
        }
        const id = msg.id as number;
        const entry = pending.get(id);
        if (entry === undefined) {
          continue;
        }
        pending.delete(id);
        if ("error" in msg) {
          entry.reject(new Error(`${msg.error.class}: ${msg.error.desc}`));
        } else {
          entry.resolve(msg.return);
        }
      }
    } catch (err) {
      failAll(pending, err);
      socket.destroy();
    }
  });
  socket.on("error", (err) => failAll(pending, err));
  socket.on("close", () => failAll(pending, new Error("qemu: socket closed")));

  try {
    const proxy: QemuProxy = {
      greeting: (await greeting) as QemuGreetingResponse,
      pending,
      nextId: 0,
      socket,
    };
    await execute(proxy, "qmp_capabilities");
    return proxy;
  } catch (err) {
    failAll(pending, err);
    socket.destroy();
    throw err;
  }
}

/** Closes the QMP connection; in-flight commands reject. */
export function close(proxy: QemuProxy): void {
  failAll(proxy.pending, new Error("qemu: closed"));
  proxy.socket?.destroy();
  proxy.socket = undefined;
}

/** Sends a named QMP command and returns its result. */
export async function execute(proxy: QemuProxy, name: string, args?: unknown): Promise<unknown> {
  const socket = proxy.socket;
  if (socket === undefined) {
    throw new Error("qemu: closed");
  }
  const id = ++proxy.nextId;
  return new Promise((resolve, reject) => {
    proxy.pending.set(id, { resolve, reject });
    // JSON.stringify drops "arguments" when args is undefined.
    socket.write(`${JSON.stringify({ execute: name, arguments: args, id })}\n`);
  });
}

/** Captures the current guest display as a PNG. */
export async function readImage(proxy: QemuProxy): Promise<Buffer> {
  const path = join(tmpdir(), `oligarchy-${process.pid}-${process.hrtime.bigint()}.png`);
  await execute(proxy, "screendump", { filename: path, format: "png" });
  try {
    return await readFile(path);
  } finally {
    await rm(path, { force: true });
  }
}

/** Types keys into the guest using the given key-string encoding. */
export async function sendKeys(proxy: QemuProxy, keys: string, encoding?: string): Promise<void> {
  for (const chord of parseKeys(keys, encoding)) {
    await execute(proxy, "send-key", {
      keys: chord.map((code): QemuKeyValue => ({ type: "qcode", data: code })),
    });
  }
}

function failAll(pending: Map<number | "greeting", Pending>, err: unknown): void {
  for (const entry of pending.values()) {
    entry.reject(err);
  }
  pending.clear();
}
