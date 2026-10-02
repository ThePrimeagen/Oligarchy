import * as jarl from "jarl";
import * as Async from "@oligarchy/async";
import * as Http from "@oligarchy/http/testing";
import * as Logger from "@oligarchy/logger/testing";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as Iso from "../src/iso.ts";
import { files } from "./files.ts";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const never = new AbortController().signal;
const url = "https://iso.test/test.iso";
const setup = (replies: Http.Options["replies"]) => {
  const f = files();
  const http = Http.http({ replies });
  const iso = Iso.create(
    { http: http.http, logger: Logger.logger().logger },
    {
      os: f.os,
      dataDir: "/cache",
      downloadMs: 100,
      pollMs: 10,
      staleMs: 100,
      heartbeatMs: 10,
      progressMs: 20,
    },
  );
  return { ...f, ...http, iso };
};
it("shares a streamed download and records cache use", async () => {
  const h = setup([new Response("iso"), new Response("not published", { status: 404 })]);
  const [one, two] = await Promise.all([h.iso.get(url, never), h.iso.get(url, never)]);
  expect(jarl.unwrap(one)).toBe(jarl.unwrap(two));
  expect(h.asked).toHaveLength(2);
  expect(h.data.get(jarl.unwrap(one))?.toString()).toBe("iso");
  jarl.unwrap(await h.iso.get(url, never));
  expect(h.asked).toHaveLength(2);
  expect(h.data.get("/cache/isos/manifest.json")?.toString()).toContain('"status":"cached"');
  await h.iso.close();
  expect(vi.getTimerCount()).toBe(0);
});
it("one canceled waiter leaves the other download alive", async () => {
  let deliver!: (response: Response) => void;
  const h = setup((asked) =>
    asked.url.endsWith(".sha256")
      ? new Response("", { status: 404 })
      : new Promise((resolve) => {
          deliver = resolve;
        }),
  );
  const controller = new AbortController();
  const one = h.iso.get(url, controller.signal);
  const two = h.iso.get(url, never);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort(new Async.Aborted("job stopped"));
  expect(jarl.error.is(await one, Async.Aborted)).toBe(true);
  deliver(new Response("iso"));
  expect(jarl.is_ok(await two)).toBe(true);
  await h.iso.close();
});
it.each(["unreachable" as const, new Response("failed", { status: 503 }), new Response("iso")])(
  "failed downloads and checksum mismatch never publish a partial file",
  async (reply) => {
    const h = setup([reply, new Response("0".repeat(64))]);
    expect(jarl.is_err(await h.iso.get(url, never))).toBe(true);
    expect(h.data.has(h.iso.pathOf(url))).toBe(false);
    expect([...h.data.keys()].some((key) => key.includes("partial"))).toBe(false);
    await h.iso.close();
  },
);
it("shutdown cancels a hung download and removes its claim", async () => {
  const h = setup("hang");
  const result = h.iso.get(url, never);
  await vi.advanceTimersByTimeAsync(0);
  await h.iso.close();
  expect(jarl.is_err(await result)).toBe(true);
  expect([...h.directories].some((path) => path.endsWith(".lock"))).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
it("corrupt cache metadata fails explicitly", async () => {
  const h = setup(new Response("iso"));
  h.data.set("/cache/isos/manifest.json", Buffer.from("broken"));
  expect(jarl.is_err(await h.iso.get(url, never))).toBe(true);
  expect(h.asked).toHaveLength(0);
  await h.iso.close();
});
it("unreadable files fail instead of being treated as absent", async () => {
  const h = setup(new Response("iso"));
  h.faults.set(`stat ${h.iso.pathOf(url)}`, new Error("permission denied"));
  expect(jarl.is_err(await h.iso.get(url, never))).toBe(true);
  expect(h.asked).toHaveLength(0);
  await h.iso.close();
});
it("recovers an expired claim only after its owner process is gone", async () => {
  const h = setup([new Response("iso"), new Response("", { status: 404 })]);
  const lock = `${h.iso.pathOf(url)}.lock`;
  h.directories.add(lock);
  h.data.set(`${lock}/owner`, Buffer.from(JSON.stringify({ pid: 123, at: 0 })));
  const waiting = h.iso.get(url, never);
  await vi.advanceTimersByTimeAsync(10);
  expect(jarl.is_ok(await waiting)).toBe(true);
  expect(h.directories.has(lock)).toBe(false);
  await h.iso.close();
});
it("an old claim with a live owner is retained while shutdown ends the waiter", async () => {
  const h = setup(new Response("iso"));
  const lock = `${h.iso.pathOf(url)}.lock`;
  h.directories.add(lock);
  h.data.set(`${lock}/owner`, Buffer.from(JSON.stringify({ pid: 123, at: 0 })));
  h.os.kill = () => true;
  const waiting = h.iso.get(url, never);
  await vi.advanceTimersByTimeAsync(30);
  expect(h.asked).toHaveLength(0);
  await h.iso.close();
  expect(jarl.is_err(await waiting)).toBe(true);
  expect(h.directories.has(lock)).toBe(true);
});
