import { homedir, tmpdir } from "node:os";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import type { PlatformError, Scope } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as Log from "../observability/log.ts";
import * as Client from "../qmp/client.ts";
import * as Socket from "../qmp/socket.ts";
import type * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";
import * as Args from "./args.ts";
import * as Process from "./process.ts";

// Host facts, read once: iso.ts keys its cache and partial files off them.
export const homeDir: string = homedir();
export const pid: number = process.pid;

export const sessionDir = (id: string): string => `${tmpdir()}/oligarchy-${id}`;

// QEMU's keyboard queue holds ~1024 input events and silently drops the rest. send-key acks
// immediately but the guest drains slowly, so a long string sent as fast as QMP acks overflows
// the queue and loses keys. Pace chords under the drain rate; measured against real QEMU,
// 60ms/chord keeps a 1000-char string lossless.
const KEY_CHORD_GAP_MS = 60;
// QEMU INPUT_EVENT_ABS_MAX: tablet axes are 0..0x7fff.
const TABLET_AXIS_MAX = 0x7fff;
// Guest double-click detection needs a gap between successive press/release pairs.
const MULTI_CLICK_GAP_MS = 50;

// A session dir with its firmware copy and the disk QEMU boots from: the caller's, or the fresh
// qcow2 `prepare` created in the dir.
export type Prepared = {
  readonly id: string;
  readonly dir: string;
  readonly diskPath: string;
};

export type StartInput = {
  readonly iso: string;
  readonly display: Domain.QemuDisplay;
  readonly automation: boolean;
  readonly record: Client.Recorder;
};

export type MouseInput = {
  readonly x: number;
  readonly y: number;
  readonly button?: Domain.MouseButton;
  readonly clicks?: number;
};

export type QemuHandle = {
  readonly id: string;
  readonly dir: string;
  readonly serialPath: string;
  readonly sendKeys: (
    chords: ReadonlyArray<ReadonlyArray<string>>,
    record: Client.Recorder,
  ) => Effect.Effect<void, Client.ExecuteError>;
  readonly sendMouse: (
    input: MouseInput,
    record: Client.Recorder,
  ) => Effect.Effect<void, Client.ExecuteError>;
  readonly screendump: (
    record: Client.Recorder,
  ) => Effect.Effect<Uint8Array, Client.ExecuteError | PlatformError.PlatformError>;
  readonly stderrTail: Effect.Effect<string>;
};

export type QemuService = {
  // The session dir, the OVMF vars copy and, without a caller's disk, the default qcow2. Its
  // finalizer removes the dir; registered first, so it runs after `start`'s kill.
  readonly prepare: (
    id: string,
    disk: string | undefined,
  ) => Effect.Effect<Prepared, Errors.QemuStartError, Scope.Scope>;
  // Leaving the scope kills QEMU and closes its socket.
  readonly start: (
    prepared: Prepared,
    input: StartInput,
  ) => Effect.Effect<QemuHandle, Errors.QemuStartError | Errors.DatabaseError, Scope.Scope>;
  readonly sessionDir: (id: string) => string;
};

const startError = (error: unknown): Errors.QemuStartError =>
  Errors.QemuStartError.make({ message: `qemu: ${Process.detail(error)}`, cause: error });

