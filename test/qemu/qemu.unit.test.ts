import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodePath } from "@effect/platform-node";
import { Effect, Exit, Fiber, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as Args from "../../src/qemu/args.ts";
import * as Qemu from "../../src/qemu/qemu.ts";
import * as Client from "../../src/qmp/client.ts";
import type * as Domain from "../../src/shared/domain.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeFs from "../support/fake-fs.ts";
import * as FakeSocket from "../support/fake-qmp-socket.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";
import * as FakeLog from "../support/log.ts";

const ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";
const ISO = "/isos/omarchy.iso";
const DIR = Qemu.sessionDir(ID);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

type Fixture = {
  readonly entries?: FakeFs.Entries;
  readonly qemu?: FakeSpawner.Scripted;
  readonly qemuImg?: FakeSpawner.Scripted;
  readonly respond?: (command: Domain.QmpCommand) => ReadonlyArray<string>;
  readonly accepts?: boolean;
  readonly greeting?: boolean;
  readonly imageReadable?: boolean;
};

const fixture = (options: Fixture = {}) =>
  Effect.gen(function* () {
    const events: Array<string> = [];
    const socket = yield* FakeSocket.fakeQmpSocket({
      respond: options.respond ?? FakeSocket.acceptAll,
    });
    if (options.greeting !== false) {
      yield* socket.feed(FakeSocket.greetingLine());
    }
    const listen = FakeSocket.fakeListen(options.accepts === false ? undefined : socket, (path) => {
      events.push(`listen ${path}`);
    });
    const spawner = FakeSpawner.fakeSpawner((command) => {
      events.push(`spawn ${command}`);
      if (command === Args.QEMU_IMG) {
        return options.qemuImg ?? { exitCode: 0 };
      }
      return options.qemu ?? {};
    });
    const fs = FakeFs.recordingFs(options.entries ?? { [ISO]: "File", [Args.OVMF_VARS]: "File" }, {
      overrides: {
        readFile: (path) =>
          Effect.suspend(() => {
            fs.calls.push({ method: "readFile", args: [path] });
            return /image-\d+\.png$/.test(path) && options.imageReadable !== false
              ? Effect.succeed(PNG)
              : Effect.fail(FakeFs.notFound("open", path));
          }),
        remove: (path, removeOptions) =>
          Effect.sync(() => {
            fs.calls.push({ method: "remove", args: [path, removeOptions] });
            const released = spawner.spawned.at(-1)?.isReleased() ?? false;
            events.push(
              `remove ${path} released=${String(released)} closed=${String(socket.isClosed())}`,
            );
          }),
      },
    });
    const log = FakeLog.fakeLog();
    const layer = Layer.effect(Qemu.Qemu)(Qemu.Qemu.make).pipe(
      Layer.provide(
        Layer.mergeAll(fs.layer, NodePath.layer, spawner.layer, log.layer, listen.layer),
      ),
    );
    const qemu = yield* Effect.provide(Qemu.Qemu, layer);
    return { events, socket, listen, spawner, fs, log, qemu };
  });

const startInput = (record: Client.Recorder) =>
  ({ cdrom: ISO, display: "none", automation: false, record }) as const;

const FRESH: Qemu.DiskSource = { _tag: "fresh" };
const MINTED: Qemu.DiskSource = {
  _tag: "minted",
  disk: "/home/u/.oligarchy/isos/omarchy.iso.qcow2",
  vars: "/home/u/.oligarchy/isos/omarchy.iso.OVMF_VARS.fd",
};

// prepare then start under the caller's scope, as Sessions does.
const boot = (qemu: Qemu.QemuService, record: Client.Recorder, disk?: string) =>
  Effect.gen(function* () {
    const prepared = yield* qemu.prepare(
      ID,
      disk === undefined ? FRESH : { _tag: "existing", path: disk },
    );
    return yield* qemu.start(prepared, startInput(record));
  });

const commands = (socket: FakeSocket.FakeQmpSocket): ReadonlyArray<Domain.QmpCommand> =>
  FakeSocket.writtenCommands(socket);

// Lets forked fibers run through a few reply round-trips without advancing the clock.
const settle = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) {
    yield* Effect.yieldNow;
  }
});

