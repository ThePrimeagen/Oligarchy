import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { once } from "node:events";
import { describe, it } from "node:test";

const CTRL = resolve(import.meta.dirname, "../ctrl");
const SERVER = "https://qemu.example.com";

async function runCtrl(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(CTRL, args, {
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim(),
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

describe("./ctrl happy path", () => {
  it("test new accepts --server-url as --flag=value, --flag value, and SERVER_URL", async () => {
    const equals = await runCtrl(
      ["test", "new", "--iso", "https://example.com/omarchy.iso", `--server-url=${SERVER}`, "--version", "1.2.3"],
      { LINEAR_API_TOKEN: "" },
    );
    assert.notEqual(equals.code, 0);
    assert.match(equals.stderr, /LINEAR_API_TOKEN is not set/);

    const spaced = await runCtrl(
      ["test", "new", "--server-url", "http://127.0.0.1:42069", "--iso", "https://example.com/omarchy.iso", "--version", "1.2.3"],
      { LINEAR_API_TOKEN: "" },
    );
    assert.notEqual(spaced.code, 0);
    assert.match(spaced.stderr, /LINEAR_API_TOKEN is not set/);

    const named = await runCtrl(
      [
        "test",
        "new",
        "--iso",
        "https://example.com/omarchy.iso",
        `--server-url=${SERVER}`,
        "--version",
        "1.2.3",
        "--name",
        "Install Omarchy",
      ],
      { LINEAR_API_TOKEN: "" },
    );
    assert.notEqual(named.code, 0);
    assert.match(named.stderr, /LINEAR_API_TOKEN is not set/);

    const fromEnv = await runCtrl(["test", "new", "--iso", "https://example.com/omarchy.iso", "--version", "1.2.3"], {
      LINEAR_API_TOKEN: "",
      SERVER_URL: "https://from.env.example",
    });
    assert.notEqual(fromEnv.code, 0);
    assert.match(fromEnv.stderr, /LINEAR_API_TOKEN is not set/);
  });

  it("lists stored test definition names", async () => {
    const result = await runCtrl(["test", "--list", "--server-url", SERVER]);
    assert.equal(result.stderr, "");
    assert.equal(result.code, 0);
    const names = result.stdout.split("\n").filter((line) => line !== "");
    assert.ok(names.includes("lock-screen"));
    assert.equal(result.stdout.includes("{"), false);
  });

  it("lists one stored test definition name with the server from SERVER_URL", async () => {
    const result = await runCtrl(["test", "--list", "--name", "lock-screen"], { SERVER_URL: SERVER });
    assert.equal(result.stderr, "");
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "lock-screen\n");
  });

  it("prints every field of one named test definition", async () => {
    const result = await runCtrl(["test", "--list", "--details", "--name", "lock-screen", "--server-url", SERVER]);
    assert.equal(result.stderr, "");
    assert.equal(result.code, 0);
    const rows = JSON.parse(result.stdout) as { name: string; description: string; instruction: string; proof: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "lock-screen");
    assert.ok(rows[0].description.length > 0);
    assert.ok(rows[0].instruction.length > 0);
    assert.ok(rows[0].proof.length > 0);
  });

  it("test run kicks off a cloud agent through the Cursor API and prints its link", async () => {
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
      const result = await runCtrl(["test", "run", "--ticket", "OLI-42", "--server-url", SERVER], {
        CURSOR_API_TOKEN: "test-token",
        CURSOR_BACKEND_URL: `http://127.0.0.1:${address.port}`,
      });
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
      assert.equal(result.stdout, `Agent here, go check it out for more information: https://cursor.com/agents/${body.agentId}\n`);
      assert.ok(body.prompt.text.includes("Review Linear ticket OLI-42"));
      assert.ok(body.prompt.text.includes(SERVER));
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

  it("test run accepts --server-url before or after --ticket", async () => {
    const equals = await runCtrl(["test", "run", "--ticket", "OLI-42", `--server-url=${SERVER}`], { CURSOR_API_TOKEN: "" });
    assert.notEqual(equals.code, 0);
    assert.match(equals.stderr, /CURSOR_API_TOKEN is not set/);

    const spaced = await runCtrl(["test", "run", "--server-url", "http://127.0.0.1:42069", "--ticket", "OLI-42"], {
      CURSOR_API_TOKEN: "",
    });
    assert.notEqual(spaced.code, 0);
    assert.match(spaced.stderr, /CURSOR_API_TOKEN is not set/);
  });

  it("prints the actions for --help", async () => {
    const result = await runCtrl(["--help"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /test start/);
    assert.match(result.stdout, /test-results/);
    assert.match(result.stdout, /session list \[--count <n>\]/);
    assert.match(result.stdout, /session --session-id/);
  });

  it("session list prints the last ten sessions as colored status, age, and id lines, newest first", async () => {
    const result = await runCtrl(["session", "list", "--server-url", SERVER]);
    assert.equal(result.stderr, "");
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes("{"), false);
    const lines = result.stdout.split("\n").filter((line) => line !== "");
    assert.ok(lines.length <= 10);
    const ages: number[] = [];
    for (const line of lines) {
      const [status, rest, ...extra] = line.split("\x1b[0m");
      assert.deepEqual(extra, [], `unexpected session list line: ${JSON.stringify(line)}`);
      assert.ok(status.startsWith("\x1b["), `status is not colored: ${JSON.stringify(line)}`);
      assert.match(status.slice(status.indexOf("m") + 1), /^(downloading|running|succeeded|failed|aborted|timed_out) *$/);
      const match = rest.match(/^ {2}((?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)? ago) *  ([0-9a-f-]{36})$/);
      assert.ok(match !== null, `unexpected session list line: ${JSON.stringify(line)}`);
      const [, , days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
      ages.push(((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds));
    }
    for (let i = 1; i < ages.length; i++) {
      assert.ok(ages[i - 1] <= ages[i]);
    }
  });

  it("session list --count bounds the listing", async () => {
    const two = await runCtrl(["session", "list", "--count", "2", "--server-url", SERVER]);
    assert.equal(two.stderr, "");
    assert.equal(two.code, 0);
    assert.ok(two.stdout.split("\n").filter((line) => line !== "").length <= 2);

    const one = await runCtrl(["session", "list", "--count=1"], { SERVER_URL: SERVER });
    assert.equal(one.stderr, "");
    assert.equal(one.code, 0);
    assert.ok(one.stdout.split("\n").filter((line) => line !== "").length <= 1);
  });

  it("session list --active --json returns only active sessions with running rows first", async () => {
    const result = await runCtrl(["session", "list", "--active", "--json", "--count", "10", "--server-url", SERVER]);
    assert.equal(result.stderr, "");
    assert.equal(result.code, 0);
    const rows = JSON.parse(result.stdout) as { status: string }[];
    assert.ok(rows.length <= 10);
    let pendingSeen = false;
    for (const row of rows) {
      assert.match(row.status, /^(running|downloading)$/);
      if (row.status === "downloading") {
        pendingSeen = true;
      } else {
        assert.equal(pendingSeen, false);
      }
    }
  });

  it("session --help names both forms", async () => {
    const result = await runCtrl(["session", "--help"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /ctrl session list \[--count <n>\]/);
    assert.match(result.stdout, /ctrl session --session-id <id>/);
  });
});

describe("./ctrl unhappy path", () => {
  it("rejects --active on session inspection", async () => {
    const result = await runCtrl(["session", "--session-id", randomUUID(), "--logs", "--active", "--server-url", SERVER]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Unrecognized flag: --active/);
  });

  it("rejects an ISO that is not HTTPS", async () => {
    const result = await runCtrl([
      "test",
      "new",
      "--iso",
      "http://example.com/omarchy.iso",
      `--server-url=${SERVER}`,
      "--version",
      "1.2.3",
    ]);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout.includes("{"), false);
    assert.match(result.stderr, /iso must be a valid https url/);
  });

  it("rejects an HTTPS ISO without a host", async () => {
    const result = await runCtrl(["test", "new", "--iso", "https://?", `--server-url=${SERVER}`, "--version", "1.2.3"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /iso must be a valid https url/);
  });

  it("rejects a missing ISO and a missing version", async () => {
    const missingIso = await runCtrl(["test", "new", `--server-url=${SERVER}`, "--version", "1.2.3"]);
    assert.notEqual(missingIso.code, 0);
    assert.match(missingIso.stderr, /Missing required flag: --iso/);

    const missingVersion = await runCtrl(["test", "new", "--iso", "https://example.com/omarchy.iso", `--server-url=${SERVER}`]);
    assert.notEqual(missingVersion.code, 0);
    assert.match(missingVersion.stderr, /Missing required flag: --version/);
  });

  it("rejects the old underscore flag", async () => {
    const result = await runCtrl([
      "test",
      "new",
      "--iso",
      "https://example.com/omarchy.iso",
      `--server_url=${SERVER}`,
      "--version",
      "1.2.3",
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Unrecognized flag: --server_url/);
  });

  it("requires a server URL from --server-url or SERVER_URL", async () => {
    const result = await runCtrl(["test", "new", "--iso", "https://example.com/omarchy.iso", "--version", "1.2.3"], {
      LINEAR_API_TOKEN: "linear-token",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Missing required flag: --server-url/);
  });

  it("rejects a server URL outside HTTP and HTTPS from the flag and from SERVER_URL", async () => {
    const flag = await runCtrl([
      "test",
      "new",
      "--iso",
      "https://example.com/omarchy.iso",
      "--server-url=ssh://qemu.example.com",
      "--version",
      "1.2.3",
    ]);
    assert.notEqual(flag.code, 0);
    assert.match(flag.stderr, /server-url must be a valid http or https url/);

    const env = await runCtrl(["test", "new", "--iso", "https://example.com/omarchy.iso", "--version", "1.2.3"], {
      SERVER_URL: "ssh://qemu.example.com",
    });
    assert.notEqual(env.code, 0);
    assert.match(env.stderr, /server-url must be a valid http or https url/);
  });

  it("prefers --server-url over SERVER_URL", async () => {
    const result = await runCtrl(
      ["test", "new", "--iso", "https://example.com/omarchy.iso", "--server-url=ssh://flag.example", "--version", "1.2.3"],
      { SERVER_URL: SERVER },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /server-url must be a valid http or https url/);
  });

  it("rejects a missing DATABASE_URL before doing anything", async () => {
    const result = await runCtrl(["test", "--list", "--server-url", SERVER], { DATABASE_URL: "" });
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /DATABASE_URL is not set/);
  });

  it("rejects test run without a ticket or a server URL", async () => {
    const missingTicket = await runCtrl(["test", "run", "--server-url", SERVER], { CURSOR_API_TOKEN: "test-token" });
    assert.notEqual(missingTicket.code, 0);
    assert.equal(missingTicket.stdout.includes("Agent here"), false);
    assert.match(missingTicket.stderr, /Missing required flag: --ticket/);

    const emptyTicket = await runCtrl(["test", "run", "--ticket", "", "--server-url", SERVER], { CURSOR_API_TOKEN: "test-token" });
    assert.notEqual(emptyTicket.code, 0);
    assert.equal(emptyTicket.stdout.includes("Agent here"), false);
    assert.match(emptyTicket.stderr, /--ticket.*length of at least 1/);

    const missingServer = await runCtrl(["test", "run", "--ticket", "OLI-42"], { CURSOR_API_TOKEN: "test-token" });
    assert.notEqual(missingServer.code, 0);
    assert.equal(missingServer.stdout.includes("Agent here"), false);
    assert.match(missingServer.stderr, /Missing required flag: --server-url/);
  });

  it("rejects a test run server URL outside HTTP and HTTPS", async () => {
    const result = await runCtrl(["test", "run", "--ticket", "OLI-42", "--server-url=ssh://qemu.example.com"], {
      CURSOR_API_TOKEN: "test-token",
    });
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout.includes("Agent here"), false);
    assert.match(result.stderr, /server-url must be a valid http or https url/);
  });

  it("rejects test without --list", async () => {
    const result = await runCtrl(["test", "--server-url", SERVER]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Missing required flag: --list/);
  });

  it("rejects a test definition name that does not exist", async () => {
    const result = await runCtrl(["test", "--list", "--name", "missing-definition", "--server-url", SERVER]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /test: no test definition named missing-definition/);
  });

  it("rejects an unknown action", async () => {
    const result = await runCtrl(["reboot"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /unknown action: reboot/);
  });

  it("rejects test-results without --agent-id and test start with underscore flags", async () => {
    const results = await runCtrl(["test-results", "--id", randomUUID(), "--status", "success", "--server-url", SERVER]);
    assert.notEqual(results.code, 0);
    assert.match(results.stderr, /Missing required flag: --agent-id/);

    const start = await runCtrl(["test", "start", "--session_id", randomUUID(), "--test_result_id", randomUUID(), "--server-url", SERVER]);
    assert.notEqual(start.code, 0);
    assert.match(start.stderr, /Unrecognized flag: --session_id/);
  });

  it("test start rejects an unknown session and test-results rejects an unknown result", async () => {
    const sessionId = randomUUID();
    const start = await runCtrl(["test", "start", "--session-id", sessionId, "--test-result-id", randomUUID(), "--server-url", SERVER]);
    assert.notEqual(start.code, 0);
    assert.match(start.stderr, new RegExp(`test start: no session ${sessionId}`));

    const resultId = randomUUID();
    const results = await runCtrl([
      "test-results",
      "--agent-id",
      "agent-1",
      "--id",
      resultId,
      "--status",
      "failed",
      "--reason",
      "installer hung",
      "--server-url",
      SERVER,
    ]);
    assert.notEqual(results.code, 0);
    assert.match(results.stderr, new RegExp(`test-results: result ${resultId} not found`));
  });

  it("session requires a selector and rejects an unknown session", async () => {
    const sessionId = randomUUID();
    const noSelector = await runCtrl(["session", "--session-id", sessionId, "--server-url", SERVER]);
    assert.notEqual(noSelector.code, 0);
    assert.match(
      noSelector.stderr,
      /^session: --logs, --test-def, --test-results, --actions, or --all is required\nError: session: --logs.*\n\s+at sessionInspectRun .*src\/ctrl\/actions\/session\.ts:\d+:\d+/,
    );

    const unknown = await runCtrl(["session", "--session-id", sessionId, "--logs", "--server-url", SERVER]);
    assert.notEqual(unknown.code, 0);
    assert.match(unknown.stderr, new RegExp(`^session: no session ${sessionId}\nError: session: no session ${sessionId}\n\\s+at `));
  });

  it("session list rejects a count below one, a non-integer count, and the inspect flags", async () => {
    const zero = await runCtrl(["session", "list", "--count", "0", "--server-url", SERVER]);
    assert.notEqual(zero.code, 0);
    assert.doesNotMatch(zero.stdout, / ago {2,}[0-9a-f-]{36}$/m);
    assert.match(zero.stderr, /Invalid value for flag --count: "0".*count must be at least 1/);

    const word = await runCtrl(["session", "list", "--count", "ten", "--server-url", SERVER]);
    assert.notEqual(word.code, 0);
    assert.match(word.stderr, /Invalid value for flag --count: "ten"/);

    const inspectFlag = await runCtrl(["session", "list", "--session-id", randomUUID(), "--server-url", SERVER]);
    assert.notEqual(inspectFlag.code, 0);
    assert.match(inspectFlag.stderr, /Unrecognized flag: --session-id/);

    const countOnInspect = await runCtrl(["session", "--session-id", randomUUID(), "--logs", "--count", "3", "--server-url", SERVER]);
    assert.notEqual(countOnInspect.code, 0);
    assert.match(countOnInspect.stderr, /Unrecognized flag: --count/);
  });

  it("spells out a database that refuses the connection: headline, stack, and the cause", async () => {
    const result = await runCtrl(["test", "--list", "--server-url", SERVER], { DATABASE_URL: "postgres://user:pw@127.0.0.1:1/oligarchy" });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^Failed query: select .* from "test_definitions".*\nparams: : connect ECONNREFUSED 127\.0\.0\.1:1\n/);
    assert.match(result.stderr, /^DrizzleQueryError: Failed query: /m);
    assert.match(result.stderr, /\bcause: Error: connect ECONNREFUSED 127\.0\.0\.1:1\n\s+at /);
    assert.match(result.stderr, /^\s+at async selectTestDefinitions .*src\/ctrl\/actions\/test\.ts:\d+:\d+/m);
    assert.match(result.stderr, /code: 'ECONNREFUSED'/);
  });
});
