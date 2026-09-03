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
        `http://127.0.0.1:${address.port}`,
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

    const named = await runClient(
      [
        "experiment",
        "new",
        "--iso",
        "https://example.com/omarchy.iso",
        "--server_url=https://qemu.example.com",
        "--version",
        "1.2.3",
        "--name",
        "Install Omarchy",
      ],
      { LINEAR_API_TOKEN: "" },
    );
    assert.notEqual(named.code, 0);
    assert.match(named.stderr, /LINEAR_API_TOKEN is not set/);
  });

  it("experiment run kicks off a cloud agent through the Cursor API and prints its link", async () => {
    const requests: { method: string | undefined; url: string | undefined; body: string }[] = [];
    const server = createServer((incoming, response) => {
      let body = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (data: string) => {
        body += data;
      });
      incoming.on("end", () => {
        requests.push({ method: incoming.method, url: incoming.url, body });
        if (incoming.method === "GET" && incoming.url === "/v1/models") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ items: [{ id: "grok-4.6", displayName: "Cursor Grok 4.6" }] }));
          return;
        }
        if (incoming.method === "POST" && incoming.url === "/v1/agents") {
          const { agentId } = JSON.parse(body) as { agentId: string };
          const now = new Date().toISOString();
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              agent: {
                id: agentId,
                status: "ACTIVE",
                url: `https://cursor.com/agents/${agentId}`,
                createdAt: now,
                updatedAt: now,
                latestRunId: "run-22222222-2222-4222-8222-222222222222",
              },
              run: {
                id: "run-22222222-2222-4222-8222-222222222222",
                agentId,
                status: "CREATING",
                createdAt: now,
                updatedAt: now,
              },
            }),
          );
          return;
        }
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end('{"error":{"code":"not_found","message":"not found"}}');
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");

    try {
      const result = await runClient(
        ["experiment", "run", "--ticket", "OLI-42", "--server_url", "https://qemu.example.com"],
        { CURSOR_API_TOKEN: "test-token", CURSOR_BACKEND_URL: `http://127.0.0.1:${address.port}` },
      );
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      const created = requests.filter((request) => request.method === "POST" && request.url === "/v1/agents");
      assert.equal(created.length, 1);
      const body = JSON.parse(created[0].body) as {
        agentId: string;
        prompt: { text: string };
        model: unknown;
        repos: unknown;
      };
      assert.equal(
        result.stdout,
        `Agent here, go check it out for more information: https://cursor.com/agents/${body.agentId}\n`,
      );
      assert.ok(body.prompt.text.includes("Review Linear ticket OLI-42"));
      assert.ok(body.prompt.text.includes("https://qemu.example.com"));
      assert.deepEqual(body.model, {
        id: "grok-4.6",
        params: [
          { id: "effort", value: "xhigh" },
          { id: "fast", value: "true" },
        ],
      });
      assert.deepEqual(body.repos, [{ url: "https://github.com/ThePrimeagen/Oligarchy" }]);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("accepts experiment run flags after they parse", async () => {
    const equals = await runClient(
      ["experiment", "run", "--ticket", "OLI-42", "--server_url=https://qemu.example.com"],
      { CURSOR_API_TOKEN: "" },
    );
    assert.notEqual(equals.code, 0);
    assert.match(equals.stderr, /CURSOR_API_TOKEN is not set/);

    const spaced = await runClient(
      ["experiment", "run", "--server_url", "http://127.0.0.1:42069", "--ticket", "OLI-42"],
      { CURSOR_API_TOKEN: "" },
    );
    assert.notEqual(spaced.code, 0);
    assert.match(spaced.stderr, /CURSOR_API_TOKEN is not set/);
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

  it("rejects experiment run without a ticket or a server URL", async () => {
    const missingTicket = await runClient(
      ["experiment", "run", "--server_url", "https://qemu.example.com"],
      { CURSOR_API_TOKEN: "test-token" },
    );
    assert.notEqual(missingTicket.code, 0);
    assert.equal(missingTicket.stdout.includes("Agent here"), false);
    assert.match(missingTicket.stderr, /Missing required flag: --ticket/);

    const emptyTicket = await runClient(
      ["experiment", "run", "--ticket", "", "--server_url", "https://qemu.example.com"],
      { CURSOR_API_TOKEN: "test-token" },
    );
    assert.notEqual(emptyTicket.code, 0);
    assert.equal(emptyTicket.stdout.includes("Agent here"), false);
    assert.match(emptyTicket.stderr, /--ticket.*length of at least 1/);

    const missingServer = await runClient(
      ["experiment", "run", "--ticket", "OLI-42"],
      { CURSOR_API_TOKEN: "test-token" },
    );
    assert.notEqual(missingServer.code, 0);
    assert.equal(missingServer.stdout.includes("Agent here"), false);
    assert.match(missingServer.stderr, /Missing required flag: --server_url/);
  });

  it("rejects an experiment run server URL outside HTTP and HTTPS", async () => {
    const result = await runClient(
      ["experiment", "run", "--ticket", "OLI-42", "--server_url=ssh://qemu.example.com"],
      { CURSOR_API_TOKEN: "test-token" },
    );

    assert.notEqual(result.code, 0);
    assert.equal(result.stdout.includes("Agent here"), false);
    assert.match(result.stderr, /server_url must be a valid http or https url/);
  });
});