describe("Qemu.prepare happy path", () => {
  it.effect("makes the dir, creates the disk, copies the firmware and spawns nothing else", () =>
    Effect.gen(function* () {
      const { events, spawner, fs, qemu } = yield* fixture();
      const prepared = yield* qemu.prepare(ID, FRESH);
      expect(prepared).toEqual({ id: ID, dir: DIR, diskPath: `${DIR}/disk.qcow2` });
      expect(fs.calls).toEqual([
        { method: "makeDirectory", args: [DIR, { recursive: true, mode: 0o700 }] },
        { method: "copyFile", args: [Args.OVMF_VARS, `${DIR}/OVMF_VARS.fd`] },
      ]);
      expect(events).toEqual([`spawn ${Args.QEMU_IMG}`]);
      expect(spawner.spawned[0]?.args).toEqual([
        "create",
        "-f",
        "qcow2",
        `${DIR}/disk.qcow2`,
        "40G",
      ]);
    }),
  );

  it.effect("keeps a caller-provided disk and creates none", () =>
    Effect.gen(function* () {
      const { events, qemu } = yield* fixture();
      const prepared = yield* qemu.prepare(ID, { _tag: "existing", path: "/mnt/custom.qcow2" });
      expect(prepared.diskPath).toBe("/mnt/custom.qcow2");
      expect(events).toEqual([]);
    }),
  );

  it.effect(
    "a minted source is an overlay on the minted disk with the minted firmware copied",
    () =>
      Effect.gen(function* () {
        const { events, spawner, fs, qemu } = yield* fixture({
          entries: { [MINTED.disk]: "File", [MINTED.vars]: "File" },
        });
        const prepared = yield* qemu.prepare(ID, MINTED);
        expect(prepared).toEqual({ id: ID, dir: DIR, diskPath: `${DIR}/disk.qcow2` });
        expect(fs.calls).toEqual([
          { method: "makeDirectory", args: [DIR, { recursive: true, mode: 0o700 }] },
          { method: "copyFile", args: [MINTED.vars, `${DIR}/OVMF_VARS.fd`] },
        ]);
        expect(events).toEqual([`spawn ${Args.QEMU_IMG}`]);
        expect(spawner.spawned[0]?.args).toEqual([
          "create",
          "-f",
          "qcow2",
          "-b",
          MINTED.disk,
          "-F",
          "qcow2",
          `${DIR}/disk.qcow2`,
        ]);
      }),
  );
});

describe("Qemu.prepare unhappy path", () => {
  it.effect("fails `qemu-img create exited <code>` when the disk cannot be created", () =>
    Effect.gen(function* () {
      const { events, qemu } = yield* fixture({ qemuImg: { exitCode: 1 } });
      const error = yield* Effect.flip(qemu.prepare(ID, FRESH));
      expect(error).toMatchObject({ _tag: "QemuStartError", message: "qemu-img create exited 1" });
      expect(events).toEqual([`spawn ${Args.QEMU_IMG}`]);
    }),
  );

  it.effect("a minted source whose firmware copy is gone fails with the copy error", () =>
    Effect.gen(function* () {
      const { qemu } = yield* fixture({ entries: { [MINTED.disk]: "File" } });
      const error = yield* Effect.flip(qemu.prepare(ID, MINTED));
      expect(error).toMatchObject({
        _tag: "QemuStartError",
        message: `qemu: ENOENT: no such file or directory, copyfile '${MINTED.vars}'`,
      });
    }),
  );

  it.effect("fails with the copy error when the OVMF vars cannot be copied", () =>
    Effect.gen(function* () {
      const { qemu } = yield* fixture({ entries: { [ISO]: "File" } });
      const error = yield* Effect.flip(qemu.prepare(ID, FRESH));
      expect(error._tag).toBe("QemuStartError");
      expect(error.message).toBe(
        `qemu: ENOENT: no such file or directory, copyfile '${Args.OVMF_VARS}'`,
      );
    }),
  );

  it.effect("a failed prepare still removes the dir when the scope closes", () =>
    Effect.gen(function* () {
      const { fs, qemu } = yield* fixture({ qemuImg: { exitCode: 1 } });
      const scope = yield* Scope.make();
      yield* Effect.flip(qemu.prepare(ID, FRESH).pipe(Scope.provide(scope)));
      expect(fs.calls.some((call) => call.method === "remove")).toBe(false);
      yield* Scope.close(scope, Exit.void);
      expect(fs.calls.filter((call) => call.method === "remove")).toEqual([
        { method: "remove", args: [DIR, { recursive: true, force: true }] },
      ]);
    }),
  );
});

