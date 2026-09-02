import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { once } from "node:events";
import { describe, it } from "node:test";

const CLIENT = resolve(import.meta.dirname, "../client");

async function runClient(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(CLIENT, args, {
    env: { ...process.env, ...env },
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

describe("./client happy path", () => {
  it("forwards a QEMU command to the TypeScript client", async () => {
    let finishRequest!: (value: { method: string | undefined; url: string | undefined; body: unknown }) => void;
    const request = new Promise<{ method: string | undefined; url: string | undefined; body: unknown }>((done) => {
      finishRequest = done;
    });
    const server = createServer((incoming, response) => {
      let body = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (data: string) => {
        body += data;
      });
      incoming.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"ok":"true"}');
        finishRequest({
          method: incoming.method,
          url: incoming.url,
          body: JSON.parse(body) as unknown,
        });
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");

    try {
      const result = await runClient([
        "--agent-id",
        "agent-1",
        "--server-url",
        `127.0.0.1:${address.port}`,
        "send-keys",
        "session-1",
        "hello",
      ]);
      assert.equal(result.code, 0);
      assert.equal(result.stdout, "");
      assert.deepEqual(await request, {
        method: "POST",
        url: "/send-keys",
        body: {
          id: "session-1",
          keys: "hello",
          encoding: "oligarchy",
          agent: "agent-1",
        },
      });
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("accepts experiment flags after they parse", async () => {
    const equals = await runClient(
      [
        "experiment",
        "new",
        "--iso",
        "https://example.com/omarchy.iso",
        "--server_url=https://qemu.example.com",
        "--version",
        "1.2.3",
      ],
      { LINEAR_API_TOKEN: "" },
    );
    assert.notEqual(equals.code, 0);
    assert.match(equals.stderr, /LINEAR_API_TOKEN is not set/);

    const spaced = await runClient(
      [
        "experiment",
        "new",
        "--server_url",
        "http://127.0.0.1:42069",
        "--iso",
        "https://example.com/omarchy.iso",
        "--version",
        "1.2.3",
      ],
      { LINEAR_API_TOKEN: "" },
    );
    assert.notEqual(spaced.code, 0);
    assert.match(spaced.stderr, /LINEAR_API_TOKEN is not set/);
  });

  it("accepts test-results flags after they parse", async () => {
    const before = await runClient(
      [
        "--agent-id",
        "agent-1",
        "test-results",
        "--id",
        "22222222-2222-4222-8222-222222222222",
        "--status",
        "success",
      ],
      { DATABASE_URL: "" },
    );
    assert.notEqual(before.code, 0);
    assert.match(before.stderr, /DATABASE_URL is not set/);

    const after = await runClient(
      [
        "test-results",
        "--id",
        "22222222-2222-4222-8222-222222222222",
        "--status",
        "failed",
        "--reason",
        "installer hung",
        "--agent-id",
        "agent-1",
      ],
      { DATABASE_URL: "" },
    );
    assert.notEqual(after.code, 0);
    assert.match(after.stderr, /DATABASE_URL is not set/);
  });
});

describe("./client unhappy path", () => {
  it("rejects an ISO that is not HTTPS", async () => {
    const result = await runClient([
      "experiment",
      "new",
      "--iso",
      "http://example.com/omarchy.iso",
      "--server_url=https://qemu.example.com",
      "--version",
      "1.2.3",
    ]);

    assert.notEqual(result.code, 0);
    assert.equal(result.stdout.includes("{"), false);
    assert.match(result.stderr, /iso must be a valid https url/);
  });

  it("rejects an HTTPS ISO without a host", async () => {
    const result = await runClient([
      "experiment",
      "new",
      "--iso",
      "https://?",
      "--server_url=https://qemu.example.com",
      "--version",
      "1.2.3",
    ]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /iso must be a valid https url/);
  });

  it("rejects a missing ISO or server URL", async () => {
    const missingIso = await runClient([
      "experiment",
      "new",
      "--server_url=https://qemu.example.com",
      "--version",
      "1.2.3",
    ]);
    assert.notEqual(missingIso.code, 0);
    assert.match(missingIso.stderr, /iso/);

    const missingServer = await runClient([
      "experiment",
      "new",
      "--iso",
      "https://example.com/omarchy.iso",
      "--version",
      "1.2.3",
    ]);
    assert.notEqual(missingServer.code, 0);
    assert.match(missingServer.stderr, /server_url/);
  });

  it("rejects a missing version", async () => {
    const result = await runClient([
      "experiment",
      "new",
      "--iso",
      "https://example.com/omarchy.iso",
      "--server_url=https://qemu.example.com",
    ]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /version/);
  });

  it("rejects a server URL outside HTTP and HTTPS", async () => {
    const result = await runClient([
      "experiment",
      "new",
      "--iso",
      "https://example.com/omarchy.iso",
      "--server_url=ssh://qemu.example.com",
      "--version",
      "1.2.3",
    ]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /server_url must be a valid http or https url/);
  });

  it("rejects test-results without an agent id", async () => {
    const result = await runClient([
      "test-results",
      "--id",
      "22222222-2222-4222-8222-222222222222",
      "--status",
      "success",
    ]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /--agent-id/);
  });

  it("rejects test-results without an id or status", async () => {
    const missingId = await runClient([
      "--agent-id",
      "agent-1",
      "test-results",
      "--status",
      "success",
    ]);
    assert.notEqual(missingId.code, 0);
    assert.match(missingId.stderr, /id/);

    const missingStatus = await runClient([
      "--agent-id",
      "agent-1",
      "test-results",
      "--id",
      "22222222-2222-4222-8222-222222222222",
    ]);
    assert.notEqual(missingStatus.code, 0);
    assert.match(missingStatus.stderr, /status/);
  });

  it("rejects a test-results status that is not success or failed", async () => {
    const result = await runClient([
      "--agent-id",
      "agent-1",
      "test-results",
      "--id",
      "22222222-2222-4222-8222-222222222222",
      "--status",
      "passed",
    ]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /status/);
  });
});
