import * as Domain from "../shared/domain.ts";

export const QEMU_BIN = "qemu-system-x86_64";
export const QEMU_IMG = "qemu-img";
export const DEFAULT_DISK_SIZE = "40G";
export const OVMF_CODE = "/usr/share/edk2/x64/OVMF_CODE.4m.fd";
export const OVMF_VARS = "/usr/share/edk2/x64/OVMF_VARS.4m.fd";
const MEMORY = "4G";
const SMP = 2;
const MACHINE = "q35,accel=kvm";
const CPU = "host";

// `-display help` minus curses, which needs QEMU's stdio and the proxy detaches it.
export const QEMU_DISPLAYS: ReadonlyArray<Domain.QemuDisplay> = Domain.QemuDisplay.literals;

export type ArgsInput = {
  readonly sockPath: string;
  readonly serialPath: string;
  readonly varsPath: string;
  readonly diskPath: string;
  readonly iso: string;
  readonly display: Domain.QemuDisplay;
  readonly automation: boolean;
};

export const qemuArgs = (input: ArgsInput): ReadonlyArray<string> => {
  // -vga none without a replacement device removes the console screendump reads.
  const vga = input.automation ? ["-vga", "none", "-device", "virtio-vga"] : [];
  return [
    "-machine",
    MACHINE,
    "-cpu",
    CPU,
    "-m",
    MEMORY,
    "-smp",
    String(SMP),
    "-drive",
    `if=pflash,format=raw,readonly=on,file=${OVMF_CODE}`,
    "-drive",
    `if=pflash,format=raw,file=${input.varsPath}`,
    "-display",
    input.display,
    ...vga,
    // usb-tablet is the absolute pointer; without it, input-send-event abs has no handler.
    "-device",
    "qemu-xhci",
    "-device",
    "usb-tablet",
    "-chardev",
    `socket,id=qmp,path=${input.sockPath}`,
    "-mon",
    "chardev=qmp,mode=control",
    "-chardev",
    `file,id=serial,path=${input.serialPath}`,
    "-serial",
    "chardev:serial",
    "-cdrom",
    input.iso,
    "-boot",
    "order=d",
    "-drive",
    `file=${input.diskPath},if=virtio,format=qcow2`,
  ];
};