describe("Qemu.start happy path", () => {
  it.effect("listens before spawning, then handshakes", () =>
    Effect.gen(function* () {
      const { events, socket, spawner, qemu } = yield* fixture();
      const recording = FakeSocket.recorder();
      const handle = yield* boot(qemu, recording.record);
      expect(handle).toMatchObject({ id: ID, dir: DIR, serialPath: `${DIR}/serial.log` });
      expect(events).toEqual([
        `spawn ${Args.QEMU_IMG}`,
        `listen ${DIR}/qmp.sock`,
        `spawn ${Args.QEMU_BIN}`,
      ]);
      expect(spawner.spawned[1]?.args).toEqual(
        Args.qemuArgs({
          sockPath: `${DIR}/qmp.sock`,
          serialPath: `${DIR}/serial.log`,
          varsPath: `${DIR}/OVMF_VARS.fd`,
          diskPath: `${DIR}/disk.qcow2`,
          cdrom: ISO,
          display: "none",
          automation: false,
        }),
      );
      expect(commands(socket)).toEqual([{ execute: "qmp_capabilities", arguments: {}, id: 1 }]);
      expect(recording.outcomes).toEqual([{ state: "completed", response: FakeSocket.GREETING }]);
      expect(yield* handle.stderrTail).toBe("");
    }),
  );

  it.effect("exposes the QEMU stderr tail on the handle", () =>
    Effect.gen(function* () {
      const { qemu } = yield* fixture({ qemu: { stderr: "kvm: not available\n" } });
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      yield* settle;
      expect(yield* handle.stderrTail).toBe("kvm: not available\n");
    }),
  );

  it.effect("boots from a caller-provided disk", () =>
    Effect.gen(function* () {
      const { events, spawner, qemu } = yield* fixture();
      yield* boot(qemu, FakeSocket.recorder().record, "/mnt/custom.qcow2");
      expect(events).toEqual([`listen ${DIR}/qmp.sock`, `spawn ${Args.QEMU_BIN}`]);
      expect(spawner.spawned[0]?.args.at(-1)).toBe("file=/mnt/custom.qcow2,if=virtio,format=qcow2");
    }),
  );

  it.effect("boots a minted overlay without a cdrom", () =>
    Effect.gen(function* () {
      const { spawner, qemu } = yield* fixture({
        entries: { [MINTED.disk]: "File", [MINTED.vars]: "File" },
      });
      const prepared = yield* qemu.prepare(ID, MINTED);
      // Spelled out: a default parameter would turn an explicit undefined back into the iso.
      const handle = yield* qemu.start(prepared, {
        cdrom: undefined,
        display: "none",
        automation: false,
        record: FakeSocket.recorder().record,
      });
      expect(handle.diskPath).toBe(`${DIR}/disk.qcow2`);
      const args = spawner.spawned[1]?.args ?? [];
      expect(args).not.toContain("-cdrom");
      expect(args).not.toContain("-boot");
      expect(args.at(-1)).toBe(`file=${DIR}/disk.qcow2,if=virtio,format=qcow2`);
    }),
  );

  it.effect("names the disk and the firmware copy the machine runs on", () =>
    Effect.gen(function* () {
      const fresh = yield* fixture();
      const handle = yield* boot(fresh.qemu, FakeSocket.recorder().record);
      expect(handle.diskPath).toBe(`${DIR}/disk.qcow2`);
      expect(handle.varsPath).toBe(`${DIR}/OVMF_VARS.fd`);
      // One fake socket answers one handshake; a second boot needs its own fixture.
      const provided = yield* fixture();
      const custom = yield* boot(provided.qemu, FakeSocket.recorder().record, "/mnt/custom.qcow2");
      expect(custom.diskPath).toBe("/mnt/custom.qcow2");
    }),
  );

  it.effect("passes the display through and adds the automation devices", () =>
    Effect.gen(function* () {
      const qemuArgs = (display: Domain.QemuDisplay, automation: boolean) =>
        Effect.gen(function* () {
          const { spawner, qemu } = yield* fixture();
          const prepared = yield* qemu.prepare(ID, FRESH);
          yield* qemu.start(prepared, {
            cdrom: ISO,
            display,
            automation,
            record: FakeSocket.recorder().record,
          });
          return spawner.spawned[1]?.args ?? [];
        });
      const windowed = yield* qemuArgs("gtk", false);
      expect(windowed[windowed.indexOf("-display") + 1]).toBe("gtk");
      expect(windowed).not.toContain("virtio-vga");
      const automated = yield* qemuArgs("none", true);
      expect(automated[automated.indexOf("-display") + 1]).toBe("none");
      expect(automated).toContain("virtio-vga");
    }),
  );
});

