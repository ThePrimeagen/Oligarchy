import { EventEmitter } from "node:events";
import * as jarl from "jarl";
import * as Async from "@oligarchy/async";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as Qemu from "../src/qemu.ts";
import * as Queue from "../src/queue.ts";
import * as Fake from "../src/testing.ts";
import { files } from "./files.ts";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const never = new AbortController().signal;
const record = async () => jarl.ok(async () => jarl.ok(undefined));
const JOB = "11111111-1111-4111-8111-111111111111";
const setup = (options: { noGreeting?: boolean; refuseListen?: boolean } = {}) => {
  const f = files();
  f.data.set("/firmware/vars", Buffer.from("firmware"));
  const lines = Queue.create<string>(30);
  const commands: string[] = [];
  const socket = {
    read: lines.read,
    write: async (line: string) => {
      const request = JSON.parse(line);
      commands.push(request.execute);
      lines.push(`${JSON.stringify({ id: request.id, return: {} })}\n`);
      return jarl.ok(undefined);
    },
    close: () => lines.finish(),
  };
  const child = Object.assign(new EventEmitter(), {
    stderr: Object.assign(new EventEmitter(), { setEncoding: () => {} }),
    kill: vi.fn(() => {
      child.emit("exit", null, "SIGTERM");
      child.emit("close");
      lines.finish();
      return true;
    }),
  });
  const args: string[][] = [];
  const spawn: typeof f.os.spawn = (binary: string, argv: string[]) => {
    args.push(argv);
    if (binary === "qemu" && !argv.includes("--version")) {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }
    const image = Object.assign(new EventEmitter(), {
      stderr: Object.assign(new EventEmitter(), { setEncoding: () => {} }),
      kill: () => true,
    });
    queueMicrotask(() => {
      image.emit("spawn");
      image.emit("exit", 0, null);
      image.emit("close");
    });
    return image;
  };
  const qmpListen = Fake.qmpListen({
    listen: async () => {
      if (options.refuseListen) return jarl.err(new Async.Aborted("listener failed"));
      if (!options.noGreeting) lines.push('{"QMP":{}}\n');
      return jarl.ok({ accept: async () => jarl.ok(socket), close: async () => lines.finish() });
    },
  });
  const os = { ...f.os, spawn };
  const qemu = Qemu.create(
    { qmpListen },
    {
      os,
      dataDir: "/data",
      binary: "qemu",
      imageBinary: "qemu-img",
      firmwareCode: "/firmware/code",
      firmwareVars: "/firmware/vars",
      diskSize: "40G",
      memory: "4G",
      cpus: 2,
      display: "none",
      automation: true,
      handshakeMs: 30,
      commandMs: 10,
      maxFrame: 4096,
      keyGap: 1,
      clickGap: 1,
      dragGap: 1,
      dragSteps: 2,
      maxKeys: 10,
      killGrace: 10,
      stderrGrace: 5,
      stderrLimit: 100,
    },
  );
  return { ...f, os, qemu, child, lines, commands, args };
};
it("preserves a shutdown event queued beside process exit, then allows capture before disposal", async () => {
  const h = setup();
  const guest = jarl.unwrap(await h.qemu.boot({ job: JOB, cdrom: "/iso", record }, never));
  h.child.stderr.emit("data", "last stderr");
  h.child.emit("exit", 0, null);
  h.child.emit("close");
  h.lines.push('{"event":"SHUTDOWN","data":{"reason":"guest-shutdown"}}\n');
  h.lines.finish();
  expect(await guest.end).toEqual({ status: "shutdown" });
  jarl.unwrap(await guest.stop());
  expect(jarl.unwrap(await guest.capture()).qemu).toBe("last stderr");
  expect(h.data.has(`/data/guests/${JOB}/OVMF_VARS.fd`)).toBe(true);
  jarl.unwrap(await guest.dispose());
  expect(h.data.has(`/data/guests/${JOB}/OVMF_VARS.fd`)).toBe(false);
  expect(h.args.at(-1)).toContain("pvpanic");
});
it("a process exit without an event is a crash", async () => {
  const h = setup();
  const guest = jarl.unwrap(await h.qemu.boot({ job: JOB, record }, never));
  h.child.emit("exit", 1, null);
  h.child.emit("close");
  h.lines.finish();
  expect(await guest.end).toMatchObject({ status: "crashed" });
  await guest.stop();
  await guest.dispose();
});
it("host stop without an event is stopped", async () => {
  const h = setup();
  const guest = jarl.unwrap(await h.qemu.boot({ job: JOB, record }, never));
  await guest.stop();
  expect(await guest.end).toEqual({ status: "stopped" });
  await guest.dispose();
});
it("panic is reported before process exit", async () => {
  const h = setup();
  const guest = jarl.unwrap(await h.qemu.boot({ job: JOB, record }, never));
  h.lines.push('{"event":"GUEST_PANICKED"}\n');
  expect(await guest.end).toEqual({ status: "panicked" });
  await guest.stop();
  await guest.dispose();
});
it("handshake timeout terminates the process and removes temporary files", async () => {
  const h = setup({ noGreeting: true });
  const booting = h.qemu.boot({ job: JOB, record }, never);
  await vi.advanceTimersByTimeAsync(30);
  expect(jarl.is_err(await booting)).toBe(true);
  expect(h.child.kill).toHaveBeenCalledWith("SIGTERM");
  expect(h.data.has(`/data/guests/${JOB}/OVMF_VARS.fd`)).toBe(false);
});
it("a socket creation failure removes prepared files without spawning QEMU", async () => {
  const h = setup({ refuseListen: true });
  expect(jarl.is_err(await h.qemu.boot({ job: JOB, record }, never))).toBe(true);
  expect(h.child.kill).not.toHaveBeenCalled();
  expect(h.data.has(`/data/guests/${JOB}/OVMF_VARS.fd`)).toBe(false);
});
it("abort during handshake reaps the process", async () => {
  const h = setup({ noGreeting: true });
  const controller = new AbortController();
  const booting = h.qemu.boot({ job: JOB, record }, controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort(new Async.Aborted("stop"));
  expect(jarl.is_err(await booting)).toBe(true);
  expect(h.child.kill).toHaveBeenCalled();
});
it("recovery reaps only QEMU processes using this runner's guest monitor paths", async () => {
  const h = setup();
  const dir = `/data/guests/${JOB}`;
  h.directories.add(dir);
  for (const pid of ["123", "124"]) h.directories.add(`/proc/${pid}`);
  h.data.set(
    "/proc/123/cmdline",
    Buffer.from(`qemu\0-chardev\0socket,id=qmp,path=${dir}/qmp.sock\0`),
  );
  h.data.set(
    "/proc/124/cmdline",
    Buffer.from("qemu\0-chardev\0socket,id=qmp,path=/other/qmp.sock\0"),
  );
  h.data.set("/proc/123/stat", Buffer.from(`123 (qemu) S ${Array(18).fill("0").join(" ")} 100`));
  const killed: number[] = [];
  h.os.kill = (pid) => {
    killed.push(pid);
    h.data.delete(`/proc/${pid}/stat`);
    return true;
  };
  const recovered = h.qemu.recover(never);
  await vi.advanceTimersByTimeAsync(10);
  jarl.unwrap(await recovered);
  expect(killed).toEqual([123]);
  expect(h.directories.has(dir)).toBe(false);
  expect(h.data.has("/proc/124/cmdline")).toBe(true);
});
it("recovery refuses to remove guest files when it cannot inspect a process", async () => {
  const h = setup();
  const dir = `/data/guests/${JOB}`;
  h.directories.add(dir);
  h.directories.add("/proc/123");
  h.faults.set(
    "read /proc/123/cmdline",
    Object.assign(new Error("permission denied"), { code: "EACCES" }),
  );
  expect(jarl.is_err(await h.qemu.recover(never))).toBe(true);
  expect(h.directories.has(dir)).toBe(true);
});
