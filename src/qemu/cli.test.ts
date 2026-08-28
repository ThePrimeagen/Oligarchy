import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { DEFAULT_ISO, QemuCLI, qemuArgs } from "./cli.ts";

// Fake qemu-img: creates the target file, fails on a bad size the way the
// real binary does. Lets us test our wrapper without qemu installed.
const FAKE_QEMU_IMG = `#!/usr/bin/env node
const fs = require("node:fs");
const [, , cmd, dashF, fmt, path, size] = process.argv;
if (cmd !== "create" || dashF !== "-f" || fmt !== "qcow2") process.exit(2);
if (!/^\\d+[kKMGTP]?$/.test(size)) {
  console.error("qemu-img: Invalid image size specified.");
  process.exit(1);
}
fs.writeFileSync(path, "fake-qcow2");
`;

// Fake qemu-system-x86_64: connects to the QMP unix socket given via
// -chardev, sends the greeting, and answers every execute with an empty
// return. Stays alive until killed, like the real guest would.
const FAKE_QEMU = `#!/usr/bin/env node
const net = require("node:net");
const prefix = "socket,id=qmp,path=";
const arg = process.argv.find((a) => a.startsWith(prefix));
if (arg === undefined) process.exit(2);
const sock = net.connect(arg.slice(prefix.length), () => {
  sock.write(JSON.stringify({ QMP: { version: {}, capabilities: [] } }) + "\\n");
});
let buf = "";
sock.on("data", (chunk) => {
  buf += chunk.toString();
  const lines = buf.split("\\n");
  buf = lines.pop();
  for (const line of lines) {
    if (line.trim() === "") continue;
    const msg = JSON.parse(line);
    sock.write(JSON.stringify({ return: {}, id: msg.id }) + "\\n");
  }
});
sock.on("close", () => process.exit(0));
setInterval(() => {}, 60000);
`;

let fixtures: string;
let fakeBin: string;
let emptyBin: string;
let varsFile: string;
let isoFile: string;
const origPath = process.env.PATH ?? "";

before(async () => {
  fixtures = await mkdtemp(join(tmpdir(), "oligarchy-test-"));
  fakeBin = join(fixtures, "bin");
  emptyBin = join(fixtures, "empty-bin");
  await mkdir(fakeBin);
  await mkdir(emptyBin);
  await writeFile(join(fakeBin, "qemu-img"), FAKE_QEMU_IMG, { mode: 0o755 });
  await writeFile(join(fakeBin, "qemu-system-x86_64"), FAKE_QEMU, { mode: 0o755 });
  varsFile = join(fixtures, "OVMF_VARS.fd");
  isoFile = join(fixtures, "fake.iso");
  await writeFile(varsFile, "vars");
  await writeFile(isoFile, "iso");
  process.env.PATH = `${fakeBin}:${origPath}`;
});

after(async () => {
  process.env.PATH = origPath;
  await rm(fixtures, { recursive: true, force: true });
});

describe("qemuArgs happy path", () => {
  it("builds the exact argument vector the Go wrapper execs", () => {
    const args = qemuArgs({
      sockPath: "/tmp/s/qmp.sock",
      varsPath: "/tmp/s/OVMF_VARS.fd",
      diskPath: "/tmp/s/disk.qcow2",
      iso: "/isos/omarchy.iso",
      code: "/fw/OVMF_CODE.4m.fd",
      memory: "4G",
      smp: 2,
    });
    assert.deepEqual(args, [
      "-machine",
      "q35,accel=kvm",
      "-cpu",
      "host",
      "-m",
      "4G",
      "-smp",
      "2",
      "-drive",
      "if=pflash,format=raw,readonly=on,file=/fw/OVMF_CODE.4m.fd",
      "-drive",
      "if=pflash,format=raw,file=/tmp/s/OVMF_VARS.fd",
      "-display",
      "gtk",
      "-chardev",
      "socket,id=qmp,path=/tmp/s/qmp.sock",
      "-mon",
      "chardev=qmp,mode=control",
      "-cdrom",
      "/isos/omarchy.iso",
      "-boot",
      "order=d",
      "-drive",
      "file=/tmp/s/disk.qcow2,if=virtio,format=qcow2",
    ]);
  });
});

describe("qemuArgs unhappy path", () => {
  const base = {
    varsPath: "/tmp/s/OVMF_VARS.fd",
    sockPath: "/tmp/s/qmp.sock",
    diskPath: "/tmp/s/disk.qcow2",
    iso: "/isos/omarchy.iso",
    code: "/fw/OVMF_CODE.4m.fd",
    memory: "4G",
    smp: 2,
  };

  it("throws when the qmp socket path is empty", () => {
    assert.throws(() => qemuArgs({ ...base, sockPath: "" }), /socket path is required/);
  });

  it("throws when the firmware vars path is empty", () => {
    assert.throws(() => qemuArgs({ ...base, varsPath: "" }), /vars path is required/);
  });
});