describe("Qemu.start unhappy path", () => {
  it.effect("fails `qemu: handshake timeout: <stderr>` after 10 seconds without a connection", () =>
    Effect.gen(function* () {
      const { spawner, qemu } = yield* fixture({
        accepts: false,
        qemu: { stderr: "qemu-system-x86_64: failed to initialize kvm\n" },
      });
      const scope = yield* Scope.make();
      const fiber = yield* Effect.forkChild(
        Effect.flip(boot(qemu, FakeSocket.recorder().record)).pipe(Scope.provide(scope)),
      );
      yield* TestClock.adjust(Client.HANDSHAKE_MS - 1);
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust(1);
      const error = yield* Fiber.join(fiber);
      expect(error.message).toBe(
        "qemu: handshake timeout: qemu-system-x86_64: failed to initialize kvm",
      );
      expect(spawner.spawned[1]?.isReleased()).toBe(false);
      yield* Scope.close(scope, Exit.void);
      expect(spawner.spawned[1]?.isReleased()).toBe(true);
      expect(spawner.spawned[1]?.kills).toEqual(["SIGTERM"]);
    }),
  );

  it.effect("fails `qemu: handshake timeout` when the greeting never comes", () =>
    Effect.gen(function* () {
      const { qemu } = yield* fixture({ greeting: false });
      const fiber = yield* Effect.forkChild(Effect.flip(boot(qemu, FakeSocket.recorder().record)));
      yield* TestClock.adjust(Client.HANDSHAKE_MS);
      const error = yield* Fiber.join(fiber);
      expect(error.message).toBe("qemu: handshake timeout");
    }),
  );

  it.effect("fails `qemu: exited <code> before QMP connect: <stderr>` when QEMU dies first", () =>
    Effect.gen(function* () {
      const { spawner, qemu } = yield* fixture({ accepts: false, qemu: { stderr: "bad -drive" } });
      const fiber = yield* Effect.forkChild(Effect.flip(boot(qemu, FakeSocket.recorder().record)));
      yield* Effect.yieldNow;
      yield* spawner.spawned[1]?.exit(1, " option\n") ?? Effect.void;
      const error = yield* Fiber.join(fiber);
      expect(error.message).toBe("qemu: exited 1 before QMP connect: bad -drive option");
    }),
  );

  it.effect("fails `qemu: <message>` when QEMU cannot be spawned", () =>
    Effect.gen(function* () {
      const { qemu } = yield* fixture({ qemu: { spawnError: "spawn qemu-system-x86_64 ENOENT" } });
      const error = yield* Effect.flip(boot(qemu, FakeSocket.recorder().record));
      expect(error.message).toBe("qemu: spawn qemu-system-x86_64 ENOENT");
    }),
  );

  it.effect("fails with the QMP error when QEMU rejects qmp_capabilities", () =>
    Effect.gen(function* () {
      const { qemu } = yield* fixture({
        respond: (command) => [FakeSocket.errorLine(command.id, "GenericError", "no caps")],
      });
      const error = yield* Effect.flip(boot(qemu, FakeSocket.recorder().record));
      expect(error).toMatchObject({ _tag: "QemuStartError", message: "GenericError: no caps" });
      expect(error.cause).toMatchObject({ _tag: "QmpError" });
    }),
  );

  it.effect("surfaces a refused boot action as the DatabaseError itself", () =>
    Effect.gen(function* () {
      const { socket, qemu } = yield* fixture();
      const refused = Errors.DatabaseError.make({
        operation: "startAction",
        message: "Failed query: insert into actions",
      });
      const error = yield* Effect.flip(boot(qemu, () => Effect.fail(refused)));
      expect(error).toBe(refused);
      expect(socket.written).toEqual([]);
    }),
  );
});

describe("QemuHandle.sendKeys", () => {
  it.effect("sends one send-key per chord with 60 ms between chords", () =>
    Effect.gen(function* () {
      const { socket, qemu } = yield* fixture();
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      const recording = FakeSocket.recorder();
      const fiber = yield* Effect.forkChild(
        handle.sendKeys([["a"], ["shift", "b"], ["ret"]], recording.record),
      );
      yield* settle;
      expect(commands(socket)).toHaveLength(2);
      yield* TestClock.adjust(59);
      yield* settle;
      expect(commands(socket)).toHaveLength(2);
      yield* TestClock.adjust(1);
      yield* settle;
      expect(commands(socket)).toHaveLength(3);
      yield* TestClock.adjust(60);
      yield* settle;
      expect(commands(socket)).toHaveLength(4);
      yield* Fiber.join(fiber);
      expect(commands(socket).slice(1)).toEqual([
        { execute: "send-key", arguments: { keys: [{ type: "qcode", data: "a" }] }, id: 2 },
        {
          execute: "send-key",
          arguments: {
            keys: [
              { type: "qcode", data: "shift" },
              { type: "qcode", data: "b" },
            ],
          },
          id: 3,
        },
        { execute: "send-key", arguments: { keys: [{ type: "qcode", data: "ret" }] }, id: 4 },
      ]);
      expect(recording.outcomes.map((outcome) => outcome.state)).toEqual([
        "completed",
        "completed",
        "completed",
      ]);
    }),
  );

  it.effect("stops at the first failing chord", () =>
    Effect.gen(function* () {
      const { socket, qemu } = yield* fixture({
        respond: (command) =>
          command.id === 3
            ? [FakeSocket.errorLine(command.id, "GenericError", "bad key")]
            : FakeSocket.acceptAll(command),
      });
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      const fiber = yield* Effect.forkChild(
        Effect.flip(handle.sendKeys([["a"], ["b"], ["c"]], FakeSocket.recorder().record)),
      );
      yield* TestClock.adjust(1_000);
      const error = yield* Fiber.join(fiber);
      expect(error).toMatchObject({ _tag: "QmpError", desc: "bad key" });
      expect(commands(socket)).toHaveLength(3);
    }),
  );
});

