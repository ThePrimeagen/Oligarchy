import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Effect, Exit, Scope } from "effect";
import * as Process from "../../src/qemu/process.ts";

let bin = "";
let originalPath = "";

// A directory of stand-in executables put first on PATH for the duration of a test.
beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), "oligarchy-bin-"));
  originalPath = process.env.PATH ?? "";
  process.env.PATH = `${bin}:${originalPath}`;
});

afterEach(() => {
  process.env.PATH = originalPath;
  rmSync(bin, { recursive: true, force: true });
});

const install = (name: string, script: string): void => {
  const file = join(bin, name);
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// The stderr tail as `withStderr` renders it, once the expected text has arrived.
const untilStderr = (spawned: Process.QemuProcess, expected: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt++) {
      const text = yield* spawned.withStderr("tail");
      if (text.includes(expected)) {
        return text;
      }
      yield* Effect.sleep("10 millis");
    }
    return yield* spawned.withStderr("tail");
  });

describe("spawn", () => {
  it.live("captures the stderr tail of a running process and kills it when the scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const pidFile = join(bin, "child.pid");
      const spawned = yield* Process.spawn("sh", [
        "-c",
        `echo $$ > "${pidFile}"; echo err >&2; exec sleep 30`,
      ]).pipe(Scope.provide(scope), Effect.provide(NodeServices.layer));
      expect(yield* untilStderr(spawned, "err")).toBe("tail: err");
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      expect(alive(pid)).toBe(true);
      yield* Scope.close(scope, Exit.void);
      expect(alive(pid)).toBe(false);
    }),
  );

  it.live("reports a signal death as a null exit code", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const spawned = yield* Process.spawn("sh", ["-c", "echo dying >&2; kill -9 $$"]);
        expect(yield* spawned.exited).toBeNull();
        const error = yield* Effect.flip(spawned.exitedBeforeConnect);
        expect(error.message).toBe("qemu: exited null before QMP connect: dying");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("reports an exit before QMP connect with the drained stderr", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const spawned = yield* Process.spawn("sh", ["-c", "echo err >&2; exit 7"]);
        const error = yield* Effect.flip(spawned.exitedBeforeConnect);
        expect(error._tag).toBe("QemuStartError");
        expect(error.message).toBe("qemu: exited 7 before QMP connect: err");
        expect(yield* spawned.exited).toBe(7);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("fails `qemu: <message>` when the executable does not exist", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const error = yield* Effect.flip(Process.spawn("no-such-bin-xyz", ["--version"]));
        expect(error._tag).toBe("QemuStartError");
        expect(error.message).toContain("no-such-bin-xyz");
        expect(error.message).toContain("ENOENT");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("spawnQemu runs the stand-in qemu-system-x86_64 from PATH", () =>
    Effect.scoped(
      Effect.gen(function* () {
        install("qemu-system-x86_64", 'echo "args: $*" >&2; exit 3');
        const spawned = yield* Process.spawnQemu(["-display", "none"]);
        const error = yield* Effect.flip(spawned.exitedBeforeConnect);
        expect(error.message).toBe("qemu: exited 3 before QMP connect: args: -display none");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("commandExists, displayHelp and createDisk", () => {
  it.live("finds sh and not a made-up binary", () =>
    Effect.gen(function* () {
      expect(yield* Process.commandExists("sh")).toBe(true);
      expect(yield* Process.commandExists("no-such-bin-xyz")).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("reads -display help from the stand-in binary, stdout and stderr together", () =>
    Effect.gen(function* () {
      install(
        "qemu-system-x86_64",
        'echo "Available display backend types:"; echo none; echo gtk >&2',
      );
      const help = yield* Process.displayHelp;
      const lines = help.split("\n").map((line) => line.trim());
      expect(lines).toContain("none");
      expect(lines).toContain("gtk");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("createDisk succeeds when qemu-img exits 0 and passes the qcow2 arguments", () =>
    Effect.gen(function* () {
      const record = join(bin, "qemu-img.args");
      install("qemu-img", `echo "$*" > "${record}"; exit 0`);
      yield* Process.createDisk(join(bin, "disk.qcow2"), "40G");
      expect(readFileSync(record, "utf8")).toBe(`create -f qcow2 ${join(bin, "disk.qcow2")} 40G\n`);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("createDisk fails `qemu-img create exited <code>` when qemu-img fails", () =>
    Effect.gen(function* () {
      install("qemu-img", "exit 3");
      const error = yield* Effect.flip(Process.createDisk(join(bin, "disk.qcow2"), "40G"));
      expect(error._tag).toBe("QemuStartError");
      expect(error.message).toBe("qemu-img create exited 3");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
