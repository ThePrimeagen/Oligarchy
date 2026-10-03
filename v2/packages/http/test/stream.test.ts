import * as jarl from "jarl";
import * as Async from "@oligarchy/async";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Http from "../src/main.ts";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it("delivers chunks before EOF and releases its deadline at EOF", async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const http = Http.create(
    {},
    {
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(c) {
              source = c;
            },
          }),
          { status: 201, headers: { "x-image-url": "image" } },
        ),
      timeoutMs: 100,
    },
  );
  const response = jarl.unwrap(await http.open("http://runner/image", {}));
  expect(response.status).toBe(201);
  expect(response.headers.get("x-image-url")).toBe("image");
  source.enqueue(new Uint8Array([1]));
  expect(jarl.unwrap(await response.read())).toEqual(new Uint8Array([1]));
  source.close();
  expect(jarl.unwrap(await response.read())).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});
it("times out a stalled body after headers and cancels it", async () => {
  const cancel = vi.fn();
  const http = Http.create(
    {},
    { fetch: async () => new Response(new ReadableStream({ cancel })), timeoutMs: 100 },
  );
  const response = jarl.unwrap(await http.open("http://runner/follow", {}));
  const reading = response.read();
  await vi.advanceTimersByTimeAsync(100);
  expect(jarl.error.is(await reading, Http.HttpTimedOut)).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("cancels a body on abort with the caller's reason", async () => {
  const controller = new AbortController();
  const http = Http.create(
    {},
    { fetch: async () => new Response(new ReadableStream()), timeoutMs: 100 },
  );
  const response = jarl.unwrap(
    await http.open("http://runner/follow", { signal: controller.signal }),
  );
  const reading = response.read();
  const reason = new Async.Aborted("job stopped");
  controller.abort(reason);
  expect(await reading).toEqual(jarl.err(reason));
  expect(vi.getTimerCount()).toBe(0);
});
it("reports a broken body and clears its deadline", async () => {
  const http = Http.create(
    {},
    {
      fetch: async () =>
        new Response(
          new ReadableStream({
            pull(c) {
              c.error(new Error("broken"));
            },
          }),
        ),
      timeoutMs: 100,
    },
  );
  const response = jarl.unwrap(await http.open("http://runner/image", {}));
  expect(jarl.error.is(await response.read(), Http.HttpUnreachable)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("opens a response that waits past the runtime's own fetch limit", async () => {
  // Bun's fetch ends a request within its own idle limit unless it is told `timeout: false`.
  const http = Http.create(
    {},
    {
      fetch: async (_url, init) => {
        if (init.timeout !== false) {
          throw new DOMException("The operation timed out.", "TimeoutError");
        }
        return new Response("started");
      },
      timeoutMs: 2 ** 31 - 1,
    },
  );
  const response = jarl.unwrap(await http.open("http://runner/start", { method: "POST" }));
  expect(response.status).toBe(200);
  await response.close();
});
it("times out a response whose headers never come within its own timeoutMs", async () => {
  const http = Http.create(
    {},
    {
      fetch: (_url, { signal }) =>
        new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason))),
      timeoutMs: 100,
    },
  );
  const opening = http.open("http://runner/start", { method: "POST" });
  await vi.advanceTimersByTimeAsync(100);
  expect(jarl.error.is(await opening, Http.HttpTimedOut)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("closes an unread body and cancels the transport", async () => {
  const cancel = vi.fn();
  const http = Http.create(
    {},
    { fetch: async () => new Response(new ReadableStream({ cancel })), timeoutMs: 100 },
  );
  const response = jarl.unwrap(await http.open("http://runner/image", {}));
  await response.close();
  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