describe("QemuHandle.sendMouse", () => {
  it.effect("moves the absolute pointer without a button", () =>
    Effect.gen(function* () {
      const { socket, qemu } = yield* fixture();
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      yield* handle.sendMouse({ x: 0.5, y: 0.25 }, FakeSocket.recorder().record);
      expect(commands(socket).slice(1)).toEqual([
        {
          execute: "input-send-event",
          arguments: {
            events: [
              { type: "abs", data: { axis: "x", value: 16384 } },
              { type: "abs", data: { axis: "y", value: 8192 } },
            ],
          },
          id: 2,
        },
      ]);
    }),
  );

  it.effect("presses and releases separately per click, 50 ms apart", () =>
    Effect.gen(function* () {
      const { socket, qemu } = yield* fixture();
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      const fiber = yield* Effect.forkChild(
        handle.sendMouse({ x: 1, y: 0, button: "left", clicks: 2 }, FakeSocket.recorder().record),
      );
      yield* settle;
      expect(commands(socket)).toHaveLength(3);
      yield* TestClock.adjust(49);
      yield* settle;
      expect(commands(socket)).toHaveLength(3);
      yield* TestClock.adjust(1);
      yield* settle;
      expect(commands(socket)).toHaveLength(5);
      yield* Fiber.join(fiber);
      const abs = [
        { type: "abs", data: { axis: "x", value: 32767 } },
        { type: "abs", data: { axis: "y", value: 0 } },
      ];
      const press = { type: "btn", data: { button: "left", down: true } };
      const release = { type: "btn", data: { button: "left", down: false } };
      expect(commands(socket).slice(1)).toEqual([
        { execute: "input-send-event", arguments: { events: [...abs, press] }, id: 2 },
        { execute: "input-send-event", arguments: { events: [release] }, id: 3 },
        { execute: "input-send-event", arguments: { events: [...abs, press] }, id: 4 },
        { execute: "input-send-event", arguments: { events: [release] }, id: 5 },
      ]);
    }),
  );

  it.effect("releases the button even when the press fails", () =>
    Effect.gen(function* () {
      const { socket, qemu } = yield* fixture({
        respond: (command) =>
          command.execute === "input-send-event" &&
          command.arguments.events.some((event) => event.type === "btn" && event.data.down)
            ? [FakeSocket.errorLine(command.id, "GenericError", "no tablet")]
            : FakeSocket.acceptAll(command),
      });
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      const error = yield* Effect.flip(
        handle.sendMouse({ x: 0, y: 0, button: "right", clicks: 3 }, FakeSocket.recorder().record),
      );
      expect(error).toMatchObject({ _tag: "QmpError", desc: "no tablet" });
      const sent = commands(socket).slice(1);
      expect(sent).toHaveLength(2);
      expect(sent[1]).toMatchObject({
        arguments: { events: [{ type: "btn", data: { button: "right", down: false } }] },
      });
    }),
  );

  const AXIS_MAX = 0x7fff;
  const at = (x: number, y: number): ReadonlyArray<Domain.QmpInputEvent> => [
    { type: "abs", data: { axis: "x", value: Math.round(x * AXIS_MAX) } },
    { type: "abs", data: { axis: "y", value: Math.round(y * AXIS_MAX) } },
  ];
  const down = (button: Domain.MouseButton): Domain.QmpInputEvent => ({
    type: "btn",
    data: { button, down: true },
  });
  const up = (button: Domain.MouseButton): Domain.QmpInputEvent => ({
    type: "btn",
    data: { button, down: false },
  });
  const key = (code: string, pressed: boolean): Domain.QmpInputEvent => ({
    type: "key",
    data: { down: pressed, key: { type: "qcode", data: code } },
  });
  const events = (
    socket: FakeSocket.FakeQmpSocket,
  ): ReadonlyArray<ReadonlyArray<Domain.QmpInputEvent>> =>
    commands(socket)
      .slice(1)
      .map((command) => (command.execute === "input-send-event" ? command.arguments.events : []));

  // One drag step at a time: the clock passes one 20 ms gap, then the exchange it released
  // round-trips before the next sleep is registered.
  const steps = (count: number) =>
    Effect.gen(function* () {
      for (let i = 0; i < count; i++) {
        yield* TestClock.adjust(20);
        yield* settle;
      }
    });

  it.effect(
    "drags: presses at the start, moves in eight steps 20 ms apart, releases at the end",
    () =>
      Effect.gen(function* () {
        const { socket, qemu } = yield* fixture();
        const handle = yield* boot(qemu, FakeSocket.recorder().record);
        const fiber = yield* Effect.forkChild(
          handle.sendMouse(
            { x: 0, y: 0, button: "left", path: [{ x: 1, y: 0 }] },
            FakeSocket.recorder().record,
          ),
        );
        yield* settle;
        expect(commands(socket)).toHaveLength(2);
        yield* TestClock.adjust(19);
        yield* settle;
        expect(commands(socket)).toHaveLength(2);
        yield* TestClock.adjust(1);
        yield* settle;
        expect(commands(socket)).toHaveLength(3);
        yield* steps(7);
        expect(commands(socket)).toHaveLength(10);
        yield* steps(1);
        yield* Fiber.join(fiber);
        const moves = [1, 2, 3, 4, 5, 6, 7, 8].map((step) => at(step / 8, 0));
        expect(events(socket)).toEqual([
          [...at(0, 0), down("left")],
          ...moves,
          [...at(1, 0), up("left")],
        ]);
      }),
  );

  it.effect(
    "a drag through several points interpolates every segment and releases at the last",
    () =>
      Effect.gen(function* () {
        const { socket, qemu } = yield* fixture();
        const handle = yield* boot(qemu, FakeSocket.recorder().record);
        const fiber = yield* Effect.forkChild(
          handle.sendMouse(
            {
              x: 0.5,
              y: 0.5,
              button: "right",
              path: [
                { x: 0.5, y: 1 },
                { x: 0, y: 1 },
              ],
            },
            FakeSocket.recorder().record,
          ),
        );
        yield* settle;
        yield* steps(17);
        yield* Fiber.join(fiber);
        const sent = events(socket);
        expect(sent).toHaveLength(18);
        expect(sent[0]).toEqual([...at(0.5, 0.5), down("right")]);
        expect(sent[8]).toEqual(at(0.5, 1));
        expect(sent[16]).toEqual(at(0, 1));
        expect(sent[17]).toEqual([...at(0, 1), up("right")]);
      }),
  );

  it.effect(
    "releases at the end of the drag even when a move fails, and fails with the move's error",
    () =>
      Effect.gen(function* () {
        const { socket, qemu } = yield* fixture({
          respond: (command) =>
            command.execute === "input-send-event" &&
            command.arguments.events.every((event) => event.type === "abs")
              ? [FakeSocket.errorLine(command.id, "GenericError", "no tablet")]
              : FakeSocket.acceptAll(command),
        });
        const handle = yield* boot(qemu, FakeSocket.recorder().record);
        const fiber = yield* Effect.forkChild(
          Effect.flip(
            handle.sendMouse(
              { x: 0, y: 0, button: "left", path: [{ x: 1, y: 1 }] },
              FakeSocket.recorder().record,
            ),
          ),
        );
        yield* settle;
        yield* steps(2);
        const error = yield* Fiber.join(fiber);
        expect(error).toMatchObject({ _tag: "QmpError", desc: "no tablet" });
        expect(events(socket)).toEqual([
          [...at(0, 0), down("left")],
          at(1 / 8, 1 / 8),
          [...at(1, 1), up("left")],
        ]);
      }),
  );

  it.effect("holds the modifiers before the click and lets them go after, in reverse order", () =>
    Effect.gen(function* () {
      const { socket, qemu } = yield* fixture();
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      yield* handle.sendMouse(
        { x: 0.5, y: 0.5, button: "left", modifiers: ["shift", "super"] },
        FakeSocket.recorder().record,
      );
      expect(events(socket)).toEqual([
        [key("shift", true), key("meta_l", true)],
        [...at(0.5, 0.5), down("left")],
        [up("left")],
        [key("meta_l", false), key("shift", false)],
      ]);
    }),
  );

  it.effect(
    "lets the modifiers go even when the click fails, and fails with the click's error",
    () =>
      Effect.gen(function* () {
        const { socket, qemu } = yield* fixture({
          respond: (command) =>
            command.execute === "input-send-event" &&
            command.arguments.events.some((event) => event.type === "btn" && event.data.down)
              ? [FakeSocket.errorLine(command.id, "GenericError", "no tablet")]
              : FakeSocket.acceptAll(command),
        });
        const handle = yield* boot(qemu, FakeSocket.recorder().record);
        const error = yield* Effect.flip(
          handle.sendMouse(
            { x: 0.5, y: 0.5, button: "left", modifiers: ["ctrl"] },
            FakeSocket.recorder().record,
          ),
        );
        expect(error).toMatchObject({ _tag: "QmpError", desc: "no tablet" });
        expect(events(socket)).toEqual([
          [key("ctrl", true)],
          [...at(0.5, 0.5), down("left")],
          [up("left")],
          [key("ctrl", false)],
        ]);
      }),
  );

  it.effect("skips the gesture but still lets the modifiers go when pressing them failed", () =>
    Effect.gen(function* () {
      // The row can be refused after QEMU took the keys, so a failed press is still released.
      const { socket, qemu } = yield* fixture({
        respond: (command) =>
          command.execute === "input-send-event" &&
          command.arguments.events.some((event) => event.type === "key" && event.data.down)
            ? [FakeSocket.errorLine(command.id, "GenericError", "no keyboard")]
            : FakeSocket.acceptAll(command),
      });
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      const error = yield* Effect.flip(
        handle.sendMouse(
          { x: 0.5, y: 0.5, button: "left", modifiers: ["alt"] },
          FakeSocket.recorder().record,
        ),
      );
      expect(error).toMatchObject({ _tag: "QmpError", desc: "no keyboard" });
      expect(events(socket)).toEqual([[key("alt", true)], [key("alt", false)]]);
    }),
  );

  it.effect("press down leaves the button held and press up lets it go, one exchange each", () =>
    Effect.gen(function* () {
      const { socket, qemu } = yield* fixture();
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      yield* handle.sendMouse(
        { x: 0.25, y: 0.25, button: "left", press: "down" },
        FakeSocket.recorder().record,
      );
      yield* handle.sendMouse(
        { x: 0.75, y: 0.75, button: "left", press: "up" },
        FakeSocket.recorder().record,
      );
      expect(events(socket)).toEqual([
        [...at(0.25, 0.25), down("left")],
        [...at(0.75, 0.75), up("left")],
      ]);
    }),
  );

  it.effect("a horizontal wheel button clicks like any other", () =>
    Effect.gen(function* () {
      const { socket, qemu } = yield* fixture();
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      yield* handle.sendMouse(
        { x: 0.5, y: 0.5, button: "wheel-left" },
        FakeSocket.recorder().record,
      );
      expect(events(socket)).toEqual([[...at(0.5, 0.5), down("wheel-left")], [up("wheel-left")]]);
    }),
  );
});

