import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import * as Args from "../../src/qemu/args.ts";
import * as Process from "../../src/qemu/process.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";

const ARGS = ["-machine", "q35,accel=kvm", "-display", "none"];

describe("spawnQemu happy path", () => {
  it.effect("spawns the binary with piped stderr only and the inherited environment", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({}));
      const process = yield* Process.spawnQemu(ARGS).pipe(Effect.provide(spawner.layer));
      expect(spawner.spawned).toHaveLength(1);
      const [spawned] = spawner.spawned;
      expect(spawned?.command).toBe(Args.QEMU_BIN);
      expect(spawned?.args).toEqual(ARGS);
      expect(spawned?.options).toMatchObject({
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
        extendEnv: true,
        detached: false,
      });
      expect(yield* process.withStderr("qemu: handshake timeout")).toBe("qemu: handshake timeout");
    }),
  );

  it.effect("keeps only the last 4096 bytes of stderr", () =>
    Effect.gen(function* () {
      const noise = "x".repeat(5000);
      const spawner = FakeSpawner.fakeSpawner(() => ({ stderr: `${noise}END` }));
      const process = yield* Process.spawnQemu(ARGS).pipe(Effect.provide(spawner.layer));
      yield* spawner.spawned[0]?.exit(0) ?? Effect.void;
      expect(yield* process.exited).toBe(0);
      const tail = (yield* process.withStderr("qemu")).slice("qemu: ".length);
      expect(tail).toHaveLength(Process.STDERR_TAIL_BYTES);
      expect(tail.endsWith("END")).toBe(true);
    }),
  );

  it.effect("exposes the raw stderr tail, including when it is empty", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ stderr: "  kvm: not available\n" }));
      const process = yield* Process.spawnQemu(ARGS).pipe(Effect.provide(spawner.layer));
      yield* spawner.spawned[0]?.exit(1) ?? Effect.void;
      yield* process.exited;
      expect(yield* process.stderrTail).toBe("  kvm: not available\n");
      const quiet = FakeSpawner.fakeSpawner(() => ({}));
      const silent = yield* Process.spawnQemu(ARGS).pipe(Effect.provide(quiet.layer));
      expect(yield* silent.stderrTail).toBe("");
    }),
  );

  it.effect("appends the trimmed stderr tail to a message, or nothing when empty", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ stderr: "  kvm: not available\n" }));
      const process = yield* Process.spawnQemu(ARGS).pipe(Effect.provide(spawner.layer));
      yield* spawner.spawned[0]?.exit(1) ?? Effect.void;
      yield* process.exited;
      expect(yield* process.withStderr("qemu: handshake timeout")).toBe(
        "qemu: handshake timeout: kvm: not available",
      );
      const quiet = FakeSpawner.fakeSpawner(() => ({}));
      const silent = yield* Process.spawnQemu(ARGS).pipe(Effect.provide(quiet.layer));
      expect(yield* silent.withStderr("qemu: handshake timeout")).toBe("qemu: handshake timeout");
    }),
  );

  it.effect("kills the process when the scope closes", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({}));
      yield* Effect.scoped(Process.spawnQemu(ARGS)).pipe(Effect.provide(spawner.layer));
      const [spawned] = spawner.spawned;
      expect(spawned?.isReleased()).toBe(true);
      expect(spawned?.kills).toEqual(["SIGTERM"]);
      expect(yield* spawned?.isRunning ?? Effect.succeed(true)).toBe(false);
    }),
  );
});

