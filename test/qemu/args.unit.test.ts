import { describe, expect, it } from "vitest";
import * as Args from "../../src/qemu/args.ts";

const paths = {
  sockPath: "/tmp/oligarchy-1/qmp.sock",
  serialPath: "/tmp/oligarchy-1/serial.log",
  varsPath: "/tmp/oligarchy-1/OVMF_VARS.fd",
  diskPath: "/tmp/oligarchy-1/disk.qcow2",
  iso: "/isos/omarchy.iso",
};

const expected = (display: string, vga: ReadonlyArray<string>): ReadonlyArray<string> => [
  "-machine",
  "q35,accel=kvm",
  "-cpu",
  "host",
  "-m",
  "4G",
  "-smp",
  "2",
  "-drive",
  "if=pflash,format=raw,readonly=on,file=/usr/share/edk2/x64/OVMF_CODE.4m.fd",
  "-drive",
  "if=pflash,format=raw,file=/tmp/oligarchy-1/OVMF_VARS.fd",
  "-display",
  display,
  ...vga,
  "-device",
  "qemu-xhci",
  "-device",
  "usb-tablet",
  "-chardev",
  "socket,id=qmp,path=/tmp/oligarchy-1/qmp.sock",
  "-mon",
  "chardev=qmp,mode=control",
  "-chardev",
  "file,id=serial,path=/tmp/oligarchy-1/serial.log",
  "-serial",
  "chardev:serial",
  "-cdrom",
  "/isos/omarchy.iso",
  "-boot",
  "order=d",
  "-drive",
  "file=/tmp/oligarchy-1/disk.qcow2,if=virtio,format=qcow2",
];

describe("qemuArgs happy path", () => {
  it("produces the verbatim list for the default display", () => {
    expect(Args.qemuArgs({ ...paths, display: "none", automation: false })).toEqual(
      expected("none", []),
    );
  });

  it("passes --display gtk through", () => {
    expect(Args.qemuArgs({ ...paths, display: "gtk", automation: false })).toEqual(
      expected("gtk", []),
    );
  });

  it("adds -vga none -device virtio-vga under --automation", () => {
    expect(Args.qemuArgs({ ...paths, display: "none", automation: true })).toEqual(
      expected("none", ["-vga", "none", "-device", "virtio-vga"]),
    );
  });

  it("places a caller-provided disk and iso at their positions", () => {
    const args = Args.qemuArgs({
      ...paths,
      diskPath: "/mnt/custom.qcow2",
      iso: "https-cache/omarchy.iso",
      display: "none",
      automation: false,
    });
    expect(args.at(-1)).toBe("file=/mnt/custom.qcow2,if=virtio,format=qcow2");
    expect(args[args.indexOf("-cdrom") + 1]).toBe("https-cache/omarchy.iso");
  });
});