describe("QemuHandle.screendump", () => {
  it.effect("dumps to image-<hrtime>.png under the session dir, reads it and removes it", () =>
    Effect.gen(function* () {
      const { socket, fs, qemu } = yield* fixture();
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      const recording = FakeSocket.recorder();
      const bytes = yield* handle.screendump(recording.record);
      expect(bytes).toEqual(PNG);
      const dump = commands(socket)[1];
      expect(dump?.execute).toBe("screendump");
      const filename = dump?.execute === "screendump" ? dump.arguments.filename : "";
      expect(filename).toMatch(new RegExp(`^${DIR}/image-\\d+\\.png$`));
      expect(dump?.execute === "screendump" ? dump.arguments.format : "").toBe("png");
      expect(fs.calls.filter((call) => call.method === "readFile")).toEqual([
        { method: "readFile", args: [filename] },
      ]);
      expect(fs.calls.filter((call) => call.method === "remove")).toEqual([
        { method: "remove", args: [filename, { force: true }] },
      ]);
      expect(recording.outcomes).toEqual([{ state: "completed", response: { return: {}, id: 2 } }]);
    }),
  );

  it.effect("removes the file even when the exchange fails, and reads nothing", () =>
    Effect.gen(function* () {
      const { fs, qemu } = yield* fixture({
        respond: (command) =>
          command.execute === "screendump"
            ? [FakeSocket.errorLine(command.id, "GenericError", "no console")]
            : FakeSocket.acceptAll(command),
      });
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      const error = yield* Effect.flip(handle.screendump(FakeSocket.recorder().record));
      expect(error).toMatchObject({ _tag: "QmpError", desc: "no console" });
      expect(fs.calls.some((call) => call.method === "readFile")).toBe(false);
      expect(fs.calls.filter((call) => call.method === "remove")).toHaveLength(1);
    }),
  );

  it.effect(
    "fails with the platform error when the dump cannot be read, and still removes it",
    () =>
      Effect.gen(function* () {
        const { fs, qemu } = yield* fixture({ imageReadable: false });
        const handle = yield* boot(qemu, FakeSocket.recorder().record);
        const recording = FakeSocket.recorder();
        const error = yield* Effect.flip(handle.screendump(recording.record));
        expect(error._tag).toBe("PlatformError");
        expect(fs.calls.filter((call) => call.method === "readFile")).toHaveLength(1);
        expect(fs.calls.filter((call) => call.method === "remove")).toHaveLength(1);
        // The exchange itself completed; only the read failed.
        expect(recording.outcomes.map((outcome) => outcome.state)).toEqual(["completed"]);
      }),
  );
});