describe("spawnQemu unhappy path", () => {
  it.effect("reports an exit before QMP connect only once stderr is drained", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        stderr: "qemu-system-x86_64: -accel kvm:",
      }));
      const process = yield* Process.spawnQemu(ARGS).pipe(Effect.provide(spawner.layer));
      const failing = yield* Effect.forkChild(Effect.flip(process.exitedBeforeConnect));
      yield* Effect.yieldNow;
      expect(failing.pollUnsafe()).toBeUndefined();
      yield* (
        spawner.spawned[0]?.exit(1, " failed to initialize kvm: Permission denied\n") ?? Effect.void
      );
      const error = yield* Fiber.join(failing);
      expect(error._tag).toBe("QemuStartError");
      expect(error.message).toBe(
        "qemu: exited 1 before QMP connect: qemu-system-x86_64: -accel kvm: failed to initialize kvm: Permission denied",
      );
    }),
  );

  it.effect("reports a silent exit without a trailing colon", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({}));
      const process = yield* Process.spawnQemu(ARGS).pipe(Effect.provide(spawner.layer));
      yield* spawner.spawned[0]?.exit(127) ?? Effect.void;
      const error = yield* Effect.flip(process.exitedBeforeConnect);
      expect(error.message).toBe("qemu: exited 127 before QMP connect");
    }),
  );

  it.effect("reports a signal death as a null exit code", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({}));
      const process = yield* Process.spawnQemu(ARGS).pipe(Effect.provide(spawner.layer));
      const exited = yield* Effect.forkChild(process.exited);
      yield* Effect.yieldNow;
      expect(exited.pollUnsafe()).toBeUndefined();
      yield* spawner.spawned[0]?.die("SIGKILL") ?? Effect.void;
      expect(yield* Fiber.join(exited)).toBeNull();
      const error = yield* Effect.flip(process.exitedBeforeConnect);
      expect(error.message).toBe("qemu: exited null before QMP connect");
    }),
  );

  it.effect("fails `qemu: <message>` when the binary cannot be spawned", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        spawnError: "spawn qemu-system-x86_64 ENOENT",
      }));
      const error = yield* Effect.flip(Process.spawnQemu(ARGS).pipe(Effect.provide(spawner.layer)));
      expect(error._tag).toBe("QemuStartError");
      expect(error.message).toBe("qemu: spawn qemu-system-x86_64 ENOENT");
    }),
  );
});

describe("createDisk", () => {
  it.effect("runs qemu-img create with the qcow2 format, path and size", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 0 }));
      yield* Process.createDisk("/tmp/oligarchy-1/disk.qcow2", "40G").pipe(
        Effect.provide(spawner.layer),
      );
      expect(spawner.spawned).toMatchObject([
        {
          command: Args.QEMU_IMG,
          args: ["create", "-f", "qcow2", "/tmp/oligarchy-1/disk.qcow2", "40G"],
          options: { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
        },
      ]);
    }),
  );

  it.effect("fails `qemu-img create exited <code>` on a non-zero exit", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ exitCode: 3 }));
      const error = yield* Effect.flip(
        Process.createDisk("/tmp/oligarchy-1/disk.qcow2", "40G").pipe(
          Effect.provide(spawner.layer),
        ),
      );
      expect(error._tag).toBe("QemuStartError");
      expect(error.message).toBe("qemu-img create exited 3");
    }),
  );

  it.effect("fails with the spawn error when qemu-img cannot run", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ spawnError: "spawn qemu-img ENOENT" }));
      const error = yield* Effect.flip(
        Process.createDisk("/tmp/disk.qcow2", "40G").pipe(Effect.provide(spawner.layer)),
      );
      expect(error.message).toBe("qemu-img: spawn qemu-img ENOENT");
    }),
  );
});

describe("commandExists and displayHelp", () => {
  it.effect("is true when `command -v` exits 0 and false otherwise", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner((_, args) => ({
        exitCode: args[1] === "command -v sh" ? 0 : 1,
      }));
      expect(yield* Process.commandExists("sh").pipe(Effect.provide(spawner.layer))).toBe(true);
      expect(
        yield* Process.commandExists("no-such-bin-xyz").pipe(Effect.provide(spawner.layer)),
      ).toBe(false);
      expect(spawner.spawned.map((spawned) => [spawned.command, ...spawned.args])).toEqual([
        ["/bin/sh", "-c", "command -v sh"],
        ["/bin/sh", "-c", "command -v no-such-bin-xyz"],
      ]);
    }),
  );

  it.effect("is false when the shell itself cannot be spawned", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ spawnError: "spawn /bin/sh ENOENT" }));
      expect(yield* Process.commandExists("sh").pipe(Effect.provide(spawner.layer))).toBe(false);
    }),
  );

  it.effect("returns stdout and stderr of `-display help` together", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({
        exitCode: 0,
        stdout: "Available display backend types:\nnone\n",
        stderr: "gtk\n",
      }));
      const help = yield* Process.displayHelp.pipe(Effect.provide(spawner.layer));
      expect(help.split("\n").map((line) => line.trim())).toContain("none");
      expect(help.split("\n").map((line) => line.trim())).toContain("gtk");
      expect(spawner.spawned).toMatchObject([
        { command: Args.QEMU_BIN, args: ["-display", "help"] },
      ]);
    }),
  );

  it.effect("fails as a PlatformError when the binary cannot be spawned", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner(() => ({ spawnError: "spawn EACCES" }));
      const error = yield* Effect.flip(Process.displayHelp.pipe(Effect.provide(spawner.layer)));
      expect(error._tag).toBe("PlatformError");
    }),
  );
});
