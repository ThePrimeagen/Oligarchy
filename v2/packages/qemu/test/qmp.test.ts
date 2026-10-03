import * as jarl from "jarl";
import * as Async from "@oligarchy/async";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as Qmp from "../src/qmp.ts";
import * as Queue from "../src/queue.ts";
import { QemuFailed } from "../src/errors.ts";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const never = new AbortController().signal;
const harness = () => {
  const input = Queue.create<string>(30);
  const commands: Qmp.Command[] = [];
  const events: Qmp.Event[] = [];
  let respond = true;
  const socket = {
    read: input.read,
    write: async (line: string) => {
      const command: Qmp.Command = JSON.parse(line);
      commands.push(command);
      if (respond) input.push(`${JSON.stringify({ id: command.id, return: {} })}\n`);
      return jarl.ok(undefined);
    },
    close: () => input.finish(),
  };
  input.push('{"QMP":{"version":{}}}\n');
  return {
    input,
    commands,
    events,
    socket,
    pause: () => {
      respond = false;
    },
    create: () =>
      Qmp.create(socket, never, {
        commandMs: 20,
        handshakeMs: 10,
        maxFrame: 200,
        event: (e) => events.push(e),
      }),
  };
};
it("matches replies while delivering shutdown events and fragmented frames", async () => {
  const h = harness();
  const client = jarl.unwrap(await h.create());
  h.input.push('{"event":"SHUT');
  h.input.push('DOWN","data":{"reason":"guest-shutdown"}}\n');
  expect(jarl.is_ok(await client.execute({ execute: "query-status", arguments: {} }, never))).toBe(
    true,
  );
  expect(h.events).toEqual([{ event: "SHUTDOWN", data: { reason: "guest-shutdown" } }]);
  expect(h.commands.map((c) => c.id)).toEqual([1, 2]);
  client.stop();
  await client.reading;
});
it("a refused action insert prevents sending the command", async () => {
  const h = harness();
  const client = jarl.unwrap(await h.create());
  const result = await client.execute({ execute: "send-key", arguments: {} }, never, async () =>
    jarl.err(new QemuFailed("database refused")),
  );
  expect(jarl.is_err(result)).toBe(true);
  expect(h.commands).toHaveLength(1);
  client.stop();
});
it("records a command timeout as failed and removes the pending reply", async () => {
  const h = harness();
  const client = jarl.unwrap(await h.create());
  h.pause();
  const finish = vi.fn(async () => jarl.ok(undefined));
  const result = client.execute({ execute: "query-status", arguments: {} }, never, async () =>
    jarl.ok(finish),
  );
  await vi.advanceTimersByTimeAsync(20);
  expect(jarl.is_err(await result)).toBe(true);
  expect(finish.mock.calls[0]).toMatchObject([{ state: "failed" }]);
  expect(client.pending.size).toBe(0);
  client.stop();
});
it("aborting a command settles it without closing other commands", async () => {
  const h = harness();
  const client = jarl.unwrap(await h.create());
  h.pause();
  const aborter = new AbortController();
  const result = client.execute({ execute: "query-status", arguments: {} }, aborter.signal);
  aborter.abort(new Async.Aborted("operator stopped"));
  expect(jarl.is_err(await result)).toBe(true);
  expect(client.pending.size).toBe(0);
  client.stop();
});
it.each(["not json\n", '{"invalid":', "x".repeat(201)])(
  "malformed or oversized input fails all outstanding commands: %s",
  async (frame) => {
    const h = harness();
    const client = jarl.unwrap(await h.create());
    h.pause();
    const result = client.execute({ execute: "query-status", arguments: {} }, never);
    h.input.push(frame);
    if (frame === '{"invalid":') h.input.finish();
    expect(jarl.is_err(await result)).toBe(true);
    await client.reading;
  },
);
it("a missing greeting times out and closes the socket", async () => {
  const input = Queue.create<string>(2);
  const close = vi.fn(() => input.finish());
  const result = Qmp.create(
    { read: input.read, write: async () => jarl.ok(undefined), close },
    never,
    { commandMs: 20, handshakeMs: 10, maxFrame: 200, event: () => {} },
  );
  await vi.advanceTimersByTimeAsync(10);
  expect(jarl.is_err(await result)).toBe(true);
  expect(close).toHaveBeenCalled();
});
it("QMP rejection and closed transport fail a waiting command", async () => {
  const h = harness();
  const client = jarl.unwrap(await h.create());
  h.pause();
  const first = client.execute({ execute: "query-status", arguments: {} }, never);
  h.input.push('{"id":2,"error":{"desc":"refused"}}\n');
  expect(jarl.is_err(await first)).toBe(true);
  const second = client.execute({ execute: "query-status", arguments: {} }, never);
  h.input.finish();
  expect(jarl.is_err(await second)).toBe(true);
});
