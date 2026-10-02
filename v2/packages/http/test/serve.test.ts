import { EventEmitter } from "node:events";
import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CreateServer, ListenFailed, listen } from "../src/serve.ts";

const fakeServer = () => {
  const events = new EventEmitter();
  const addresses: Array<{ readonly port: number; readonly hostname: string }> = [];
  const shutdown: Array<string> = [];
  const createServer: CreateServer = () => ({
    once: events.once.bind(events),
    off: events.off.bind(events),
    listen: (port, hostname, listening) => {
      addresses.push({ port, hostname });
      events.once("listening", listening);
    },
    close: (closed) => {
      shutdown.push("close");
      events.once("closed", closed);
    },
    closeAllConnections: () => {
      shutdown.push("closeAllConnections");
    },
  });
  return {
    createServer,
    addresses,
    shutdown,
    ready: () => events.emit("listening"),
    closed: () => events.emit("closed"),
    fail: (cause: unknown) => events.emit("error", cause),
  };
};

describe("listen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for listening, then closes connections and waits for shutdown (happy)", async () => {
    const server = fakeServer();
    let ready = false;
    const starting = listen(() => new Response("ok"), {
      hostname: "127.0.0.1",
      port: 8123,
      createServer: server.createServer,
    }).then((result) => {
      ready = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(server.addresses).toEqual([{ hostname: "127.0.0.1", port: 8123 }]);
    expect(ready).toBe(false);
    server.ready();
    const listening = jarl.unwrap(await starting);

    let closed = false;
    const closing = listening.close().then(() => {
      closed = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(server.shutdown).toEqual(["close", "closeAllConnections"]);
    expect(closed).toBe(false);
    server.closed();
    await closing;
    expect(closed).toBe(true);
  });

  it.each([
    {
      cause: Object.assign(new Error("address already in use"), { code: "EADDRINUSE" }),
      reason: "EADDRINUSE: address already in use",
    },
    {
      cause: Object.assign(new Error("listen EADDRINUSE: address already in use"), {
        code: "EADDRINUSE",
      }),
      reason: "listen EADDRINUSE: address already in use",
    },
    { cause: new Error("listen failed"), reason: "listen failed" },
    { cause: "listen failed", reason: "listen failed" },
  ])(
    "returns ListenFailed with the address and reason: $reason (unhappy)",
    async ({ cause, reason }) => {
      const server = fakeServer();
      const starting = listen(() => new Response("never"), {
        hostname: "127.0.0.1",
        port: 8123,
        createServer: server.createServer,
      });

      server.fail(cause);
      const listened = await starting;

      expect(jarl.error.is(listened, ListenFailed)).toBe(true);
      expect(jarl.is_err(listened) && listened.error.message).toBe(
        `could not listen on 127.0.0.1:8123: ${reason}`,
      );
    },
  );
});
