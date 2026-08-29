import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Qemu } from "./client.ts";
import { createProxy, type Proxy } from "./proxy.ts";
import type { Stats } from "./stats.ts";

/** Boots a proxy on an ephemeral port, runs fn, and always tears the server down. */
async function withProxy(fn: (baseUrl: string, proxy: Proxy) => Promise<void>): Promise<void> {
  const proxy = createProxy({ defaultIso: "/nonexistent/test.iso" });
  await new Promise<void>((resolve) => proxy.server.listen(0, "127.0.0.1", resolve));
  const { port } = proxy.server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`, proxy);
  } finally {
    proxy.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      proxy.server.close((err) => (err === undefined ? resolve() : reject(err)));
    });
  }
}

describe("GET /stats happy path", () => {
  it("returns live system stats with zero sessions", async () => {
    await withProxy(async (base) => {
      const res = await fetch(`${base}/stats`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/json");

      const stats = (await res.json()) as Stats;
      assert.deepEqual(stats.sessions, { count: 0, instances: [] });
      assert.equal(stats.host.platform, process.platform);
      assert.ok(stats.host.uptimeSeconds >= 0);
      assert.ok(stats.memory.totalBytes > 0);
      assert.ok(stats.memory.usedBytes >= 0);
      assert.ok(stats.memory.usedPercent >= 0 && stats.memory.usedPercent <= 100);
      assert.ok(stats.cpu.count > 0);
      assert.equal(stats.cpu.loadAverage.length, 3);
      const utilization = stats.cpu.utilizationPercent;
      assert.ok(utilization === null || (utilization >= 0 && utilization <= 100));
      assert.equal(typeof stats.kvm.available, "boolean");
      assert.ok(Number.isFinite(Date.parse(stats.generatedAt)));
      if (process.platform === "linux") {
        assert.notEqual(stats.host.distro, null);
      }
    });
  });

  it("reports live sessions with their pids", async () => {
    await withProxy(async (base, proxy) => {
      proxy.sessions.set("aaaa-1111", { id: "aaaa-1111", proc: { pid: 4242 } } as unknown as Qemu);
      proxy.sessions.set("bbbb-2222", { id: "bbbb-2222" } as unknown as Qemu);

      const res = await fetch(`${base}/stats`);
      assert.equal(res.status, 200);

      const stats = (await res.json()) as Stats;
      assert.deepEqual(stats.sessions, {
        count: 2,
        instances: [
          { id: "aaaa-1111", pid: 4242 },
          { id: "bbbb-2222", pid: null },
        ],
      });
    });
  });
});

describe("proxy routing unhappy path", () => {
  it("404s POST /stats because stats is GET-only", async () => {
    await withProxy(async (base) => {
      const res = await fetch(`${base}/stats`, { method: "POST" });
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { error: "not found" });
    });
  });

  it("404s unknown routes", async () => {
    await withProxy(async (base) => {
      const res = await fetch(`${base}/definitely-not-a-route`);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { error: "not found" });
    });
  });

  it("400s /stop for an unknown session", async () => {
    await withProxy(async (base) => {
      const res = await fetch(`${base}/stop`, {
        method: "POST",
        body: JSON.stringify({ id: "nope" }),
      });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: 'unknown session "nope"' });
    });
  });
});
