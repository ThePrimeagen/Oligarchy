import * as jarl from "jarl";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as Disks from "../src/setup-disks.ts";
import * as Fake from "../src/testing.ts";
import { files } from "./files.ts";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const never = new AbortController().signal;
const setup = () => {
  const f = files();
  f.data.set("/guest/disk", Buffer.from("disk"));
  f.data.set("/guest/vars", Buffer.from("vars"));
  const iso = Fake.iso({ pathOf: () => "/cache/test.iso" });
  const qemu = Fake.qemu({
    convert: async (from, to) => {
      await f.os.fs.copyFile(from, to);
      return jarl.ok(undefined);
    },
  });
  return { ...f, disks: Disks.create({ iso, qemu }, { os: f.os }) };
};
it("publishes a complete pair and keeps the previous version usable by an overlay", async () => {
  const h = setup();
  const pair = { disk: "/guest/disk", vars: "/guest/vars" };
  jarl.unwrap(await h.disks.save("test", pair, never));
  const first = jarl.unwrap(await h.disks.find("test"))!;
  h.data.set(pair.disk, Buffer.from("new"));
  jarl.unwrap(await h.disks.save("test", pair, never));
  const second = jarl.unwrap(await h.disks.find("test"))!;
  expect(second.disk).not.toBe(first.disk);
  expect(h.data.get(first.disk)?.toString()).toBe("disk");
  expect(h.data.get(second.disk)?.toString()).toBe("new");
});
it("a publication failure leaves the old pair selected", async () => {
  const h = setup();
  const pair = { disk: "/guest/disk", vars: "/guest/vars" };
  jarl.unwrap(await h.disks.save("test", pair, never));
  const first = jarl.unwrap(await h.disks.find("test"));
  h.faults.set("rename /cache/test.iso.setups/current.json", new Error("disk full"));
  expect(jarl.is_err(await h.disks.save("test", pair, never))).toBe(true);
  expect(jarl.unwrap(await h.disks.find("test"))).toEqual(first);
});
it("reads the legacy pair but distinguishes unreadable files from missing files", async () => {
  const h = setup();
  expect(jarl.unwrap(await h.disks.find("test"))).toBeUndefined();
  h.data.set("/cache/test.iso.qcow2", Buffer.from("disk"));
  h.data.set("/cache/test.iso.OVMF_VARS.fd", Buffer.from("vars"));
  expect(jarl.unwrap(await h.disks.find("test"))).toEqual({
    disk: "/cache/test.iso.qcow2",
    vars: "/cache/test.iso.OVMF_VARS.fd",
  });
  h.faults.set("stat /cache/test.iso.qcow2", new Error("permission denied"));
  expect(jarl.is_err(await h.disks.find("test"))).toBe(true);
});
it.each(['"../escape"', "not json", '"11111111-1111-4111-8111-111111111111"'])(
  "refuses corrupt or incomplete version pointers: %s",
  async (pointer) => {
    const h = setup();
    h.data.set("/cache/test.iso.setups/current.json", Buffer.from(pointer));
    expect(jarl.is_err(await h.disks.find("test"))).toBe(true);
  },
);
it("refuses an aborted save before creating a version", async () => {
  const h = setup();
  expect(
    jarl.is_err(
      await h.disks.save(
        "test",
        { disk: "/guest/disk", vars: "/guest/vars" },
        AbortSignal.abort(new Error("stop")),
      ),
    ),
  ).toBe(true);
  expect(h.data.has("/cache/test.iso.setups/current.json")).toBe(false);
});
