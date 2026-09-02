import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSONStreamParser } from "../qmp/json-stream.ts";

const QEMU_BIN = "qemu-system-x86_64";
const QEMU_IMG = "qemu-img";
const DEFAULT_DISK_SIZE = "40G";
const DEFAULT_CODE = "/usr/share/edk2/x64/OVMF_CODE.4m.fd";
const DEFAULT_VARS = "/usr/share/edk2/x64/OVMF_VARS.4m.fd";
const DEFAULT_MEMORY = "4G";
const DEFAULT_SMP = 2;
const DEFAULT_MACHINE = "q35,accel=kvm";
const DEFAULT_CPU = "host";
const HANDSHAKE_MS = 10_000;
// `-display help` minus curses, which needs QEMU's stdio and the proxy detaches it.
export const QEMU_DISPLAYS = ["none", "gtk", "sdl", "egl-headless", "spice-app", "dbus"] as const;
export type QemuDisplay = (typeof QEMU_DISPLAYS)[number];
const DEFAULT_DISPLAY: QemuDisplay = "none";
export type QemuOptions = {
  tmp?: string;
  diskSize?: string;
  code?: string;
  vars?: string;
  memory?: string;
  smp?: number;
  display?: QemuDisplay;
  automation?: boolean;
};

export type QemuStartOptions = {
  disk?: string;
  iso: string;
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
  readonly serialPath: string;
  readonly options: QemuOptions;
  readonly pending: Map<number | "greeting", Pending>;
  nextId: number;
  proc?: ChildProcess;
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
    serialPath: join(dir, "serial.log"),
    options,
    pending: new Map(),
    nextId: 0,
  };
}

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

export async function start(
  qemu: Qemu,
  options: QemuStartOptions,
  record?: QemuExchangeRecorder,
): Promise<QemuStartResult> {
  if (qemu.socket !== undefined) {
    throw new Error("qemu: already started");
  }

  const disk = options.disk ?? qemu.diskPath;
  await assertFile(disk, "disk");
  await assertFile(options.iso, "iso");

  const varsPath = join(qemu.dir, "OVMF_VARS.fd");
  await copyFile(qemu.options.vars ?? DEFAULT_VARS, varsPath);
  const args = qemuArgs({
    sockPath: qemu.sockPath,
    serialPath: qemu.serialPath,
    varsPath,
    diskPath: disk,
    iso: options.iso,
    code: qemu.options.code ?? DEFAULT_CODE,
    memory: qemu.options.memory ?? DEFAULT_MEMORY,
    smp: qemu.options.smp ?? DEFAULT_SMP,
    display: qemu.options.display ?? DEFAULT_DISPLAY,
    automation: qemu.options.automation === true,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("qemu: handshake timeout")), HANDSHAKE_MS);
  });

  // QEMU connects to us: listen on the session socket, then spawn.
  const server = createServer();
  try {
    const connection = new Promise<Socket>((resolve, reject) => {
      server.once("error", reject);
      server.once("connection", resolve);
      server.listen(qemu.sockPath, () => {
        const proc = spawn(QEMU_BIN, args, { stdio: "ignore" });
        qemu.proc = proc;
        proc.once("error", (err) => reject(new Error(`qemu: ${err.message}`)));
        proc.once("exit", (code) =>
          reject(new Error(`qemu: exited ${code} before QMP connect`)),
        );
      });
    });
    const socket = await Promise.race([connection, timeout]);
    qemu.socket = socket;

    const greeting = new Promise<unknown>((resolve, reject) => {
      qemu.pending.set("greeting", { resolve, reject });
    });
    const parser = new JSONStreamParser();
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      try {
        parser.push(chunk);
        for (let msg = parser.pull(); msg !== undefined; msg = parser.pull()) {
          if ("QMP" in msg) {
            qemu.pending.get("greeting")?.resolve(msg);
            qemu.pending.delete("greeting");
            continue;
          }
          if ("event" in msg) {
            continue;
          }
          const id = msg.id as number;
          const pending = qemu.pending.get(id);
          if (pending === undefined) {
            continue;
          }
          qemu.pending.delete(id);
          if ("error" in msg) {
            // The raw {error} reply rides the rejection so a recorder can store the exact JSON.
            pending.reject(Object.assign(new Error(`${msg.error.class}: ${msg.error.desc}`), { qmp: msg }));
          } else {
            pending.resolve(msg);
          }
        }
      } catch (err) {
        failAll(qemu, err);
        socket.destroy();
      }
    });
    socket.on("error", (err) => failAll(qemu, err));
    socket.on("close", () => failAll(qemu, new Error("qemu: socket closed")));

    const greetingMsg = (await Promise.race([greeting, timeout])) as QemuGreetingResponse;
    // The greeting is the recorded reply for the boot's qmp_capabilities: its own {return} is empty.
    const bootRecord: QemuExchangeRecorder | undefined =
      record === undefined
        ? undefined
        : async (command) => {
            const close = await record(command);
            return (outcome) =>
              close(outcome.state === "completed" ? { state: "completed", response: greetingMsg } : outcome);
          };
    await Promise.race([execute(qemu, "qmp_capabilities", {}, bootRecord), timeout]);
    return { id: qemu.id };
  } catch (err) {
    teardown(qemu, err);
    throw err;
  } finally {
    server.close();
    clearTimeout(timer);
  }
}