describe("QemuHandle.powerdown and exit", () => {
  it.effect("sends system_powerdown as one recorded exchange", () =>
    Effect.gen(function* () {
      const { socket, qemu } = yield* fixture();
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      const recording = FakeSocket.recorder();
      yield* handle.powerdown(recording.record);
      expect(commands(socket)[1]).toEqual({ execute: "system_powerdown", arguments: {}, id: 2 });
      expect(recording.outcomes).toEqual([{ state: "completed", response: { return: {}, id: 2 } }]);
    }),
  );

  it.effect("fails with QEMU's refusal and records the exchange failed", () =>
    Effect.gen(function* () {
      const { qemu } = yield* fixture({
        respond: (command) =>
          command.execute === "system_powerdown"
            ? [FakeSocket.errorLine(command.id, "GenericError", "no ACPI")]
            : FakeSocket.acceptAll(command),
      });
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      const recording = FakeSocket.recorder();
      const error = yield* Effect.flip(handle.powerdown(recording.record));
      expect(error).toMatchObject({ _tag: "QmpError", desc: "no ACPI" });
      expect(recording.outcomes.map((outcome) => outcome.state)).toEqual(["failed"]);
    }),
  );

  it.effect("reports the machine running until QEMU exits, then its exit code", () =>
    Effect.gen(function* () {
      const { spawner, qemu } = yield* fixture();
      const handle = yield* boot(qemu, FakeSocket.recorder().record);
      expect(yield* handle.running).toBe(true);
      const exited = yield* Effect.forkChild(handle.exited);
      yield* Effect.yieldNow;
      expect(exited.pollUnsafe()).toBeUndefined();
      yield* spawner.spawned[1]?.exit(0) ?? Effect.void;
      expect(yield* Fiber.join(exited)).toBe(0);
      expect(yield* handle.running).toBe(false);
    }),
  );
});

