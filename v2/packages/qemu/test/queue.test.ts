import * as jarl from "jarl";
import { beforeEach, afterEach, vi, expect, it } from "vitest";
import * as Queue from "../src/queue.ts";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const signal = new AbortController().signal;
it("keeps queued data until EOF", async () => {
  const q = Queue.create<number>(2);
  q.push(1);
  q.finish();
  expect(jarl.unwrap(await q.read(signal))).toBe(1);
  expect(jarl.unwrap(await q.read(signal))).toBeUndefined();
});
it("refuses a slow reader at the limit", async () => {
  const q = Queue.create<number>(1);
  q.push(1);
  expect(q.push(2)).toBe(false);
  expect(jarl.is_err(await q.read(signal))).toBe(true);
});
it("settles an aborted reader without consuming the next value", async () => {
  const q = Queue.create<number>(1);
  const c = new AbortController();
  const r = q.read(c.signal);
  c.abort(new Error("test abort"));
  expect(jarl.is_err(await r)).toBe(true);
  q.push(2);
  expect(jarl.unwrap(await q.read(signal))).toBe(2);
});