export async function stop(qemu: Qemu): Promise<void> {
  teardown(qemu, new Error("qemu: closed"));
  await rm(qemu.dir, { recursive: true, force: true });
}

export async function sendKey(qemu: Qemu, keys: QemuKeyValue[], record?: QemuExchangeRecorder): Promise<void> {
  await execute(qemu, "send-key", { keys }, record);
}

// QEMU INPUT_EVENT_ABS_MAX: tablet axes are 0..0x7fff.
const TABLET_AXIS_MAX = 0x7fff;
// guest double-click detection needs a gap between successive press/release pairs
const MULTI_CLICK_GAP_MS = 50;

export async function sendMouse(
  qemu: Qemu,
  x: number,
  y: number,
  button?: QemuInputButton,
  clicks = 1,
  record?: QemuExchangeRecorder,
): Promise<void> {
  const abs: QemuInputEvent[] = [
    { type: "abs", data: { axis: "x", value: Math.round(x * TABLET_AXIS_MAX) } },
    { type: "abs", data: { axis: "y", value: Math.round(y * TABLET_AXIS_MAX) } },
  ];
  if (button === undefined) {
    await execute(qemu, "input-send-event", { events: abs }, record);
    return;
  }
  // usb-tablet applies the event list then syncs once: down and up in the same
  // list leave the button unchanged, so the guest never sees a click.
  for (let i = 0; i < clicks; i++) {
    try {
      await execute(
        qemu,
        "input-send-event",
        { events: [...abs, { type: "btn", data: { button, down: true } }] },
        record,
      );
    } finally {
      await execute(
        qemu,
        "input-send-event",
        { events: [{ type: "btn", data: { button, down: false } }] },
        record,
      );
    }
    if (i + 1 < clicks) {
      await new Promise<void>((resolve) => setTimeout(resolve, MULTI_CLICK_GAP_MS));
    }
  }
}

export async function screendump(
  qemu: Qemu,
  filename: string,
  format = "png",
  record?: QemuExchangeRecorder,
): Promise<void> {
  await execute(qemu, "screendump", { filename, format }, record);
}

function qemuArgs(opts: {
  sockPath: string;
  serialPath: string;
  varsPath: string;
  diskPath: string;
  iso: string;
  code: string;
  memory: string;
  smp: number;
  display: QemuDisplay;
  automation: boolean;
}): string[] {
  // -vga none without a replacement device removes the console screendump reads.
  const vga = opts.automation ? ["-vga", "none", "-device", "virtio-vga"] : [];
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
    opts.display,
    ...vga,
    // usb-tablet is the absolute pointer; without it, input-send-event abs has no handler.
    "-device",
    "qemu-xhci",
    "-device",
    "usb-tablet",
    "-chardev",
    `socket,id=qmp,path=${opts.sockPath}`,
    "-mon",
    "chardev=qmp,mode=control",
    "-chardev",
    `file,id=serial,path=${opts.serialPath}`,
    "-serial",
    "chardev:serial",
    "-cdrom",
    opts.iso,
    "-boot",
    "order=d",
    "-drive",
    `file=${opts.diskPath},if=virtio,format=qcow2`,
  ];
}

async function execute(qemu: Qemu, name: string, args: unknown, record?: QemuExchangeRecorder): Promise<unknown> {
  const socket = qemu.socket;
  if (socket === undefined) {
    throw new Error("qemu: closed");
  }
  const id = ++qemu.nextId;
  const command = { execute: name, arguments: args, id } as QemuCommand;
  const close = record === undefined ? undefined : await record(command);
  let response: QemuSuccessResponse;
  try {
    response = (await new Promise<unknown>((resolve, reject) => {
      qemu.pending.set(id, { resolve, reject });
      socket.write(`${JSON.stringify(command)}\n`);
    })) as QemuSuccessResponse;
  } catch (err) {
    const failure = (err as { qmp?: QemuErrorResponse }).qmp ?? (err as Error).message;
    await close?.({ state: "failed", response: failure }).catch((closeErr: unknown) => {
      console.error(`db: recording a failed exchange failed too: ${(closeErr as Error).message}`);
    });
    throw err;
  }
  // Outside the try: a failing close must surface as itself, not relabel the completed exchange as failed.
  await close?.({ state: "completed", response });
  return response.return;
}

function failAll(qemu: Qemu, err: unknown): void {
  for (const pending of qemu.pending.values()) {
    pending.reject(err);
  }
  qemu.pending.clear();
}

function teardown(qemu: Qemu, err: unknown): void {
  failAll(qemu, err);
  qemu.socket?.destroy();
  qemu.socket = undefined;
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
