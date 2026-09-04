import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { describe, it } from "node:test";

const CLIENT = resolve(import.meta.dirname, "../client");

async function runClient(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(CLIENT, args, {
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim(),
      OLIGARCHY_TOKEN: "test-token",
      SERVER_URL: "",
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
  const [code] = await once(child, "close");
  return { code: code as number | null, stdout, stderr };
}

type Received = {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: unknown;
};

async function stubProxy(
  reply: (received: Received) => { status: number; headers?: Record<string, string>; body: string | Buffer },
): Promise<{ server: Server; url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((incoming, response) => {
    let body = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (data: string) => {
      body += data;
    });
    incoming.on("end", () => {
      const request: Received = {
        method: incoming.method,
        url: incoming.url,
        authorization: incoming.headers.authorization,
        body: body === "" ? undefined : (JSON.parse(body) as unknown),
      };
      received.push(request);
      const out = reply(request);
      response.writeHead(out.status, { "Content-Type": "application/json", ...out.headers });
      response.end(out.body);
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

const ok = () => ({ status: 200, body: '{"ok":"true"}' });

describe("./client happy path", () => {
  it("send-keys posts the key string with the agent and the default encoding", async () => {
    const proxy = await stubProxy(ok);
    try {
      const result = await runClient([
        "send-keys",
        "--agent-id",
        "agent-1",
        "--server-url",
        proxy.url,
        "--session-id",
        "session-1",
        "--keys",
        "hello",
      ]);
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.equal(result.stdout, "");
      assert.deepEqual(proxy.received, [
        {
          method: "POST",
          url: "/send-keys",
          authorization: "Bearer test-token",
          body: { id: "session-1", keys: "hello", encoding: "oligarchy", agent: "agent-1" },
        },
      ]);
    } finally {
      await close(proxy.server);
    }
  });

  it("takes the server from SERVER_URL when --server-url is omitted", async () => {
    const proxy = await stubProxy(ok);
    try {
      const result = await runClient(["send-keys", "--agent-id", "agent-1", "--session-id", "session-1", "--keys", "hello"], {
        SERVER_URL: proxy.url,
      });
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.equal(proxy.received.length, 1);
    } finally {
      await close(proxy.server);
    }
  });

  it("start posts the ISO url and agent, omits a missing disk, and prints the id", async () => {
    const proxy = await stubProxy(() => ({ status: 200, body: '{"id":"11111111-1111-4111-8111-111111111111"}' }));
    try {
      const result = await runClient([
        "start",
        "--agent-id",
        "agent-1",
        "--server-url",
        proxy.url,
        "--iso",
        "https://example.com/omarchy.iso",
      ]);
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.equal(result.stdout, "11111111-1111-4111-8111-111111111111\n");
      assert.deepEqual(proxy.received, [
        {
          method: "POST",
          url: "/start",
          authorization: "Bearer test-token",
          body: { iso: "https://example.com/omarchy.iso", agent: "agent-1" },
        },
      ]);
    } finally {
      await close(proxy.server);
    }
  });

  it("get-image writes the PNG bytes to --output", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const proxy = await stubProxy(() => ({ status: 200, headers: { "Content-Type": "image/png" }, body: png }));
    const output = join(tmpdir(), `oligarchy-client-test-${process.pid}.png`);
    try {
      const result = await runClient([
        "get-image",
        "--agent-id",
        "agent-1",
        "--server-url",
        proxy.url,
        "--session-id",
        "session-1",
        "-o",
        output,
      ]);
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.equal(result.stdout, "");
      assert.deepEqual(await readFile(output), png);
      assert.equal(proxy.received[0].method, "GET");
      assert.equal(proxy.received[0].url, "/image?id=session-1&agent=agent-1");
      assert.equal(proxy.received[0].authorization, "Bearer test-token");
    } finally {
      await close(proxy.server);
      await rm(output, { force: true });
    }
  });

  it("get-serial writes the bytes to stdout without --output", async () => {
    const proxy = await stubProxy(() => ({ status: 200, headers: { "Content-Type": "text/plain" }, body: "boot log\n" }));
    try {
      const result = await runClient(["get-serial", "--agent-id", "agent-1", "--server-url", proxy.url, "--session-id", "session-1"]);
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.equal(result.stdout, "boot log\n");
      assert.equal(proxy.received[0].url, "/serial?id=session-1&agent=agent-1");
    } finally {
      await close(proxy.server);
    }
  });

  it("send-mouse posts the point, button, and clicks, and omits button and clicks when not given", async () => {
    const proxy = await stubProxy(ok);
    try {
      const result = await runClient([
        "send-mouse",
        "--agent-id",
        "agent-1",
        "--server-url",
        proxy.url,
        "--session-id",
        "session-1",
        "--x",
        "0.5",
        "--y",
        "0.25",
        "--button",
        "left",
        "--clicks",
        "2",
      ]);
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.deepEqual(proxy.received[0].body, { id: "session-1", x: 0.5, y: 0.25, agent: "agent-1", button: "left", clicks: 2 });
      const move = await runClient(["send-mouse", "--agent-id", "agent-1", "--server-url", proxy.url, "--session-id", "session-1", "--x", "0", "--y", "1"]);
      assert.equal(move.stderr, "");
      assert.equal(move.code, 0);
      assert.deepEqual(proxy.received[1].body, { id: "session-1", x: 0, y: 1, agent: "agent-1" });
    } finally {
      await close(proxy.server);
    }
  });

  it("intent start and intent end take kebab-case flags", async () => {
    const proxy = await stubProxy(ok);
    try {
      const started = await runClient([
        "intent",
        "start",
        "--agent-id",
        "agent-1",
        "--server-url",
        proxy.url,
        "--session-id",
        "session-1",
        "--test-result-id",
        "result-1",
        "--message",
        "wait for the boot menu",
      ]);
      assert.equal(started.stderr, "");
      assert.equal(started.code, 0);
      const ended = await runClient([
        "intent",
        "end",
        "--agent-id",
        "agent-1",
        "--server-url",
        proxy.url,
        "--session-id",
        "session-1",
      ]);
      assert.equal(ended.stderr, "");
      assert.equal(ended.code, 0);
      assert.deepEqual(
        proxy.received.map((request) => [request.url, request.body]),
        [
          ["/intent/start", { id: "session-1", agent: "agent-1", test_result_id: "result-1", message: "wait for the boot menu" }],
          ["/intent/end", { id: "session-1", agent: "agent-1" }],
        ],
      );
    } finally {
      await close(proxy.server);
    }
  });

  it("stop posts the verdict and reason, and a bare stop posts neither", async () => {
    const proxy = await stubProxy(ok);
    try {
      const result = await runClient([
        "stop",
        "--agent-id",
        "agent-1",
        "--server-url",
        proxy.url,
        "--session-id",
        "session-1",
        "--status",
        "failed",
        "--reason",
        "installer hung",
      ]);
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.deepEqual(proxy.received[0].body, { id: "session-1", agent: "agent-1", status: "failed", reason: "installer hung" });
      const abort = await runClient(["stop", "--agent-id", "agent-1", "--server-url", proxy.url, "--session-id", "session-1"]);
      assert.equal(abort.stderr, "");
      assert.equal(abort.code, 0);
      assert.deepEqual(proxy.received[1].body, { id: "session-1", agent: "agent-1" });
    } finally {
      await close(proxy.server);
    }
  });

  it("prints the actions for --help", async () => {
    const result = await runClient(["--help"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /start/);
    assert.match(result.stdout, /intent start/);
    assert.match(result.stdout, /stop --session-id/);
    assert.doesNotMatch(result.stdout, /(get-image|get-serial|send-keys|send-mouse|stop) <id>/);
  });
});

describe("./client unhappy path", () => {
  it("rejects a QEMU action without --agent-id", async () => {
    const result = await runClient(["send-keys", "--session-id", "session-1", "--keys", "hello"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Missing required flag: --agent-id/);
  });

  it("rejects an underscore flag", async () => {
    const result = await runClient(["intent", "end", "--agent-id", "agent-1", "--session_id", "session-1"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Unrecognized flag: --session_id/);
  });

  it("rejects a missing OLIGARCHY_TOKEN before calling the proxy", async () => {
    const proxy = await stubProxy(ok);
    try {
      const result = await runClient(["send-keys", "--agent-id", "agent-1", "--server-url", proxy.url, "--session-id", "session-1", "--keys", "hello"], {
        OLIGARCHY_TOKEN: "",
      });
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /OLIGARCHY_TOKEN is not set/);
      assert.deepEqual(proxy.received, []);
    } finally {
      await close(proxy.server);
    }
  });

  it("rejects an unknown action and an intent without start or end", async () => {
    const unknown = await runClient(["reboot", "--agent-id", "agent-1"]);
    assert.notEqual(unknown.code, 0);
    assert.match(unknown.stderr, /unknown action: reboot/);

    const intent = await runClient(["intent", "--agent-id", "agent-1"]);
    assert.notEqual(intent.code, 0);
    assert.match(intent.stderr, /intent: expected start or end/);
  });

  it("prints the server's error and exits 1", async () => {
    const proxy = await stubProxy(() => ({ status: 404, body: '{"error":"no session session-1"}' }));
    try {
      const result = await runClient(["send-keys", "--agent-id", "agent-1", "--server-url", proxy.url, "--session-id", "session-1", "--keys", "hello"]);
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "no session session-1\n");
    } finally {
      await close(proxy.server);
    }
  });

  it("rejects a send-mouse coordinate outside 0..1 before calling the proxy", async () => {
    const proxy = await stubProxy(ok);
    try {
      const result = await runClient(["send-mouse", "--agent-id", "agent-1", "--server-url", proxy.url, "--session-id", "session-1", "--x", "1.5", "--y", "0.5"]);
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /Invalid value for flag --x: .*--x and --y must be in 0\.\.1/);
      assert.deepEqual(proxy.received, []);
    } finally {
      await close(proxy.server);
    }
  });

  it("rejects a start whose local ISO does not exist before calling the proxy", async () => {
    const proxy = await stubProxy(ok);
    try {
      const result = await runClient(["start", "--agent-id", "agent-1", "--server-url", proxy.url, "--iso", "missing.iso"]);
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /iso: .*missing\.iso/);
      assert.deepEqual(proxy.received, []);
    } finally {
      await close(proxy.server);
    }
  });

  it("rejects a positional session id and a missing --keys", async () => {
    const positional = await runClient(["send-keys", "--agent-id", "agent-1", "--session-id", "session-1", "extra", "--keys", "hello"]);
    assert.notEqual(positional.code, 0);
    assert.match(positional.stderr, /Unexpected positional argument: "extra"/);

    const noFlag = await runClient(["send-keys", "--agent-id", "agent-1", "session-1", "--keys", "hello"]);
    assert.notEqual(noFlag.code, 0);
    assert.match(noFlag.stderr, /Missing required flag: --session-id/);

    const missingKeys = await runClient(["send-keys", "--agent-id", "agent-1", "--session-id", "session-1"]);
    assert.notEqual(missingKeys.code, 0);
    assert.match(missingKeys.stderr, /Missing required flag: --keys/);

    const stopPositional = await runClient(["stop", "--agent-id", "agent-1", "--session-id", "session-1", "failed"]);
    assert.notEqual(stopPositional.code, 0);
    assert.match(stopPositional.stderr, /Unexpected positional argument: "failed"/);
  });

  it("unwraps a refused connection", async () => {
    const closed = await stubProxy(ok);
    await close(closed.server);
    const result = await runClient(["send-keys", "--agent-id", "agent-1", "--server-url", closed.url, "--session-id", "session-1", "--keys", "hello"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /fetch failed: .*ECONNREFUSED/);
  });
});