const make: Effect.Effect<
  QemuService,
  never,
  | FileSystem.FileSystem
  | Path.Path
  | ChildProcessSpawner.ChildProcessSpawner
  | Log.Log
  | Socket.QmpListen
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const log = yield* Log.Log;
  const listen = yield* Socket.QmpListen;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const withSpawner = Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner);

  const prepare = Effect.fn("Qemu.prepare")(function* (id: string, disk: string | undefined) {
    const dir = sessionDir(id);
    yield* fs
      .makeDirectory(dir, { recursive: true, mode: 0o700 })
      .pipe(Effect.mapError(startError));
    // Registered before anything `start` registers, so it runs last: QEMU is dead and the socket
    // closed before the dir goes.
    yield* Effect.addFinalizer(() =>
      fs.remove(dir, { recursive: true, force: true }).pipe(
        Effect.catch((error) =>
          log.error(`qemu: removing ${dir} failed: ${Process.detail(error)}`, {
            sessionId: id,
            cause: error,
          }),
        ),
      ),
    );
    const diskPath = path.join(dir, "disk.qcow2");
    if (disk === undefined) {
      yield* withSpawner(Process.createDisk(diskPath, Args.DEFAULT_DISK_SIZE));
    }
    yield* fs
      .copyFile(Args.OVMF_VARS, path.join(dir, "OVMF_VARS.fd"))
      .pipe(Effect.mapError(startError));
    return { id, dir, diskPath: disk ?? diskPath } satisfies Prepared;
  });

  const start = Effect.fn("Qemu.start")(function* (prepared: Prepared, input: StartInput) {
    const { id, dir } = prepared;
    const sockPath = path.join(dir, "qmp.sock");
    const serialPath = path.join(dir, "serial.log");
    const args = Args.qemuArgs({
      sockPath,
      serialPath,
      varsPath: path.join(dir, "OVMF_VARS.fd"),
      diskPath: prepared.diskPath,
      iso: input.iso,
      display: input.display,
      automation: input.automation,
    });
    // QEMU connects to us: listen on the session socket, then spawn.
    const listener = yield* listen.listen(sockPath).pipe(Effect.mapError(startError));
    const qemu = yield* withSpawner(Process.spawnQemu(args));
    // One message for every way the boot can stall, with QEMU's own complaint when it made one.
    const handshakeTimeout = (cause?: Errors.QmpTimeout) =>
      qemu
        .withStderr("qemu: handshake timeout")
        .pipe(
          Effect.flatMap((message) =>
            cause === undefined
              ? Errors.QemuStartError.make({ message })
              : Errors.QemuStartError.make({ message, cause }),
          ),
        );
    const client = yield* Effect.gen(function* () {
      const socket = yield* Effect.raceFirst(listener.accept, qemu.exitedBeforeConnect).pipe(
        Effect.mapError((error) => (error._tag === "QmpClosed" ? startError(error) : error)),
      );
      return yield* Client.handshake(socket, input.record).pipe(
        Effect.provideService(Log.Log, log),
        Effect.catchTag("QmpTimeout", (error) => handshakeTimeout(error)),
        Effect.mapError((error) =>
          error._tag === "DatabaseError" || error._tag === "QemuStartError"
            ? error
            : Errors.QemuStartError.make({ message: error.message, cause: error }),
        ),
      );
    }).pipe(
      Effect.timeoutOrElse({ duration: Client.HANDSHAKE_MS, orElse: () => handshakeTimeout() }),
    );

    const sendKeys = Effect.fn("Qemu.sendKeys")(function* (
      chords: ReadonlyArray<ReadonlyArray<string>>,
      record: Client.Recorder,
    ) {
      for (const [index, chord] of chords.entries()) {
        yield* client.execute(
          {
            execute: "send-key",
            arguments: {
              keys: chord.map((code): Domain.QmpKey => ({ type: "qcode", data: code })),
            },
          },
          record,
        );
        if (index + 1 < chords.length) {
          yield* Effect.sleep(KEY_CHORD_GAP_MS);
        }
      }
    });

    const sendMouse = Effect.fn("Qemu.sendMouse")(function* (
      mouse: MouseInput,
      record: Client.Recorder,
    ) {
      const abs: ReadonlyArray<Domain.QmpInputEvent> = [
        { type: "abs", data: { axis: "x", value: Math.round(mouse.x * TABLET_AXIS_MAX) } },
        { type: "abs", data: { axis: "y", value: Math.round(mouse.y * TABLET_AXIS_MAX) } },
      ];
      const send = (events: ReadonlyArray<Domain.QmpInputEvent>) =>
        client.execute({ execute: "input-send-event", arguments: { events } }, record);
      if (mouse.button === undefined) {
        yield* send(abs);
        return;
      }
      const button = mouse.button;
      const clicks = mouse.clicks ?? 1;
      // usb-tablet applies the event list then syncs once: down and up in the same list leave
      // the button unchanged, so the guest never sees a click. The release always goes out, even
      // after a failed press, so the guest is never left with a button held down.
      for (let click = 0; click < clicks; click++) {
        const pressed = yield* Effect.exit(
          send([...abs, { type: "btn", data: { button, down: true } }]),
        );
        yield* send([{ type: "btn", data: { button, down: false } }]);
        yield* pressed;
        if (click + 1 < clicks) {
          yield* Effect.sleep(MULTI_CLICK_GAP_MS);
        }
      }
    });

    const screendump = Effect.fn("Qemu.screendump")(function* (record: Client.Recorder) {
      const file = path.join(dir, `image-${String(process.hrtime.bigint())}.png`);
      return yield* Effect.gen(function* () {
        yield* client.execute(
          { execute: "screendump", arguments: { filename: file, format: "png" } },
          record,
        );
        return yield* fs.readFile(file);
      }).pipe(Effect.ensuring(Effect.ignore(fs.remove(file, { force: true }))));
    });

    return {
      id,
      dir,
      serialPath,
      sendKeys,
      sendMouse,
      screendump,
      stderrTail: qemu.stderrTail,
    } satisfies QemuHandle;
  });

  return { prepare, start, sessionDir } satisfies QemuService;
});

export class Qemu extends Context.Service<Qemu>()("@oligarchy/qemu/Qemu", { make }) {
  static readonly layer: Layer.Layer<
    Qemu,
    never,
    FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner | Log.Log
  > = Layer.effect(this)(this.make).pipe(Layer.provide(Socket.QmpListen.layer));
}
