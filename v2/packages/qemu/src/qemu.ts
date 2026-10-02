import { codeOf } from "./errors.ts";
import { basename, join, resolve } from "node:path";
import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import * as jarl from "jarl";
import * as Socket from "./qmp-listen.ts";
import * as Qmp from "./qmp.ts";
import * as Process from "./process.ts";
import * as Controls from "./controls.ts";
import * as Keys from "./keys.ts";
import * as Io from "./io.ts";
import { type Answer, QemuFailed, failed, check } from "./errors.ts";
export type Pair = { readonly disk: string; readonly vars: string };
export type End =
  | { readonly status: "shutdown" | "stopped" | "panicked" }
  | { readonly status: "crashed" | "server-error"; readonly reason: string };
export type Guest = Pair & {
  readonly end: Promise<End>;
  readonly image: (signal: AbortSignal, record: Qmp.Recorder) => Answer<Uint8Array>;
  readonly keys: (keys: string, signal: AbortSignal, record: Qmp.Recorder) => Answer<void>;
  readonly mouse: (
    gesture: Controls.Mouse,
    signal: AbortSignal,
    record: Qmp.Recorder,
  ) => Answer<void>;
  readonly powerdown: (signal: AbortSignal, record: Qmp.Recorder) => Answer<void>;
  readonly capture: () => Answer<{ serial: string; qemu: string }>;
  readonly stop: () => Answer<void>;
  readonly dispose: () => Answer<void>;
};
export type Options = Process.Options & {
  readonly dataDir: string;
  readonly binary: string;
  readonly imageBinary: string;
  readonly firmwareCode: string;
  readonly firmwareVars: string;
  readonly diskSize: string;
  readonly memory: string;
  readonly cpus: number;
  readonly xDisplay?: string;
  readonly display: string;
  readonly automation: boolean;
  readonly handshakeMs: number;
  readonly commandMs: number;
  readonly maxFrame: number;
  readonly keyGap: number;
  readonly clickGap: number;
  readonly dragGap: number;
  readonly dragSteps: number;
  readonly maxKeys: number;
  readonly os?: Io.Os;
};
export type Boot = {
  readonly job: string;
  readonly cdrom?: string;
  readonly base?: Pair;
  readonly record: Qmp.Recorder;
};
export type Qemu = {
  readonly service: "qemu";
  readonly recover: (signal: AbortSignal) => Answer<void>;
  readonly boot: (input: Boot, signal: AbortSignal) => Answer<Guest>;
  readonly convert: (from: string, to: string, signal: AbortSignal) => Answer<void>;
};
declare module "@oligarchy/app" {
  interface Services {
    qemu: App.Register<"qemu", Qemu>;
  }
}
export const create = App.createService<Socket.QmpListen, Options, Qemu>((services, options) => {
  const os = options.os ?? Io.node;
  const root = join(resolve(options.dataDir), "guests");
  const run = (args: string[], signal: AbortSignal) =>
    Process.run(os, options.imageBinary, args, signal, options);
  return {
    service: "qemu",
    convert: (from, to, signal) => run(["convert", "-O", "qcow2", from, to], signal),
    recover: (signal) =>
      jarl.exec(async () => {
        check(signal);
        if (
          (options.display === "gtk" || options.display === "sdl") &&
          options.xDisplay === undefined
        )
          throw new QemuFailed("graphical display requires --x-display");
        jarl.unwrap(await Process.run(os, options.binary, ["--version"], signal, options));
        jarl.unwrap(await Process.run(os, options.imageBinary, ["--version"], signal, options));
        await os.fs.access(options.firmwareCode);
        await os.fs.access(options.firmwareVars);
        await os.fs.access("/dev/kvm", 6);
        await os.fs.mkdir(root, { recursive: true, mode: 0o700 });
        // Match the executable and a monitor path inside this runner's own guest directories.
        // This also finds a child whose parent died before writing its PID.
        const dirs = await os.fs.readdir(root);
        const monitors = new Set(
          dirs
            .filter((dir) => /^[a-f0-9-]{36}$/.test(dir))
            .map((dir) => `socket,id=qmp,path=${join(root, dir, "qmp.sock")}`),
        );
        for (const pid of await os.fs.readdir("/proc")) {
          if (!/^\d+$/.test(pid)) continue;
          let cmd: string[];
          try {
            cmd = (await os.fs.readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0");
          } catch (error) {
            if (codeOf(error) === "ENOENT") continue;
            throw error;
          }
          if (
            basename(cmd[0] ?? "") !== basename(options.binary) ||
            !cmd.some((arg) => monitors.has(arg))
          )
            continue;
          const stat = await os.fs.readFile(`/proc/${pid}/stat`, "utf8");
          const identity = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
          const same = async () => {
            try {
              const now = await os.fs.readFile(`/proc/${pid}/stat`, "utf8");
              const fields = now.slice(now.lastIndexOf(")") + 2).split(" ");
              return fields[19] === identity && fields[0] !== "Z";
            } catch (error) {
              if (codeOf(error) === "ENOENT") return false;
              throw error;
            }
          };
          if (await same()) os.kill(Number(pid), "SIGTERM");
          jarl.unwrap(await Async.sleep(options.killGrace, signal));
          if (await same()) os.kill(Number(pid), "SIGKILL");
          const until = Date.now() + options.killGrace;
          while (await same()) {
            if (Date.now() >= until) throw new QemuFailed(`could not reap QEMU ${pid}`);
            jarl.unwrap(await Async.sleep(Math.min(100, options.killGrace), signal));
          }
        }
        for (const dir of dirs)
          if (/^[a-f0-9-]{36}$/.test(dir))
            await os.fs.rm(join(root, dir), { recursive: true, force: true });
      }, failed),
    boot: (input, signal) =>
      jarl.exec(async () => {
        check(signal);
        if (!/^[a-f0-9-]{36}$/.test(input.job)) throw new QemuFailed("invalid guest job id");
        const dir = join(root, input.job);
        const disk = join(dir, "disk.qcow2"),
          vars = join(dir, "OVMF_VARS.fd"),
          monitor = join(dir, "qmp.sock"),
          serial = join(dir, "serial.log");
        let listener: Socket.Listener | undefined;
        let process: Process.Handle | undefined;
        let client: Qmp.Qmp | undefined;
        let stopping = false;
        let terminal: End | undefined;
        let ended!: (end: End) => void;
        const end = new Promise<End>((settle) => {
          ended = settle;
        });
        const finish = (value: End) => {
          if (terminal === undefined) {
            terminal = value;
            ended(value);
          }
        };
        try {
          await os.fs.mkdir(dir, { recursive: true, mode: 0o700 });
          await os.fs.copyFile(input.base?.vars ?? options.firmwareVars, vars);
          jarl.unwrap(
            await run(
              input.base === undefined
                ? ["create", "-f", "qcow2", disk, options.diskSize]
                : ["create", "-f", "qcow2", "-F", "qcow2", "-b", input.base.disk, disk],
              signal,
            ),
          );
          listener = jarl.unwrap(await services.qmpListen.listen(monitor));
          const args = [
            "-machine",
            "q35,accel=kvm",
            "-cpu",
            "host",
            "-m",
            options.memory,
            "-smp",
            String(options.cpus),
            "-drive",
            `if=pflash,format=raw,readonly=on,file=${options.firmwareCode}`,
            "-drive",
            `if=pflash,format=raw,file=${vars}`,
            "-display",
            options.display,
            "-device",
            "qemu-xhci",
            "-device",
            "usb-tablet",
            "-device",
            "pvpanic",
            "-action",
            "panic=shutdown",
            "-chardev",
            `socket,id=qmp,path=${monitor}`,
            "-mon",
            "chardev=qmp,mode=control",
            "-chardev",
            `file,id=serial,path=${serial}`,
            "-serial",
            "chardev:serial",
            "-drive",
            `file=${disk},if=virtio,format=qcow2`,
          ];
          if (options.automation) args.push("-vga", "none", "-device", "virtio-vga");
          if (input.cdrom !== undefined) args.push("-cdrom", input.cdrom, "-boot", "order=d");
          check(signal);
          process = jarl.unwrap(
            await Process.start(os, options.binary, args, {
              ...options,
              ...(options.xDisplay === undefined
                ? {}
                : { env: { ...globalThis.process.env, DISPLAY: options.xDisplay } }),
            }),
          );
          void process.exited.then(async (exit) => {
            // Consume queued QMP events before classifying an exit with no event.
            if (client !== undefined) await client.reading;
            finish(
              stopping
                ? { status: "stopped" }
                : {
                    status: "crashed",
                    reason: `QEMU exited ${String(exit.code ?? exit.signal)}: ${exit.stderr}`,
                  },
            );
          });
          const connected = await Async.timeout(
            async (inner) => {
              const accepted = await Promise.race([
                listener!.accept(inner),
                process!.exited.then((exit) =>
                  jarl.err(new QemuFailed(`QEMU exited before connect: ${exit.stderr}`)),
                ),
              ]);
              if (jarl.is_err(accepted)) return accepted;
              return Qmp.create(
                jarl.value(accepted),
                inner,
                {
                  handshakeMs: options.handshakeMs,
                  commandMs: options.commandMs,
                  maxFrame: options.maxFrame,
                  event: (event) => {
                    if (event.event === "GUEST_PANICKED") finish({ status: "panicked" });
                    if (event.event !== "SHUTDOWN") return;
                    const reason = event.data?.reason;
                    if (reason === "guest-shutdown") finish({ status: "shutdown" });
                    else if (reason === "guest-panic") finish({ status: "panicked" });
                    else if (reason === "host-error")
                      finish({ status: "server-error", reason: "QEMU host error" });
                    else finish({ status: "stopped" });
                  },
                },
                input.record,
              );
            },
            { ms: options.handshakeMs, signal },
          );
          client = jarl.unwrap(connected);
          const connectedClient = client,
            running = process,
            listening = listener;
          return {
            disk,
            vars,
            end,
            image: (callSignal, record) =>
              jarl.exec(async () => {
                const file = join(dir, `image-${crypto.randomUUID()}.png`);
                try {
                  jarl.unwrap(
                    await connectedClient.execute(
                      { execute: "screendump", arguments: { filename: file, format: "png" } },
                      callSignal,
                      record,
                    ),
                  );
                  return await os.fs.readFile(file);
                } finally {
                  await os.fs.rm(file, { force: true });
                }
              }, failed),
            keys: (text, callSignal, record) =>
              jarl.exec(async () => {
                const keys = jarl.unwrap(Keys.parseKeys(text));
                if (keys.length > options.maxKeys)
                  throw new QemuFailed(`at most ${options.maxKeys} keys`);
                for (const [index, chord] of keys.entries()) {
                  jarl.unwrap(
                    await connectedClient.execute(
                      {
                        execute: "send-key",
                        arguments: { keys: chord.map((data) => ({ type: "qcode", data })) },
                      },
                      callSignal,
                      record,
                    ),
                  );
                  if (index + 1 < keys.length)
                    jarl.unwrap(await Async.sleep(options.keyGap, callSignal));
                }
              }, failed),
            mouse: (gesture, callSignal, record) =>
              Controls.mouse(connectedClient, callSignal, gesture, record, options),
            powerdown: (callSignal, record) =>
              jarl.exec(async () => {
                jarl.unwrap(
                  await connectedClient.execute(
                    { execute: "system_powerdown", arguments: {} },
                    callSignal,
                    record,
                  ),
                );
              }, failed),
            capture: () =>
              jarl.exec(async () => {
                let text = "";
                try {
                  text = await os.fs.readFile(serial, "utf8");
                } catch (error) {
                  if (codeOf(error) !== "ENOENT") throw error;
                }
                return { serial: text, qemu: running.stderr() };
              }, failed),
            stop: () =>
              jarl.exec(async () => {
                stopping = true;
                await running.stop();
                connectedClient.stop();
                await connectedClient.reading;
                await listening.close();
              }, failed),
            dispose: () =>
              jarl.exec(async () => {
                await os.fs.rm(dir, { recursive: true, force: true });
              }, failed),
          } satisfies Guest;
        } catch (error) {
          stopping = true;
          // Assigned only after a successful spawn; cleanup is safe at every earlier boundary.
          if (process !== undefined) await process.stop();
          client?.stop();
          await listener?.close();
          const captured = {
            serial: await os.fs.readFile(serial, "utf8").catch(() => ""),
            qemu: process === undefined ? "" : process.stderr(),
          };
          await os.fs.rm(dir, { recursive: true, force: true });
          throw Object.assign(failed(error), { captured });
        }
      }, failed),
  };
});
