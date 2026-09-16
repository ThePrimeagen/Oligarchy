import { homedir, tmpdir } from "node:os";
import { Array as Arr, Context, Effect, Exit, FileSystem, Layer, Path } from "effect";
import type { PlatformError, Scope } from "effect";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as Log from "../observability/log.ts";
import * as Client from "../qmp/client.ts";
import * as Socket from "../qmp/socket.ts";
import type * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";
import * as Args from "./args.ts";
import * as Process from "./process.ts";

// Host facts, read once: iso.ts keys its cache and partial files off them. The data directory is
// where the iso cache and the minted disks live unless --data-dir or OLIGARCHY_DATA_DIR says
// otherwise, which is how one machine runs several servers with a cache each.
export const dataDir: string = `${homedir()}/.oligarchy`;
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
// A toolkit starts a drag only once the pointer has moved past a threshold while pressed, and
// follows the motion events it then receives: one jump from A to B is a click at B to GTK and
// Qt. Eight steps per segment cross the threshold on the first and keep a path of a few points
// under a second; 20 ms lets the guest take each report before the next.
const DRAG_STEPS = 8;
const DRAG_STEP_GAP_MS = 20;

// The qcode QEMU knows each held modifier by; super is the left meta key, as send-keys' <M-...>.
const MODIFIER_QCODE: Readonly<Record<Domain.MouseModifier, string>> = {
  shift: "shift",
  ctrl: "ctrl",
  alt: "alt",
  super: "meta_l",
};

// A session dir with its firmware copy and the disk QEMU boots from: the caller's, or the fresh
// qcow2 `prepare` created in the dir.
export type Prepared = {
  readonly id: string;
  readonly dir: string;
  readonly diskPath: string;
};

// What the machine's disk is: a blank qcow2 made here, a disk the caller names and boots as is,
// or an overlay on a minted disk booting with that disk's own firmware copy.
export type DiskSource =
  | { readonly _tag: "fresh" }
  | { readonly _tag: "existing"; readonly path: string }
  | { readonly _tag: "minted"; readonly disk: string; readonly vars: string };

export type StartInput = {
  // The iso to attach and boot first; none when the disk itself boots.
  readonly cdrom: string | undefined;
  readonly display: Domain.QemuDisplay;
  readonly automation: boolean;
  readonly record: Client.Recorder;
};

// The handler has already checked the combinations: a path or a press comes with a pressable
// button and without clicks, modifiers with a button.
export type MouseInput = {
  readonly x: number;
  readonly y: number;
  readonly button?: Domain.MouseButton;
  readonly clicks?: number;
  // A drag from (x, y) through these points, released at the last.
  readonly path?: Arr.NonEmptyReadonlyArray<Domain.ScreenPoint>;
  // Held around the pointer events of this request.
  readonly modifiers?: Arr.NonEmptyReadonlyArray<Domain.MouseModifier>;
  // Half a click, held across requests.
  readonly press?: Domain.MousePress;
};

export type QemuHandle = {
  readonly id: string;
  readonly dir: string;
  readonly serialPath: string;
  // The disk the machine runs on and the firmware copy it boots with: what a save keeps.
  readonly diskPath: string;
  readonly varsPath: string;
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
  // The ACPI power button; the guest decides what to do with it.
  readonly powerdown: (record: Client.Recorder) => Effect.Effect<void, Client.ExecuteError>;
  // Whether QEMU is still running, and its exit code once it is not (null for a signal death).
  readonly running: Effect.Effect<boolean>;
  readonly exited: Effect.Effect<number | null>;
  readonly stderrTail: Effect.Effect<string>;
};

