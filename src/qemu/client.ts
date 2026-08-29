import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSONStreamParser } from "../qmp/json-stream.ts";

const QEMU_BIN = "qemu-system-x86_64";
const QEMU_IMG = "qemu-img";
const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
export const DEFAULT_ISO = join(PROJECT_ROOT, "omarchy.iso");
const DEFAULT_DISK_SIZE = "40G";
const DEFAULT_CODE = "/usr/share/edk2/x64/OVMF_CODE.4m.fd";
const DEFAULT_VARS = "/usr/share/edk2/x64/OVMF_VARS.4m.fd";
const DEFAULT_MEMORY = "4G";
const DEFAULT_SMP = 2;
const DEFAULT_MACHINE = "q35,accel=kvm";
const DEFAULT_CPU = "host";
const HANDSHAKE_MS = 10_000;
// The QMP greeting carries no command id; its waiter lives in the pending map
// under this key. Command ids count up from 1, so they never collide.
const GREETING_ID = -1;

export type QemuOptions = {
  tmp?: string;
  diskSize?: string;
  code?: string;
  vars?: string;
  memory?: string;
  smp?: number;
};

export type QemuStartOptions = {
  disk?: string;
  iso?: string;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

export type Qemu = {
  readonly id: string;
  readonly dir: string;
  readonly diskPath: string;
  readonly sockPath: string;
  readonly options: QemuOptions;
  readonly pending: Map<number, Pending>;
  nextId: number;
  proc?: ChildProcess;
  server?: Server;
  socket?: Socket;
};

export function createQemu(options: QemuOptions = {}): Qemu {
  const id = randomUUID();
  const dir = join(options.tmp ?? tmpdir(), `oligarchy-${id}`);
  return {
    id,
    dir,
    diskPath: join(dir, "disk.qcow2"),
    sockPath: join(dir, "qmp.sock"),
    options,
    pending: new Map(),
    nextId: 0,
  };
}

/** Creates the backing qcow2 at diskPath inside the session dir. */
export async function createDisk(qemu: Qemu): Promise<string> {
  await mkdir(qemu.dir, { recursive: true, mode: 0o700 });
  const size = qemu.options.diskSize ?? DEFAULT_DISK_SIZE;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(QEMU_IMG, ["create", "-f", "qcow2", qemu.diskPath, size], {
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`qemu-img create exited ${code}`));
      }
    });
  });
  return qemu.diskPath;
}

/**
 * Launches QEMU and negotiates QMP over the session socket.
 * The session dir must already exist; createDisk creates it.
 */