describe("DEFAULT_ISO", () => {
  it("points at omarchy.iso in the project root", () => {
    assert.equal(DEFAULT_ISO, join(import.meta.dirname, "..", "..", "omarchy.iso"));
  });
});

describe("createDisk happy path", () => {
  it("creates the disk at diskPath inside a private session dir and returns the path", async () => {
    const cli = new QemuCLI({ tmp: fixtures });
    try {
      const path = await cli.createDisk();
      assert.equal(path, cli.diskPath);
      assert.equal(basename(path), "disk.qcow2");
      assert.ok(basename(dirname(path)).startsWith("oligarchy-"));
      const dir = await stat(dirname(path));
      assert.equal(dir.mode & 0o777, 0o700);
      const disk = await stat(path);
      assert.ok(disk.isFile());
    } finally {
      await cli.stop();
    }
  });

  it("does not clobber an existing disk", async () => {
    const cli = new QemuCLI({ tmp: fixtures });
    try {
      await cli.createDisk();
      await writeFile(cli.diskPath, "precious-user-data");
      await cli.createDisk();
      assert.equal(await readFile(cli.diskPath, "utf8"), "precious-user-data");
    } finally {
      await cli.stop();
    }
  });
});

describe("createDisk unhappy path", () => {
  it("rejects when qemu-img exits nonzero", async () => {
    const cli = new QemuCLI({ tmp: fixtures, diskSize: "not-a-size" });
    try {
      await assert.rejects(async () => cli.createDisk(), /qemu-img create exited 1/);
    } finally {
      await cli.stop();
    }
  });

  it("rejects when qemu-img is not on PATH", async () => {
    const cli = new QemuCLI({ tmp: fixtures });
    process.env.PATH = emptyBin;
    try {
      await assert.rejects(async () => cli.createDisk(), /ENOENT/);
    } finally {
      process.env.PATH = `${fakeBin}:${origPath}`;
      await cli.stop();
    }
  });
});

describe("start unhappy path", () => {
  it("rejects when there is no disk (no createDisk call and no options.disk)", async () => {
    const cli = new QemuCLI({ tmp: fixtures, vars: varsFile });
    try {
      await assert.rejects(async () => cli.start({ iso: isoFile }), /no disk/);
    } finally {
      await cli.stop();
    }
  });

  it("rejects when options.disk does not exist on the filesystem", async () => {
    const cli = new QemuCLI({ tmp: fixtures, vars: varsFile });
    try {
      await assert.rejects(
        async () => cli.start({ disk: join(fixtures, "missing.qcow2"), iso: isoFile }),
        /disk not found/,
      );
    } finally {
      await cli.stop();
    }
  });

  it("rejects when the iso does not exist", async () => {
    const cli = new QemuCLI({ tmp: fixtures, vars: varsFile });
    try {
      await cli.createDisk();
      await assert.rejects(
        async () => cli.start({ iso: join(fixtures, "missing.iso") }),
        /iso not found/,
      );
    } finally {
      await cli.stop();
    }
  });

  it("rejects when already started", async () => {
    const cli = new QemuCLI({ tmp: fixtures, vars: varsFile });
    try {
      await cli.createDisk();
      await cli.start({ iso: isoFile });
      await assert.rejects(async () => cli.start({ iso: isoFile }), /already started/);
    } finally {
      await cli.stop();
    }
  });
});

describe("start happy path", () => {
  it("listens on the QMP unix socket, launches qemu, and completes the handshake", async () => {
    const cli = new QemuCLI({ tmp: fixtures, vars: varsFile });
    try {
      await cli.createDisk();
      const result = await cli.start({ iso: isoFile });
      assert.deepEqual(result, { id: cli.id });
      // Commands round-trip over the same unix socket after the handshake.
      await cli.sendKey([{ type: "qcode", data: "ret" }]);
    } finally {
      await cli.stop();
    }
  });

  it("accepts an explicit pre-existing disk via options.disk", async () => {
    const disk = join(fixtures, "external.qcow2");
    await writeFile(disk, "fake-qcow2");
    const cli = new QemuCLI({ tmp: fixtures, vars: varsFile });
    try {
      const result = await cli.start({ disk, iso: isoFile });
      assert.deepEqual(result, { id: cli.id });
    } finally {
      await cli.stop();
    }
  });
});

describe("stop", () => {
  it("removes the session directory", async () => {
    const cli = new QemuCLI({ tmp: fixtures });
    await cli.createDisk();
    const dir = dirname(cli.diskPath);
    await cli.stop();
    await assert.rejects(async () => stat(dir), /ENOENT/);
  });

  it("is safe to call when never started", async () => {
    const cli = new QemuCLI({ tmp: fixtures });
    await cli.stop();
  });
});
