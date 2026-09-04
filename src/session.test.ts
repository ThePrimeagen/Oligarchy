import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { once } from "node:events";
import { describe, it } from "node:test";
import { deflateSync } from "node:zlib";

const SESSION = resolve(import.meta.dirname, "../session");
const SESSION_ID = "6f1c0000-0000-4000-8000-00000000e2a9";

async function runSession(args: string[], lines: string[], env: NodeJS.ProcessEnv = {}): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(SESSION, args, {
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim(),
      OLIGARCHY_TOKEN: "test-token",
      SERVER_URL: "",
      TERM: "dumb",
      TERM_PROGRAM: "",
      ...env,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (data: string) => {
    stdout += data;
  });
  child.stderr.on("data", (data: string) => {
    stderr += data;
  });
  child.stdin.end(lines.map((line) => `${line}\n`).join(""));
  const [code] = await once(child, "close");
  return { code: code as number | null, stdout, stderr };
}

type Received = { method: string | undefined; url: string | undefined; authorization: string | undefined; body: unknown };

// A 2x2 8-bit RGB PNG, the shape QEMU's screendump writes: red, green / blue, white.
function tinyPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function stubProxy(): Promise<{ server: Server; url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((incoming, response) => {
    let body = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (data: string) => {
      body += data;
    });
    incoming.on("end", () => {
      received.push({
        method: incoming.method,
        url: incoming.url,
        authorization: incoming.headers.authorization,
        body: body === "" ? undefined : (JSON.parse(body) as unknown),
      });
      if (incoming.url === "/start") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ id: SESSION_ID }));
        return;
      }
      if (incoming.url?.startsWith("/image")) {
        response.writeHead(200, { "Content-Type": "image/png" });
        response.end(tinyPng());
        return;
      }
      if (incoming.url?.startsWith("/serial")) {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("boot log\n");
        return;
      }
      if (incoming.url === "/intent/start" && (body as string).includes("second")) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end('{"error":"Cannot start one intent when one\'s already running. Please end your previous intent."}');
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":"true"}');
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return { server, url: `http://127.0.0.1:${address.port}`, received };
}

function close(server: Server): Promise<void> {
  return new Promise<void>((done) => server.close(() => done()));
}

describe("./session happy path", () => {
  it("drives one session through every command with the client's flags and one agent id", async () => {
    const proxy = await stubProxy();
    try {
      const result = await runSession(
        ["--server-url", proxy.url],
        [
          "start https://example.com/omarchy.iso",
          "intent start wait for the boot menu",
          "status",
          "send-keys hello world<ENTER>",
          "send-mouse 0.5 0.25 left 2",
          "send-mouse 0 1",
          "get-image",
          "get-serial",
          "intent end",
          "stop succeeded all good",
          "exit",
        ],
      );
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);

      const agent = (proxy.received[0].body as { agent: string }).agent;
      assert.match(agent, /^session-[0-9a-f-]{36}$/);
      for (const request of proxy.received) {
        assert.equal(request.authorization, "Bearer test-token");
      }
      assert.deepEqual(
        proxy.received.map((request) => [request.method, request.url, request.body]),
        [
          ["POST", "/start", { iso: "https://example.com/omarchy.iso", agent }],
          ["POST", "/intent/start", { id: SESSION_ID, agent, test_result_id: "manual", message: "wait for the boot menu" }],
          ["POST", "/send-keys", { id: SESSION_ID, keys: "hello world<ENTER>", encoding: "oligarchy", agent }],
          ["POST", "/send-mouse", { id: SESSION_ID, x: 0.5, y: 0.25, agent, button: "left", clicks: 2 }],
          ["POST", "/send-mouse", { id: SESSION_ID, x: 0, y: 1, agent }],
          ["GET", `/image?id=${SESSION_ID}&agent=${agent}`, undefined],
          ["GET", `/serial?id=${SESSION_ID}&agent=${agent}`, undefined],
          ["POST", "/intent/end", { id: SESSION_ID, agent }],
          ["POST", "/stop", { id: SESSION_ID, agent, status: "succeeded", reason: "all good" }],
        ],
      );

      assert.ok(result.stdout.includes(`agent   ${agent}`));
      assert.ok(result.stdout.includes(`session ${SESSION_ID}`));
      assert.ok(result.stdout.includes("intent  open"));
      assert.ok(result.stdout.includes("▀"));
      assert.ok(result.stdout.includes("boot log"));
      assert.ok(result.stdout.includes(`stopped ${SESSION_ID}`));
      assert.equal(result.stdout.includes("stopping session"), false);
    } finally {
      await close(proxy.server);
    }
  });

  it("stops a running session when stdin closes", async () => {
    const proxy = await stubProxy();
    try {
      const result = await runSession(["--server-url", proxy.url], ["start https://example.com/omarchy.iso"]);
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.ok(result.stdout.includes(`stopping session ${SESSION_ID}`));
      const agent = (proxy.received[0].body as { agent: string }).agent;
      assert.deepEqual(proxy.received[1], {
        method: "POST",
        url: "/stop",
        authorization: "Bearer test-token",
        body: { id: SESSION_ID, agent },
      });
    } finally {
      await close(proxy.server);
    }
  });

  it("takes the server from SERVER_URL when --server-url is omitted", async () => {
    const proxy = await stubProxy();
    try {
      const result = await runSession([], ["start https://example.com/omarchy.iso", "stop", "exit"], { SERVER_URL: proxy.url });
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.equal(proxy.received.length, 2);
      assert.ok(result.stdout.includes(`server ${proxy.url}`));
    } finally {
      await close(proxy.server);
    }
  });
});

