import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
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
const STDERR_CAP = 8 * 1024;

export type QemuCLIOptions = {
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
  reject: (err: Error) => void;
};

export class QemuCLI {
  readonly id: string;
  readonly diskPath: string;
  readonly sockPath: string;
  #dir: string;
  #opts: QemuCLIOptions;
  #disk: string | undefined;
  #parser = new JSONStreamParser();
  #pending = new Map<number, Pending>();
  #nextId = 0;
  #proc: ChildProcess | undefined;
  #stderr = "";
  #server: Server | undefined;
  #socket: Socket | undefined;
  #greetingResolve: ((msg: QemuGreetingResponse) => void) | undefined;
  #greetingReject: ((err: Error) => void) | undefined;
  #closed = false;

  constructor(options: QemuCLIOptions = {}) {
    this.#opts = options;
    this.id = randomUUID();
    this.#dir = join(options.tmp ?? tmpdir(), `oligarchy-${this.id}`);
    this.diskPath = join(this.#dir, "disk.qcow2");
    this.sockPath = join(this.#dir, "qmp.sock");
  }

  /**
   * Creates the backing qcow2 at diskPath inside the session dir. An
   * existing disk is preserved, matching the Go launcher.
   */
  async createDisk(): Promise<string> {
    if (this.#closed) {
      throw new Error("qemu: closed");
    }
    await this.#ensureDir();
    if (!(await fileExists(this.diskPath))) {
      await qemuImgCreate(this.diskPath, this.#opts.diskSize ?? DEFAULT_DISK_SIZE);
    }
    this.#disk = this.diskPath;
    return this.diskPath;
  }

  /**
   * Listens on the QMP unix socket, launches QEMU against it, waits for
   * the greeting, and negotiates capabilities. Requires a disk: either
   * call createDisk() first or pass an existing one via options.disk.
   * The ISO defaults to omarchy.iso in the project root.
   */
  async start(options: QemuStartOptions = {}): Promise<QemuStartResult> {
    if (this.#closed) {
      throw new Error("qemu: closed");
    }
    if (this.#socket !== undefined) {
      throw new Error("qemu: already started");
    }

    const disk = options.disk === undefined ? this.#disk : resolvePath(options.disk);
    if (disk === undefined) {
      throw new Error("qemu: no disk; call createDisk() or pass options.disk");
    }
    await assertFile(disk, "disk");
    const iso = resolvePath(options.iso ?? DEFAULT_ISO);
    await assertFile(iso, "iso");

    try {
      await this.#ensureDir();
      const varsPath = join(this.#dir, "OVMF_VARS.fd");
      await copyFile(this.#opts.vars ?? DEFAULT_VARS, varsPath);

      const args = qemuArgs({
        sockPath: this.sockPath,
        varsPath,
        diskPath: disk,
        iso,
        code: this.#opts.code ?? DEFAULT_CODE,
        memory: this.#opts.memory ?? DEFAULT_MEMORY,
        smp: this.#opts.smp ?? DEFAULT_SMP,
      });

      const greeting = new Promise<QemuGreetingResponse>((resolve, reject) => {
        this.#greetingResolve = resolve;
        this.#greetingReject = reject;
      });
      // A late rejection (socket close after startup failed) must not
      // become an unhandled rejection.
      greeting.catch(() => {});

      this.#socket = await this.#listenAndSpawn(args);
      this.#socket.setEncoding("utf8");
      this.#socket.on("data", (chunk: string) => {
        this.#onData(chunk);
      });
      this.#socket.on("error", (err) => {
        this.#failAll(err);
      });
      this.#socket.on("close", () => {
        this.#failAll(new Error("qemu: socket closed"));
      });

      await this.#waitGreeting(greeting);
      await this.#execute("qmp_capabilities", {});
      return { id: this.id };
    } catch (err) {
      // Mirror the Go server: a failed start must not leak the QEMU
      // process or the listening socket.
      this.#proc?.kill();
      this.#proc = undefined;
      this.#socket?.destroy();
      this.#socket = undefined;
      this.#server?.close();
      this.#server = undefined;
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.#closed = true;
    this.#failAll(new Error("qemu: closed"));
    this.#socket?.destroy();
    this.#server?.close();
    this.#proc?.kill();
    await rm(this.#dir, { recursive: true, force: true });
  }

  async sendKey(keys: QemuKeyValue[]): Promise<void> {
    await this.#execute("send-key", { keys });
  }

  async screendump(filename: string, format = "png"): Promise<void> {
    await this.#execute("screendump", { filename, format });
  }

  #ensureDir(): Promise<string | undefined> {
    return mkdir(this.#dir, { recursive: true, mode: 0o700 });
  }

  #execute(name: string, args: unknown): Promise<unknown> {
    if (this.#closed || this.#socket === undefined) {
      return Promise.reject(new Error("qemu: closed"));
    }
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket!.write(`${JSON.stringify({ execute: name, arguments: args, id })}\n`);
    });
  }

  #onData(chunk: string): void {
    this.#parser.push(chunk);
    for (;;) {
      const msg = this.#parser.pull();
      if (msg === undefined) {
        return;
      }
      if ("QMP" in msg) {
        this.#greetingResolve?.(msg);
        this.#greetingResolve = undefined;
        this.#greetingReject = undefined;
        continue;
      }
      if ("event" in msg) {
        continue;
      }
      if (!("id" in msg) || msg.id === undefined) {
        continue;
      }
      const pending = this.#pending.get(Number(msg.id));
      if (pending === undefined) {
        continue;
      }
      this.#pending.delete(Number(msg.id));
      if ("error" in msg) {
        pending.reject(new Error(`${msg.error.class}: ${msg.error.desc}`));
        continue;
      }
      pending.resolve(msg.return);
    }
  }

  #listenAndSpawn(args: string[]): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      this.#server = server;
      const timer = setTimeout(() => {
        reject(new Error("qemu: accept timeout"));
      }, HANDSHAKE_MS);
      const fail = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
      server.once("error", fail);
      server.once("connection", (socket) => {
        clearTimeout(timer);
        resolve(socket);
      });
      server.listen(this.sockPath, () => {
        const proc = spawn(QEMU_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
        this.#proc = proc;
        proc.stderr?.on("data", (chunk: Buffer) => {
          if (this.#stderr.length < STDERR_CAP) {
            this.#stderr += chunk.toString();
          }
        });
        proc.once("error", (err) => {
          fail(new Error(`qemu: ${err.message}`));
        });
        proc.once("exit", (code) => {
          const detail = this.#stderr.trim();
          fail(
            new Error(
              detail === ""
                ? `qemu: exited ${code} before QMP connect`
                : `qemu: exited ${code} before QMP connect: ${detail}`,
            ),
          );
        });
      });
    });
  }

  async #waitGreeting(greeting: Promise<QemuGreetingResponse>): Promise<void> {
    let timeout: ReturnType<typeof setTimeout>;
    const expired = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error("qemu: greeting timeout"));
      }, HANDSHAKE_MS);
    });
    try {
      await Promise.race([greeting, expired]);
    } finally {
      clearTimeout(timeout!);
    }
  }

  #failAll(err: Error): void {
    this.#greetingReject?.(err);
    this.#greetingReject = undefined;
    this.#greetingResolve = undefined;
    for (const pending of this.#pending.values()) {
      pending.reject(err);
    }
    this.#pending.clear();
  }
}

export function qemuArgs(opts: {
  sockPath: string;
  varsPath: string;
  diskPath: string;
  iso: string;
  code: string;
  memory: string;
  smp: number;
}): string[] {
  if (opts.sockPath === "") {
    throw new Error("qemu: qmp socket path is required");
  }
  if (opts.varsPath === "") {
    throw new Error("qemu: firmware vars path is required");
  }
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function assertFile(path: string, label: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    throw new Error(`qemu: ${label} not found: ${path}`);
  }
}

function qemuImgCreate(path: string, size: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(QEMU_IMG, ["create", "-f", "qcow2", path, size], {
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`qemu-img create exited ${code}`));
    });
  });
}
