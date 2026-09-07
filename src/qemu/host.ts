import { Config, Effect, FileSystem, Option } from "effect";
import type * as Domain from "../shared/domain.ts";
import * as Args from "./args.ts";
import * as Process from "./process.ts";

const FIRMWARE = [
  [Args.OVMF_CODE, "OVMF code"],
  [Args.OVMF_VARS, "OVMF vars"],
] as const;

// Read through the ConfigProvider so the check sees the same environment as the rest of the
// proxy; an absent or empty DISPLAY both count as unset.
const displayVariable = Config.string("DISPLAY").pipe(Effect.orElseSucceed(() => ""));

export const missingHostRequirements = Effect.fn("Host.missingHostRequirements")(function* (
  display: Domain.QemuDisplay,
) {
  const fs = yield* FileSystem.FileSystem;
  const missing: Array<string> = [];
  let qemuFound = false;
  for (const bin of [Args.QEMU_BIN, Args.QEMU_IMG]) {
    const found = yield* Process.commandExists(bin);
    if (bin === Args.QEMU_BIN) {
      qemuFound = found;
    }
    if (!found) {
      missing.push(`${bin} not on PATH`);
    }
  }
  for (const [path, label] of FIRMWARE) {
    const present = yield* fs.stat(path).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (!present) {
      missing.push(`${label} not found: ${path}`);
    }
  }
  // Every session boots with accel=kvm, so the device must be usable by this process.
  const kvm = yield* fs.access("/dev/kvm", { readable: true, writable: true }).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
  if (!kvm) {
    missing.push("/dev/kvm is not readable and writable (needed for accel=kvm)");
  }
  if (display === "gtk" && (yield* displayVariable) === "") {
    missing.push("DISPLAY is not set (needed for --display gtk)");
  }
  if (display === "egl-headless") {
    const nodes = yield* Effect.option(fs.readDirectory("/dev/dri"));
    Option.match(nodes, {
      onNone: () => {
        missing.push("/dev/dri not found (needed for --display egl-headless)");
      },
      onSome: (names) => {
        if (!names.some((name) => name.startsWith("renderD"))) {
          missing.push("no DRM render node in /dev/dri (needed for --display egl-headless)");
        }
      },
    });
  }
  if (display !== "none" && qemuFound) {
    const help = yield* Process.displayHelp.pipe(Effect.orElseSucceed(() => ""));
    if (
      !help
        .split("\n")
        .map((line) => line.trim())
        .includes(display)
    ) {
      missing.push(`${Args.QEMU_BIN} was built without display backend ${display}`);
    }
  }
  return missing;
});