describe("./session unhappy path", () => {
  it("refuses commands before start, unknown commands, and a malformed send-mouse without calling the proxy", async () => {
    const proxy = await stubProxy();
    try {
      const result = await runSession(
        ["--server-url", proxy.url],
        ["send-keys hello", "reboot", "start https://example.com/omarchy.iso", "send-mouse 0.5", "stop", "exit"],
      );
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.ok(result.stdout.includes("no session. run start first."));
      assert.ok(result.stdout.includes("unknown command: reboot"));
      assert.ok(result.stdout.includes("usage: send-mouse <x> <y> [button] [clicks]"));
      assert.deepEqual(
        proxy.received.map((request) => request.url),
        ["/start", "/stop"],
      );
    } finally {
      await close(proxy.server);
    }
  });

  it("prints the proxy's error, headline first, and keeps the session", async () => {
    const proxy = await stubProxy();
    try {
      const result = await runSession(
        ["--server-url", proxy.url],
        ["start https://example.com/omarchy.iso", "intent start first", "intent start second", "status", "stop", "exit"],
      );
      assert.equal(result.code, 0);
      assert.ok(result.stdout.includes("Cannot start one intent when one's already running. Please end your previous intent."));
      assert.match(result.stdout, /Error: Cannot start one intent[^\n]*\n\s+at /);
      assert.ok(result.stdout.includes(`session ${SESSION_ID}`));
      assert.equal(proxy.received.filter((request) => request.url === "/intent/start").length, 2);
    } finally {
      await close(proxy.server);
    }
  });

  it("rejects a positional server url and an unknown flag", async () => {
    const positional = await runSession(["http://127.0.0.1:1"], []);
    assert.notEqual(positional.code, 0);
    assert.match(positional.stderr, /Unexpected positional argument: "http:\/\/127\.0\.0\.1:1"/);

    const underscore = await runSession(["--server_url", "http://127.0.0.1:1"], []);
    assert.notEqual(underscore.code, 0);
    assert.match(underscore.stderr, /Unrecognized flag: --server_url/);
  });

  it("rejects a missing OLIGARCHY_TOKEN before reading a command", async () => {
    const result = await runSession(["--server-url", "http://127.0.0.1:1"], ["status"], { OLIGARCHY_TOKEN: "" });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /OLIGARCHY_TOKEN is not set/);
    assert.equal(result.stdout.includes("agent"), false);
  });
});
