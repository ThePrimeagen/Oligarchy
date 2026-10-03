import { EventEmitter } from "node:events";
import * as jarl from "jarl";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as Process from "../src/process.ts";
import { files } from "./files.ts";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const setup = () => {
  const child = Object.assign(new EventEmitter(), {
    stderr: Object.assign(new EventEmitter(), { setEncoding: () => {} }),
    kill: vi.fn(),
  });
  const f = files();
  const spawn = vi.fn(() => child);
  return { child, os: { ...f.os, spawn } };
};
const options = { killGrace: 10, stderrGrace: 5, stderrLimit: 10 };
it("retains final stderr and the exit signal", async () => {
  const h = setup();
  const pending = Process.start(h.os, "qemu", [], options);
  h.child.emit("spawn");
  const process = jarl.unwrap(await pending);
  h.child.stderr.emit("data", "123456789012");
  h.child.emit("exit", null, "SIGTERM");
  h.child.stderr.emit("data", "end");
  h.child.emit("close");
  expect(await process.exited).toEqual({ code: null, signal: "SIGTERM", stderr: "6789012end" });
});
it("escalates a stopped child and waits until it is reaped", async () => {
  const h = setup();
  const pending = Process.start(h.os, "qemu", [], options);
  h.child.emit("spawn");
  const process = jarl.unwrap(await pending);
  let settled = false;
  const stopping = process.stop().then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(h.child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
  expect(settled).toBe(false);
  h.child.emit("exit", null, "SIGKILL");
  await vi.advanceTimersByTimeAsync(5);
  await stopping;
  expect(settled).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("reports a spawn error", async () => {
  const h = setup();
  const pending = Process.start(h.os, "qemu", [], options);
  h.child.emit("error", new Error("ENOENT"));
  expect(jarl.is_err(await pending)).toBe(true);
});
it("a child that exits during stop leaves no escalation timer", async () => {
  const h = setup();
  const pending = Process.start(h.os, "qemu", [], options);
  h.child.emit("spawn");
  const process = jarl.unwrap(await pending);
  h.child.kill.mockImplementation(() => {
    h.child.emit("exit", null, "SIGTERM");
    h.child.emit("close");
  });
  await process.stop();
  expect(vi.getTimerCount()).toBe(0);
});
