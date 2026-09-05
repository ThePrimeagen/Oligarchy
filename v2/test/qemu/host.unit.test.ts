import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as Args from "../../src/qemu/args.ts";
import * as Host from "../../src/qemu/host.ts";
import type * as Domain from "../../src/shared/domain.ts";
import * as Support from "../support/config.ts";
import * as FakeFs from "../support/fake-fs.ts";
import * as FakeSpawner from "../support/fake-spawner.ts";

const HELP = "Available display backend types:\nnone\ngtk\nsdl\negl-headless\nspice-app\ndbus\n";

type Fixture = {
  readonly binaries?: ReadonlyArray<string>;
  readonly entries?: FakeFs.Entries;
  readonly help?: string;
  readonly env?: Record<string, string>;
};

const ALL_ENTRIES: FakeFs.Entries = {
  [Args.OVMF_CODE]: "File",
  [Args.OVMF_VARS]: "File",
  "/dev/kvm": "CharacterDevice",
  "/dev/dri": "Directory",
  "/dev/dri/card0": "CharacterDevice",
  "/dev/dri/renderD128": "CharacterDevice",
};

const check = (display: Domain.QemuDisplay, fixture: Fixture = {}) =>
  Effect.gen(function* () {
    const binaries = fixture.binaries ?? [Args.QEMU_BIN, Args.QEMU_IMG];
    const spawner = FakeSpawner.fakeSpawner((command, args) => {
      if (command === "/bin/sh") {
        const wanted = args[1]?.replace("command -v ", "") ?? "";
        return { exitCode: binaries.includes(wanted) ? 0 : 1 };
      }
      return { exitCode: 0, stdout: fixture.help ?? HELP };
    });
    const fs = FakeFs.recordingFs(fixture.entries ?? ALL_ENTRIES);
    const missing = yield* Host.missingHostRequirements(display).pipe(
      Effect.provide(
        Layer.mergeAll(spawner.layer, fs.layer, Support.withEnv(fixture.env ?? { DISPLAY: ":0" })),
      ),
    );
    return { missing, spawner, fs };
  });

describe("missingHostRequirements happy path", () => {
  it.effect("reports nothing when every requirement is present", () =>
    Effect.gen(function* () {
      const { missing, spawner } = yield* check("none");
      expect(missing).toEqual([]);
      expect(spawner.spawned.map((spawned) => spawned.args.join(" "))).toEqual([
        "-c command -v qemu-system-x86_64",
        "-c command -v qemu-img",
      ]);
    }),
  );

  it.effect("checks the display backend against -display help for a non-none display", () =>
    Effect.gen(function* () {
      const { missing, spawner } = yield* check("gtk");
      expect(missing).toEqual([]);
      expect(spawner.spawned.at(-1)).toMatchObject({
        command: Args.QEMU_BIN,
        args: ["-display", "help"],
      });
    }),
  );

  it.effect("accepts egl-headless with a render node present", () =>
    Effect.gen(function* () {
      const { missing } = yield* check("egl-headless");
      expect(missing).toEqual([]);
    }),
  );
});

describe("missingHostRequirements unhappy path", () => {
  it.effect("names a missing qemu binary and skips the display probe", () =>
    Effect.gen(function* () {
      const { missing, spawner } = yield* check("gtk", { binaries: [Args.QEMU_IMG] });
      expect(missing).toEqual(["qemu-system-x86_64 not on PATH"]);
      expect(spawner.spawned.some((spawned) => spawned.command === Args.QEMU_BIN)).toBe(false);
    }),
  );

  it.effect("names a missing qemu-img", () =>
    Effect.gen(function* () {
      const { missing } = yield* check("none", { binaries: [Args.QEMU_BIN] });
      expect(missing).toEqual(["qemu-img not on PATH"]);
    }),
  );

  it.effect("names missing OVMF code and vars with their paths", () =>
    Effect.gen(function* () {
      const { missing } = yield* check("none", {
        entries: { "/dev/kvm": "CharacterDevice" },
      });
      expect(missing).toEqual([
        "OVMF code not found: /usr/share/edk2/x64/OVMF_CODE.4m.fd",
        "OVMF vars not found: /usr/share/edk2/x64/OVMF_VARS.4m.fd",
      ]);
    }),
  );

  it.effect("names an unusable /dev/kvm", () =>
    Effect.gen(function* () {
      const { missing } = yield* check("none", {
        entries: { [Args.OVMF_CODE]: "File", [Args.OVMF_VARS]: "File" },
      });
      expect(missing).toEqual(["/dev/kvm is not readable and writable (needed for accel=kvm)"]);
    }),
  );

  it.effect("requires DISPLAY for gtk, treating an empty value as unset", () =>
    Effect.gen(function* () {
      const unset = yield* check("gtk", { env: {} });
      expect(unset.missing).toEqual(["DISPLAY is not set (needed for --display gtk)"]);
      const empty = yield* check("gtk", { env: { DISPLAY: "" } });
      expect(empty.missing).toEqual(["DISPLAY is not set (needed for --display gtk)"]);
    }),
  );

  it.effect("requires a DRM render node for egl-headless", () =>
    Effect.gen(function* () {
      const { missing } = yield* check("egl-headless", {
        entries: {
          [Args.OVMF_CODE]: "File",
          [Args.OVMF_VARS]: "File",
          "/dev/kvm": "CharacterDevice",
          "/dev/dri": "Directory",
          "/dev/dri/card0": "CharacterDevice",
        },
      });
      expect(missing).toEqual([
        "no DRM render node in /dev/dri (needed for --display egl-headless)",
      ]);
    }),
  );

  it.effect("names a missing /dev/dri for egl-headless", () =>
    Effect.gen(function* () {
      const { missing } = yield* check("egl-headless", {
        entries: {
          [Args.OVMF_CODE]: "File",
          [Args.OVMF_VARS]: "File",
          "/dev/kvm": "CharacterDevice",
        },
      });
      expect(missing).toEqual(["/dev/dri not found (needed for --display egl-headless)"]);
    }),
  );

  it.effect("names a display backend QEMU was built without", () =>
    Effect.gen(function* () {
      const { missing } = yield* check("sdl", {
        help: "Available display backend types:\nnone\ngtk\n",
      });
      expect(missing).toEqual(["qemu-system-x86_64 was built without display backend sdl"]);
    }),
  );

  it.effect("treats a failing -display help as a missing backend", () =>
    Effect.gen(function* () {
      const spawner = FakeSpawner.fakeSpawner((command) =>
        command === "/bin/sh" ? { exitCode: 0 } : { spawnError: "spawn EACCES" },
      );
      const fs = FakeFs.recordingFs(ALL_ENTRIES);
      const missing = yield* Host.missingHostRequirements("dbus").pipe(
        Effect.provide(Layer.mergeAll(spawner.layer, fs.layer, Support.withEnv({}))),
      );
      expect(missing).toEqual(["qemu-system-x86_64 was built without display backend dbus"]);
    }),
  );

  it.effect("lists every missing requirement in check order", () =>
    Effect.gen(function* () {
      const { missing } = yield* check("gtk", { binaries: [], entries: {}, env: {} });
      expect(missing).toEqual([
        "qemu-system-x86_64 not on PATH",
        "qemu-img not on PATH",
        "OVMF code not found: /usr/share/edk2/x64/OVMF_CODE.4m.fd",
        "OVMF vars not found: /usr/share/edk2/x64/OVMF_VARS.4m.fd",
        "/dev/kvm is not readable and writable (needed for accel=kvm)",
        "DISPLAY is not set (needed for --display gtk)",
      ]);
    }),
  );
});