export async function start(
  qemu: Qemu,
  options: QemuStartOptions = {},
): Promise<QemuStartResult> {
  if (qemu.socket !== undefined) {
    throw new Error("qemu: already started");
  }

  const disk = options.disk ?? qemu.diskPath;
  await assertFile(disk, "disk");
  const iso = options.iso ?? DEFAULT_ISO;
  await assertFile(iso, "iso");

  const varsPath = join(qemu.dir, "OVMF_VARS.fd");
  await copyFile(qemu.options.vars ?? DEFAULT_VARS, varsPath);
  const args = qemuArgs({
    sockPath: qemu.sockPath,
    varsPath,
    diskPath: disk,
    iso,
    code: qemu.options.code ?? DEFAULT_CODE,
    memory: qemu.options.memory ?? DEFAULT_MEMORY,
    smp: qemu.options.smp ?? DEFAULT_SMP,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("qemu: handshake timeout")), HANDSHAKE_MS);
  });

  try {
    const socket = await Promise.race([listenAndSpawn(qemu, args), timeout]);
    qemu.socket = socket;

    const greeting = new Promise<unknown>((resolve, reject) => {
      qemu.pending.set(GREETING_ID, { resolve, reject });
    });
    const parser = new JSONStreamParser();
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      try {
        onData(qemu, parser, chunk);
      } catch (err) {
        failAll(qemu, err);
        socket.destroy();
      }
    });
    socket.on("error", (err) => failAll(qemu, err));
    socket.on("close", () => failAll(qemu, new Error("qemu: socket closed")));

    await Promise.race([greeting, timeout]);
    await Promise.race([execute(qemu, "qmp_capabilities", {}), timeout]);
    return { id: qemu.id };
  } catch (err) {
    teardown(qemu, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function stop(qemu: Qemu): Promise<void> {
  teardown(qemu, new Error("qemu: closed"));
  await rm(qemu.dir, { recursive: true, force: true });
}

export async function sendKey(qemu: Qemu, keys: QemuKeyValue[]): Promise<void> {
  await execute(qemu, "send-key", { keys });
}

export async function screendump(qemu: Qemu, filename: string, format = "png"): Promise<void> {
  await execute(qemu, "screendump", { filename, format });
}

function qemuArgs(opts: {
  sockPath: string;
  varsPath: string;
  diskPath: string;
  iso: string;
  code: string;
  memory: string;
  smp: number;
}): string[] {
  return [
    "-machine",
    DEFAULT_MACHINE,
    "-cpu",
    DEFAULT_CPU,
    "-m",
    opts.memory,
    "-smp",
    String(opts.smp),
    "-drive",
    `if=pflash,format=raw,readonly=on,file=${opts.code}`,
    "-drive",
    `if=pflash,format=raw,file=${opts.varsPath}`,
    "-display",
    "gtk",
    "-chardev",
    `socket,id=qmp,path=${opts.sockPath}`,
    "-mon",
    "chardev=qmp,mode=control",
    "-cdrom",
    opts.iso,
    "-boot",
    "order=d",
    "-drive",
    `file=${opts.diskPath},if=virtio,format=qcow2`,
  ];
}

async function execute(qemu: Qemu, name: string, args: unknown): Promise<unknown> {
  const socket = qemu.socket;
  if (socket === undefined) {
    throw new Error("qemu: closed");
  }
  const id = ++qemu.nextId;
  return new Promise((resolve, reject) => {
    qemu.pending.set(id, { resolve, reject });
    socket.write(`${JSON.stringify({ execute: name, arguments: args, id })}\n`);
  });
}

function onData(qemu: Qemu, parser: JSONStreamParser, chunk: string): void {
  parser.push(chunk);
  for (let msg = parser.pull(); msg !== undefined; msg = parser.pull()) {
    if ("QMP" in msg) {
      qemu.pending.get(GREETING_ID)?.resolve(msg);
      qemu.pending.delete(GREETING_ID);
      continue;
    }
    if ("event" in msg) {
      continue;
    }
    const id = Number(msg.id);
    const pending = qemu.pending.get(id);
    if (pending === undefined) {
      continue;
    }
    qemu.pending.delete(id);
    if ("error" in msg) {
      pending.reject(new Error(`${msg.error.class}: ${msg.error.desc}`));
    } else {
      pending.resolve(msg.return);
    }
  }
}

function listenAndSpawn(qemu: Qemu, args: string[]): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    qemu.server = server;
    server.once("error", reject);
    server.once("connection", resolve);
    server.listen(qemu.sockPath, () => {
      const proc = spawn(QEMU_BIN, args, { stdio: "ignore" });
      qemu.proc = proc;
      proc.once("error", (err) => reject(new Error(`qemu: ${err.message}`)));
      proc.once("exit", (code) => reject(new Error(`qemu: exited ${code} before QMP connect`)));
    });
  });
}

/** Rejects every in-flight command (and the greeting waiter) with err. */
function failAll(qemu: Qemu, err: unknown): void {
  for (const pending of qemu.pending.values()) {
    pending.reject(err);
  }
  qemu.pending.clear();
}

/** failAll, then discard the socket, server, and process. */
function teardown(qemu: Qemu, err: unknown): void {
  failAll(qemu, err);
  qemu.socket?.destroy();
  qemu.socket = undefined;
  qemu.server?.close();
  qemu.server = undefined;
  qemu.proc?.kill();
  qemu.proc = undefined;
}

async function assertFile(path: string, label: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    throw new Error(`qemu: ${label} not found: ${path}`);
  }
}