describe("Qemu scope", () => {
  it.effect("closing the scope kills QEMU, closes the socket and removes the session dir", () =>
    Effect.gen(function* () {
      const { events, socket, spawner, fs, qemu } = yield* fixture();
      const scope = yield* Scope.make();
      yield* boot(qemu, FakeSocket.recorder().record).pipe(Scope.provide(scope));
      const original = fs.calls.length;
      yield* Scope.close(scope, Exit.void);
      const removes = fs.calls.slice(original).filter((call) => call.method === "remove");
      expect(removes).toEqual([
        { method: "remove", args: [DIR, { recursive: true, force: true }] },
      ]);
      expect(spawner.spawned[1]?.isReleased()).toBe(true);
      expect(spawner.spawned[1]?.kills).toEqual(["SIGTERM"]);
      expect(socket.isClosed()).toBe(true);
      // The dir goes last: QEMU is dead and the socket closed before it is removed.
      expect(events.at(-1)).toBe(`remove ${DIR} released=true closed=true`);
    }),
  );

  it.effect("rejects an in-flight command with `qemu: closed` when the scope closes", () =>
    Effect.gen(function* () {
      const { qemu } = yield* fixture({
        respond: (command) =>
          command.execute === "qmp_capabilities" ? FakeSocket.acceptAll(command) : [],
      });
      const scope = yield* Scope.make();
      const handle = yield* boot(qemu, FakeSocket.recorder().record).pipe(Scope.provide(scope));
      const recording = FakeSocket.recorder();
      const fiber = yield* Effect.forkChild(
        Effect.flip(handle.sendKeys([["a"]], recording.record)),
      );
      yield* Effect.yieldNow;
      yield* Scope.close(scope, Exit.void);
      expect(yield* Fiber.join(fiber)).toMatchObject({
        _tag: "QmpClosed",
        message: "qemu: closed",
      });
      expect(recording.outcomes).toEqual([{ state: "failed", response: "qemu: closed" }]);
      // The client is gone for good: a later command is refused the same way.
      const again = yield* Effect.flip(handle.sendKeys([["b"]], FakeSocket.recorder().record));
      expect(again).toMatchObject({ _tag: "QmpClosed", message: "qemu: closed" });
    }),
  );
});
