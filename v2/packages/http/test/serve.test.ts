import { createServer, type Server } from "node:net";
import * as jarl from "jarl";
import { afterEach, describe, expect, it } from "vitest";
import { ListenFailed, listen } from "../src/serve.ts";

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

// A port held open on 127.0.0.1 until the test ends, or closed early by the test.
const held = async (): Promise<{ readonly port: number; readonly server: Server }> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("no port");
  }
  return { port: address.port, server };
};

describe("listen", () => {
  it("serves fetch on the address, and close frees the port (happy)", async () => {
    const { port, server } = await held();
    await new Promise((resolve) => server.close(resolve));

    const listening = jarl.unwrap(
      await listen(
        (request) => new Response(`${request.method} ${new URL(request.url).pathname}`),
        { hostname: "127.0.0.1", port },
      ),
    );
    const answer = await fetch(`http://127.0.0.1:${String(port)}/abort`, { method: "POST" });
    expect(await answer.text()).toBe("POST /abort");
    await listening.close();

    await expect(fetch(`http://127.0.0.1:${String(port)}/abort`)).rejects.toThrow();
    const again = jarl.unwrap(
      await listen(() => new Response("again"), { hostname: "127.0.0.1", port }),
    );
    await again.close();
  });

  it("a port already taken is ListenFailed, naming the address and the reason (unhappy)", async () => {
    const { port } = await held();

    const listened = await listen(() => new Response("never"), { hostname: "127.0.0.1", port });

    expect(jarl.error.is(listened, ListenFailed)).toBe(true);
    expect(jarl.is_err(listened) && listened.error.message).toMatch(
      new RegExp(`^could not listen on 127\\.0\\.0\\.1:${String(port)}: .*EADDRINUSE`),
    );
  });
});
