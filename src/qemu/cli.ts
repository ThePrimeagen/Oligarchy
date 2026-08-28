import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSONStreamParser } from "../qmp/json-stream.ts";

const QEMU_BIN = "qemu-system-x86_64";
const QEMU_IMG = "qemu-img";
const DEFAULT_ISO = "omarchy.iso";
const DEFAULT_DISK_SIZE = "40G";
const DEFAULT_CODE = "/usr/share/edk2/x64/OVMF_CODE.4m.fd";
const DEFAULT_VARS = "/usr/share/edk2/x64/OVMF_VARS.4m.fd";
const DEFAULT_MEMORY = "4G";
const DEFAULT_SMP = 2;
const DEFAULT_MACHINE = "q35,accel=kvm";
const DEFAULT_CPU = "host";
const HANDSHAKE_MS = 10_000;

export type QemuCLIOptions = {
  tmp?: string;
  diskSize?: string;
  iso?: string;
  code?: string;
  vars?: string;
  memory?: string;
  smp?: number;
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
  #parser = new JSONStreamParser();
  #pending = new Map<number, Pending>();
  #nextId = 0;
  #proc: ChildProcess | undefined;
  #server: Server | undefined;
  #socket: Socket | undefined;
  #greetingResolve: ((msg: QemuGreetingResponse) => void) | undefined;
  #greetingReject: ((err: Error) => void) | undefined;
  #greeting: Promise<QemuGreetingResponse>;
  #closed = false;

  static async new(options: QemuCLIOptions = {}): Promise<QemuCLI> {
    const cli = new QemuCLI(options);
    await mkdir(cli.#dir, { recursive: true, mode: 0o700 });
    await createDisk(cli.diskPath, options.diskSize ?? DEFAULT_DISK_SIZE);
    return cli;
  }

  private constructor(options: QemuCLIOptions) {
    this.#opts = options;
    this.id = randomUUID();
    this.#dir = join(options.tmp ?? tmpdir(), `oligarchy-${this.id}`);
    this.diskPath = join(this.#dir, "disk.qcow2");
    this.sockPath = join(this.#dir, "qmp.sock");
    this.#greeting = new Promise((resolve, reject) => {
      this.#greetingResolve = resolve;
      this.#greetingReject = reject;
    });
  }

  async start(): Promise<QemuStartResult> {
    if (this.#socket !== undefined) {
      throw new Error("qemu: already started");
    }
    const varsPath = join(this.#dir, "OVMF_VARS.fd");
    await copyFile(this.#opts.vars ?? DEFAULT_VARS, varsPath);

    const args = qemuArgs({
      sockPath: this.sockPath,
      varsPath,
      diskPath: this.diskPath,
      iso: this.#opts.iso ?? DEFAULT_ISO,
      code: this.#opts.code ?? DEFAULT_CODE,
      memory: this.#opts.memory ?? DEFAULT_MEMORY,
      smp: this.#opts.smp ?? DEFAULT_SMP,
    });

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

    await this.#waitGreeting();
    await this.#execute("qmp_capabilities", {});
    return { id: this.id };
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
      server.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      server.once("connection", (socket) => {
        clearTimeout(timer);
        resolve(socket);
      });
      server.listen(this.sockPath, () => {
        try {
          this.#proc = spawn(QEMU_BIN, args, { stdio: "ignore" });
        } catch (err) {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  async #waitGreeting(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout>;
    const expired = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error("qemu: greeting timeout"));
      }, HANDSHAKE_MS);
    });
    try {
      await Promise.race([this.#greeting, expired]);
    } finally {
      clearTimeout(timeout!);
    }
  }

  #failAll(err: Error): void {
    this.#greetingReject?.(err);
    this.#greetingReject = undefined;
    for (const pending of this.#pending.values()) {
      pending.reject(err);
    }
    this.#pending.clear();
  }
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

function createDisk(path: string, size: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(QEMU_IMG, ["create", "-f", "qcow2", path, size]);
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