export type QemuService = {
  // The session dir, the firmware copy and the disk the source names. Its finalizer removes the
  // dir; registered first, so it runs after `start`'s kill.
  readonly prepare: (
    id: string,
    source: DiskSource,
  ) => Effect.Effect<Prepared, Errors.QemuStartError, Scope.Scope>;
  // Leaving the scope kills QEMU and closes its socket.
  readonly start: (
    prepared: Prepared,
    input: StartInput,
  ) => Effect.Effect<QemuHandle, Errors.QemuStartError | Errors.DatabaseError, Scope.Scope>;
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

  const prepare = Effect.fn("Qemu.prepare")(function* (id: string, source: DiskSource) {
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
            location: id,
            cause: error,
          }),
        ),
      ),
    );
    const own = path.join(dir, "disk.qcow2");
    // The disk the machine runs on, and the firmware it boots with: pristine, except for a
    // minted disk, whose firmware copy carries the installed system's boot entry.
    const { diskPath, vars } = yield* Effect.gen(function* () {
      switch (source._tag) {
        case "fresh":
          yield* withSpawner(Process.createDisk(own, Args.DEFAULT_DISK_SIZE));
          return { diskPath: own, vars: Args.OVMF_VARS };
        case "existing":
          return { diskPath: source.path, vars: Args.OVMF_VARS };
        case "minted":
          yield* withSpawner(Process.createOverlay(own, source.disk));
          return { diskPath: own, vars: source.vars };
      }
      return source satisfies never;
    });
    yield* fs.copyFile(vars, path.join(dir, "OVMF_VARS.fd")).pipe(Effect.mapError(startError));
    return { id, dir, diskPath } satisfies Prepared;
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
      cdrom: input.cdrom,
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
      const at = (point: Domain.ScreenPoint): ReadonlyArray<Domain.QmpInputEvent> => [
        { type: "abs", data: { axis: "x", value: Math.round(point.x * TABLET_AXIS_MAX) } },
        { type: "abs", data: { axis: "y", value: Math.round(point.y * TABLET_AXIS_MAX) } },
      ];
      const send = (events: ReadonlyArray<Domain.QmpInputEvent>) =>
        client.execute({ execute: "input-send-event", arguments: { events } }, record);
      const button = mouse.button;
      if (button === undefined) {
        yield* send(at(mouse));
        return;
      }
      const down: Domain.QmpInputEvent = { type: "btn", data: { button, down: true } };
      const up: Domain.QmpInputEvent = { type: "btn", data: { button, down: false } };

      // usb-tablet applies the event list then syncs once: down and up in the same list leave
      // the button unchanged, so the guest never sees a click. The release always goes out, even
      // after a failed press, so the guest is never left with a button held down.
      const click = Effect.gen(function* () {
        const clicks = mouse.clicks ?? 1;
        for (let pulse = 0; pulse < clicks; pulse++) {
          const pressed = yield* Effect.exit(send([...at(mouse), down]));
          yield* send([up]);
          yield* pressed;
          if (pulse + 1 < clicks) {
            yield* Effect.sleep(MULTI_CLICK_GAP_MS);
          }
        }
      });

      // Each step is its own exchange: abs events in one list collapse to the last position.
      // The release lands at the path's end after a failed move too, so the guest is never left
      // mid-drag with the button down.
      const drag = (points: Arr.NonEmptyReadonlyArray<Domain.ScreenPoint>) =>
        Effect.gen(function* () {
          const moved = yield* Effect.exit(
            Effect.gen(function* () {
              yield* send([...at(mouse), down]);
              let from: Domain.ScreenPoint = mouse;
              for (const point of points) {
                for (let step = 1; step <= DRAG_STEPS; step++) {
                  yield* Effect.sleep(DRAG_STEP_GAP_MS);
                  const along = step / DRAG_STEPS;
                  yield* send(
                    at({
                      x: from.x + (point.x - from.x) * along,
                      y: from.y + (point.y - from.y) * along,
                    }),
                  );
                }
                from = point;
              }
              yield* Effect.sleep(DRAG_STEP_GAP_MS);
            }),
          );
          yield* send([...at(Arr.lastNonEmpty(points)), up]);
          yield* moved;
        });

      const gesture = Effect.gen(function* () {
        if (mouse.press !== undefined) {
          yield* send([...at(mouse), mouse.press === "down" ? down : up]);
          return;
        }
        if (mouse.path !== undefined) {
          yield* drag(mouse.path);
          return;
        }
        yield* click;
      });

      const modifiers = mouse.modifiers;
      if (modifiers === undefined) {
        yield* gesture;
        return;
      }
      const held = (
        pressed: boolean,
        order: ReadonlyArray<Domain.MouseModifier>,
      ): ReadonlyArray<Domain.QmpInputEvent> =>
        order.map((modifier) => ({
          type: "key",
          data: { down: pressed, key: { type: "qcode", data: MODIFIER_QCODE[modifier] } },
        }));
      // Pressed as their own exchange first and let go as their own exchange last: after a
      // failed gesture, and after a failed press too, since the row can be refused once QEMU has
      // taken the keys. The guest is never left with a modifier held down.
      const pressed = yield* Effect.exit(send(held(true, modifiers)));
      const done = Exit.isSuccess(pressed) ? yield* Effect.exit(gesture) : pressed;
      yield* send(held(false, Arr.reverse(modifiers)));
      yield* done;
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

    const powerdown = Effect.fn("Qemu.powerdown")(function* (record: Client.Recorder) {
      yield* client.execute({ execute: "system_powerdown", arguments: {} }, record);
    });

    return {
      id,
      dir,
      serialPath,
      diskPath: prepared.diskPath,
      varsPath: path.join(dir, "OVMF_VARS.fd"),
      sendKeys,
      sendMouse,
      screendump,
      powerdown,
      running: qemu.running,
      exited: qemu.exited,
      stderrTail: qemu.stderrTail,
    } satisfies QemuHandle;
  });

  return { prepare, start } satisfies QemuService;
});

export class Qemu extends Context.Service<Qemu>()("@oligarchy/qemu/Qemu", { make }) {
  static readonly layer: Layer.Layer<
    Qemu,
    never,
    FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner | Log.Log
  > = Layer.effect(this)(this.make).pipe(Layer.provide(Socket.QmpListen.layer));
}
