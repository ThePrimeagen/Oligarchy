import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as Postgres from "../support/postgres.ts";
import * as StubCursor from "../support/stub-cursor.ts";
import * as StubProxy from "../support/stub-proxy.ts";

// The root wrapper, which execs v2/ctrl.
const CTRL = fileURLToPath(new URL("../../../ctrl", import.meta.url));
const EXIT_WITHIN_MS = 60_000;
const SERVER = "https://qemu.example.com";
const TOKEN = "test-token";
// Parsed but never connected: only the actions that query need the container.
const UNUSED_DB = "postgres://user:pw@127.0.0.1:1/oligarchy";

// Seeded by vitest.global-setup.ts.
const SUCCEEDED_ID = "11111111-1111-4111-8111-111111111111";
const RUNNING_ID = "22222222-2222-4222-8222-222222222222";
const DEFINITION = "lock-screen";

type Run = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

// Spawned from a scratch directory so no `.env` reaches the child; every variable is explicit.
const runCtrl = (args: ReadonlyArray<string>, env: Record<string, string> = {}): Promise<Run> =>
  new Promise((resolve, reject) => {
    const child = spawn(CTRL, args, {
      cwd: tmpdir(),
      env: {
        ...process.env,
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim(),
        DATABASE_URL: Postgres.getDbUrl(),
        OLIGARCHY_TOKEN: TOKEN,
        SERVER_URL: "",
        LINEAR_API_TOKEN: "",
        CURSOR_API_TOKEN: "",
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
    const timer = setTimeout(() => child.kill("SIGKILL"), EXIT_WITHIN_MS);
    child.on("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

const firstLine = (text: string): string => text.split("\n")[0] ?? "";

const lines = (text: string): ReadonlyArray<string> =>
  text.split("\n").filter((line) => line !== "");

const openProxies: Array<StubProxy.StubProxy> = [];
const openCursors: Array<StubCursor.StubCursor> = [];

const proxy = async (script?: StubProxy.Script): Promise<StubProxy.StubProxy> => {
  const started = await StubProxy.startStubProxy(script);
  openProxies.push(started);
  return started;
};

const cursor = async (): Promise<StubCursor.StubCursor> => {
  const started = await StubCursor.startStubCursor();
  openCursors.push(started);
  return started;
};

afterEach(async () => {
  await Promise.all([
    ...openProxies.splice(0).map((stub) => stub.close()),
    ...openCursors.splice(0).map((stub) => stub.close()),
  ]);
});

// ---------------------------------------------------------------------------
// Without a database: parsing, environment order, the Cursor kickoff
// ---------------------------------------------------------------------------

describe("./ctrl without a database", () => {
  it("bare ./ctrl prints help and exits 0; an unknown action exits 1 (changed: R3)", async () => {
    const bare = await runCtrl([], { DATABASE_URL: "" });
    expect(bare.code).toBe(0);
    expect(bare.stdout).toMatch(/test-results/);
    expect(bare.stdout).toMatch(/session/);

    const unknown = await runCtrl(["reboot"], { DATABASE_URL: "" });
    expect(unknown.code).toBe(1);
    expect(unknown.stdout.includes("{")).toBe(false);
  });

  it("--help on the root, test, session and a subcommand exits 0 without a database", async () => {
    for (const args of [
      ["--help"],
      ["test", "--help"],
      ["session", "--help"],
      ["test", "run", "--help"],
    ]) {
      const result = await runCtrl(args, { DATABASE_URL: "" });
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.length).toBeGreaterThan(0);
    }
  });

  it("test new accepts --server-url as --flag=value, --flag value, and SERVER_URL, then wants LINEAR_API_TOKEN", async () => {
    const iso = ["--iso", "https://example.com/omarchy.iso", "--version", "1.2.3"];
    const equals = await runCtrl(["test", "new", ...iso, `--server-url=${SERVER}`], {
      DATABASE_URL: UNUSED_DB,
    });
    expect(equals.code).toBe(1);
    expect(firstLine(equals.stderr)).toBe("LINEAR_API_TOKEN is not set");

    const spaced = await runCtrl(
      ["test", "new", "--server-url", "http://127.0.0.1:42069", ...iso],
      {
        DATABASE_URL: UNUSED_DB,
      },
    );
    expect(spaced.code).toBe(1);
    expect(firstLine(spaced.stderr)).toBe("LINEAR_API_TOKEN is not set");

    const named = await runCtrl(
      ["test", "new", ...iso, `--server-url=${SERVER}`, "--name", DEFINITION],
      {
        DATABASE_URL: UNUSED_DB,
      },
    );
    expect(named.code).toBe(1);
    expect(firstLine(named.stderr)).toBe("LINEAR_API_TOKEN is not set");

    const fromEnv = await runCtrl(["test", "new", ...iso], {
      DATABASE_URL: UNUSED_DB,
      SERVER_URL: "https://from.env.example",
    });
    expect(fromEnv.code).toBe(1);
    expect(firstLine(fromEnv.stderr)).toBe("LINEAR_API_TOKEN is not set");
  });

  it("test run kicks off a cloud agent through the Cursor API and prints its link", async () => {
    const stub = await cursor();
    const result = await runCtrl(["test", "run", "--ticket", "OLI-42"], {
      DATABASE_URL: UNUSED_DB,
      CURSOR_API_TOKEN: TOKEN,
      CURSOR_BACKEND_URL: stub.url,
    });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const created = StubCursor.createdAgents(stub);
    expect(created).toHaveLength(1);
    const body: {
      agentId: string;
      prompt: { text: string };
      model: unknown;
      repos: unknown;
    } = JSON.parse(created[0]?.body ?? "{}");
    expect(result.stdout).toBe(
      `Agent here, go check it out for more information: https://cursor.com/agents/${body.agentId}\n`,
    );
    expect(body.prompt.text).toMatch(/Review Linear ticket\s+OLI-42/);
    // The server url reaches the driver through the Linear ticket, not the kickoff prompt.
    expect(body.prompt.text.includes(SERVER)).toBe(false);
    expect(body.model).toEqual({
      id: "grok-4.6",
      params: [
        { id: "effort", value: "xhigh" },
        { id: "fast", value: "true" },
      ],
    });
    expect(body.repos).toEqual([{ url: "https://github.com/ThePrimeagen/Oligarchy" }]);
    expect(
      stub.requests.some((request) => request.method === "GET" && request.url === "/v1/models"),
    ).toBe(true);
    expect(created[0]?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("test run takes no server URL and wants CURSOR_API_TOKEN after parsing", async () => {
    const ticketOnly = await runCtrl(["test", "run", "--ticket", "OLI-42"], {
      DATABASE_URL: UNUSED_DB,
    });
    expect(ticketOnly.code).toBe(1);
    expect(firstLine(ticketOnly.stderr)).toBe("CURSOR_API_TOKEN is not set");

    const withServer = await runCtrl(
      ["test", "run", "--ticket", "OLI-42", `--server-url=${SERVER}`],
      {
        DATABASE_URL: UNUSED_DB,
        CURSOR_API_TOKEN: TOKEN,
      },
    );
    expect(withServer.code).toBe(1);
    expect(withServer.stdout.includes("Agent here")).toBe(false);
    expect(withServer.stderr).toMatch(/Unrecognized flag: --server-url/);

    const missingTicket = await runCtrl(["test", "run"], {
      DATABASE_URL: UNUSED_DB,
      CURSOR_API_TOKEN: TOKEN,
    });
    expect(missingTicket.code).toBe(1);
    expect(missingTicket.stderr).toMatch(/Missing required flag: --ticket/);

    const emptyTicket = await runCtrl(["test", "run", "--ticket", ""], {
      DATABASE_URL: UNUSED_DB,
      CURSOR_API_TOKEN: TOKEN,
    });
    expect(emptyTicket.code).toBe(1);
    expect(emptyTicket.stderr).toMatch(/--ticket[\s\S]*length of at least 1/);
  });

  it("test run surfaces a Cursor refusal as the headline and exits 1", async () => {
    const stub = await cursor();
    const result = await runCtrl(["test", "run", "--ticket", "OLI-42"], {
      DATABASE_URL: UNUSED_DB,
      CURSOR_API_TOKEN: TOKEN,
      CURSOR_BACKEND_URL: `${stub.url}/nowhere`,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(StubCursor.createdAgents(stub)).toEqual([]);
  });

  it("rejects a missing DATABASE_URL before doing anything, on every database action", async () => {
    for (const args of [
      ["test", "--list", "--server-url", SERVER],
      ["test", "list", "--server-url", SERVER],
      ["test", "run", "--ticket", "OLI-42"],
      ["session", "list", "--server-url", SERVER],
      ["session", "--session-id", SUCCEEDED_ID, "--logs", "--server-url", SERVER],
    ]) {
      const result = await runCtrl(args, {
        DATABASE_URL: "",
        LINEAR_API_TOKEN: "l",
        CURSOR_API_TOKEN: "c",
      });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(firstLine(result.stderr)).toBe("DATABASE_URL is not set");
    }
  });

  it("spells out a database that refuses the connection: the headline, then the cause (changed: R1)", async () => {
    const result = await runCtrl(["test", "--list", "--server-url", SERVER], {
      DATABASE_URL: UNUSED_DB,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(firstLine(result.stderr)).toMatch(/^Failed query: select .* from "test_definitions"/);
    expect(result.stderr).toMatch(/ECONNREFUSED 127\.0\.0\.1:1/);
    expect(result.stderr).toMatch(/DatabaseError/);
    expect(result.stderr).not.toMatch(/DrizzleQueryError/);
  });

  it("rejects the usage errors of every action (unhappy)", async () => {
    const env = { DATABASE_URL: UNUSED_DB, LINEAR_API_TOKEN: "l" };
    const cases: ReadonlyArray<readonly [ReadonlyArray<string>, RegExp, Record<string, string>]> = [
      [["test", "--server-url", SERVER], /Missing required flag: --list/, env],
      [
        [
          "test",
          "new",
          "--iso",
          "http://example.com/omarchy.iso",
          `--server-url=${SERVER}`,
          "--version",
          "1.2.3",
        ],
        /iso must be a valid https url/,
        env,
      ],
      [
        ["test", "new", "--iso", "https://?", `--server-url=${SERVER}`, "--version", "1.2.3"],
        /iso must be a valid https url/,
        env,
      ],
      [
        ["test", "new", `--server-url=${SERVER}`, "--version", "1.2.3"],
        /Missing required flag: --iso/,
        env,
      ],
      [
        ["test", "new", "--iso", "https://example.com/omarchy.iso", `--server-url=${SERVER}`],
        /Missing required flag: --version/,
        env,
      ],
      [
        [
          "test",
          "new",
          "--iso",
          "https://example.com/omarchy.iso",
          `--server_url=${SERVER}`,
          "--version",
          "1.2.3",
        ],
        /Unrecognized flag: --server_url/,
        env,
      ],
      [
        ["test", "new", "--iso", "https://example.com/omarchy.iso", "--version", "1.2.3"],
        /Missing required flag: --server-url/,
        env,
      ],
      [
        [
          "test",
          "new",
          "--iso",
          "https://example.com/omarchy.iso",
          "--server-url=ftp://qemu.example.com",
          "--version",
          "1.2.3",
        ],
        /server-url must be a valid http or https url/,
        env,
      ],
      [
        ["test", "new", "--iso", "https://example.com/omarchy.iso", "--version", "1.2.3"],
        /server-url must be a valid http or https url/,
        { ...env, SERVER_URL: "ftp://qemu.example.com" },
      ],
      [
        [
          "test",
          "new",
          "--iso",
          "https://example.com/omarchy.iso",
          "--server-url=ssh://flag.example",
          "--version",
          "1.2.3",
        ],
        /server-url must be a valid http or https url/,
        { ...env, SERVER_URL: SERVER },
      ],
      [
        ["test-results", "--id", randomUUID(), "--status", "success", "--server-url", SERVER],
        /Missing required flag: --agent-id/,
        env,
      ],
      [
        [
          "test",
          "start",
          "--session_id",
          randomUUID(),
          "--test_result_id",
          randomUUID(),
          "--server-url",
          SERVER,
        ],
        /Unrecognized flag: --session_id/,
        env,
      ],
      [
        ["session", "list", "--count", "0", "--server-url", SERVER],
        /Invalid value for flag --count: "0"[\s\S]*count must be at least 1/,
        env,
      ],
      [
        ["session", "list", "--count", "ten", "--server-url", SERVER],
        /Invalid value for flag --count: "ten"/,
        env,
      ],
      [
        ["session", "list", "--session-id", randomUUID(), "--server-url", SERVER],
        /Unrecognized flag: --session-id/,
        env,
      ],
      [
        ["session", "--session-id", randomUUID(), "--logs", "--active", "--server-url", SERVER],
        /Unrecognized flag: --active/,
        env,
      ],
      [
        ["session", "--session-id", randomUUID(), "--logs", "--count", "3", "--server-url", SERVER],
        /Unrecognized flag: --count/,
        env,
      ],
    ];
    for (const [args, expected, environment] of cases) {
      const result = await runCtrl(args, environment);
      expect(result.code, args.join(" ")).toBe(1);
      expect(result.stderr, args.join(" ")).toMatch(expected);
      expect(result.stdout.includes("{"), args.join(" ")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Against the seeded container database
// ---------------------------------------------------------------------------

Postgres.describeWithDatabase("./ctrl against the seeded database", () => {
  it("test --list prints the stored definition names, one per line", async () => {
    const result = await runCtrl(["test", "--list", "--server-url", SERVER]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(lines(result.stdout)).toContain(DEFINITION);
    expect(result.stdout.includes("{")).toBe(false);

    const named = await runCtrl(["test", "--list", "--name", DEFINITION], { SERVER_URL: SERVER });
    expect(named.stderr).toBe("");
    expect(named.code).toBe(0);
    expect(named.stdout).toBe(`${DEFINITION}\n`);
  });

  it("test --list --details --name prints every field of one definition as JSON", async () => {
    const result = await runCtrl([
      "test",
      "--list",
      "--details",
      "--name",
      DEFINITION,
      "--server-url",
      SERVER,
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const rows: Array<{ name: string; description: string; instruction: string; proof: string }> =
      JSON.parse(result.stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: DEFINITION });
    expect(rows[0]?.description.length).toBeGreaterThan(0);
    expect(rows[0]?.instruction.length).toBeGreaterThan(0);
    expect(rows[0]?.proof.length).toBeGreaterThan(0);
  });

  it("test --list rejects a definition name that does not exist", async () => {
    const result = await runCtrl([
      "test",
      "--list",
      "--name",
      "missing-definition",
      "--server-url",
      SERVER,
    ]);
    expect(result.code).toBe(1);
    expect(firstLine(result.stderr)).toBe("test: no test definition named missing-definition");
  });

  it("test start rejects an unknown session and test-results rejects an unknown result", async () => {
    const sessionId = randomUUID();
    const start = await runCtrl([
      "test",
      "start",
      "--session-id",
      sessionId,
      "--test-result-id",
      randomUUID(),
      "--server-url",
      SERVER,
    ]);
    expect(start.code).toBe(1);
    expect(firstLine(start.stderr)).toBe(`test start: no session ${sessionId}`);

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
    expect(results.code).toBe(1);
    expect(firstLine(results.stderr)).toBe(`test-results: result ${resultId} not found`);
  });

  it("session list prints coloured status, age, and id lines, newest first", async () => {
    const result = await runCtrl(["session", "list", "--server-url", SERVER]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout.includes("{")).toBe(false);
    const printed = lines(result.stdout);
    expect(printed.length).toBeGreaterThanOrEqual(2);
    expect(printed.length).toBeLessThanOrEqual(10);
    const ages: Array<number> = [];
    for (const line of printed) {
      const [status, rest, ...extra] = line.split("\x1b[0m");
      expect(extra, line).toEqual([]);
      expect(status?.startsWith("\x1b["), line).toBe(true);
      expect((status ?? "").slice((status ?? "").indexOf("m") + 1)).toMatch(
        /^(downloading|running|succeeded|failed|aborted|timed_out) *$/,
      );
      const match = (rest ?? "").match(
        /^ {2}((?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)? ago) *  ([0-9a-f-]{36})$/,
      );
      expect(match, line).not.toBeNull();
      const [, , days = "0", hours = "0", minutes = "0", seconds = "0"] = match ?? [];
      ages.push(
        ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds),
      );
    }
    for (let index = 1; index < ages.length; index++) {
      expect(ages[index - 1]).toBeLessThanOrEqual(ages[index] ?? 0);
    }
    expect(result.stdout).toContain(SUCCEEDED_ID);
    expect(result.stdout).toContain(RUNNING_ID);
  });

  it("session list --count bounds the listing, from the flag and with --count=1", async () => {
    const two = await runCtrl(["session", "list", "--count", "2", "--server-url", SERVER]);
    expect(two.stderr).toBe("");
    expect(two.code).toBe(0);
    expect(lines(two.stdout).length).toBeLessThanOrEqual(2);

    const one = await runCtrl(["session", "list", "--count=1"], { SERVER_URL: SERVER });
    expect(one.stderr).toBe("");
    expect(one.code).toBe(0);
    expect(lines(one.stdout)).toHaveLength(1);
  });

  it("session list --active --json returns only active sessions with running rows first", async () => {
    const result = await runCtrl([
      "session",
      "list",
      "--active",
      "--json",
      "--count",
      "10",
      "--server-url",
      SERVER,
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const rows: Array<{ id: string; status: string; startedAt: string }> = JSON.parse(
      result.stdout,
    );
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows.map((row) => row.id)).toContain(RUNNING_ID);
    let pendingSeen = false;
    for (const row of rows) {
      expect(row.status).toMatch(/^(running|downloading)$/);
      expect(Number.isNaN(Date.parse(row.startedAt))).toBe(false);
      if (row.status === "downloading") {
        pendingSeen = true;
      } else {
        expect(pendingSeen).toBe(false);
      }
    }
  });

  it("session --logs prints the bare JSON array and never needs OLIGARCHY_TOKEN", async () => {
    const stub = await proxy();
    const result = await runCtrl(
      ["session", "--session-id", SUCCEEDED_ID, "--logs", "--server-url", stub.url],
      {
        OLIGARCHY_TOKEN: "",
      },
    );
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(Array.isArray(JSON.parse(result.stdout))).toBe(true);
    expect(stub.requests).toEqual([]);
  });

  it("session --all prints { logs, results, test_definition, actions } for a seeded session", async () => {
    const result = await runCtrl([
      "session",
      "--session-id",
      RUNNING_ID,
      "--all",
      "--server-url",
      SERVER,
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const printed: Record<string, unknown> = JSON.parse(result.stdout);
    expect(Object.keys(printed)).toEqual(["logs", "results", "test_definition", "actions"]);
    expect(Array.isArray(printed.logs)).toBe(true);
    expect(Array.isArray(printed.actions)).toBe(true);
    expect(printed.results).toBeNull();
    expect(printed.test_definition).toBeNull();
  });

  it("session requires a selector and rejects an unknown session", async () => {
    const sessionId = randomUUID();
    const noSelector = await runCtrl([
      "session",
      "--session-id",
      sessionId,
      "--server-url",
      SERVER,
    ]);
    expect(noSelector.code).toBe(1);
    expect(firstLine(noSelector.stderr)).toBe(
      "session: --logs, --test-def, --test-results, --actions, --all, or --dump is required",
    );
    expect(noSelector.stderr).toMatch(/CommandError/);
    expect(noSelector.stderr).not.toMatch(/at sessionInspectRun/);

    const unknown = await runCtrl([
      "session",
      "--session-id",
      sessionId,
      "--logs",
      "--server-url",
      SERVER,
    ]);
    expect(unknown.code).toBe(1);
    expect(firstLine(unknown.stderr)).toBe(`session: no session ${sessionId}`);
  });

  it("session --dump asks the proxy for the dump with the token and prints the bytes raw", async () => {
    const stub = await proxy();
    const result = await runCtrl([
      "session",
      "--session-id",
      SUCCEEDED_ID,
      "--dump",
      "--server-url",
      stub.url,
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("[    0.000000] Linux version 6.12\nkernel panic - not syncing\n");
    expect(stub.requests).toEqual([
      {
        method: "GET",
        url: `/dump?id=${SUCCEEDED_ID}`,
        authorization: `Bearer ${TOKEN}`,
        body: undefined,
      },
    ]);
  });

  it("session --dump takes the proxy from SERVER_URL, sends the id as the database spells it, and prints an empty console as nothing", async () => {
    const stub = await proxy(() => ({
      status: 200,
      headers: { "Content-Type": "text/plain" },
      body: "",
    }));
    const result = await runCtrl(
      ["session", "--session-id", SUCCEEDED_ID.toUpperCase(), "--dump"],
      {
        SERVER_URL: stub.url,
      },
    );
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(stub.requests.map((request) => request.url)).toEqual([`/dump?id=${SUCCEEDED_ID}`]);
  });

  it("session --dump rejects an unknown session before calling the proxy", async () => {
    const sessionId = randomUUID();
    const stub = await proxy();
    const result = await runCtrl([
      "session",
      "--session-id",
      sessionId,
      "--dump",
      "--server-url",
      stub.url,
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(firstLine(result.stderr)).toBe(`session: no session ${sessionId}`);
    expect(stub.requests).toEqual([]);
  });

  it("session --dump does not combine with the JSON selectors", async () => {
    const stub = await proxy();
    for (const selector of ["--logs", "--all"]) {
      const result = await runCtrl([
        "session",
        "--session-id",
        SUCCEEDED_ID,
        "--dump",
        selector,
        "--server-url",
        stub.url,
      ]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(firstLine(result.stderr)).toBe(
        "session: --dump does not combine with --logs, --test-def, --test-results, --actions, or --all",
      );
    }
    expect(stub.requests).toEqual([]);
  });

  it("session --dump prints the proxy's refusal as the headline, then the cause, and exits 1", async () => {
    const message = `session "${SUCCEEDED_ID}" has no console on this proxy`;
    const stub = await proxy(() => StubProxy.refusal(409, message));
    const result = await runCtrl([
      "session",
      "--session-id",
      SUCCEEDED_ID,
      "--dump",
      "--server-url",
      stub.url,
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(firstLine(result.stderr)).toBe(message);
    expect(result.stderr).toMatch(/ProxyRefusal/);
    expect(result.stderr).not.toMatch(/src\/client\/http\.ts/);
    expect(stub.requests).toHaveLength(1);
  });

  it("session --dump spells out a proxy that refuses the connection (changed: R2)", async () => {
    const closed = await StubProxy.startStubProxy();
    await closed.close();
    const result = await runCtrl([
      "session",
      "--session-id",
      SUCCEEDED_ID,
      "--dump",
      "--server-url",
      closed.url,
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(firstLine(result.stderr)).toMatch(
      /^GET http:\/\/127\.0\.0\.1:\d+\/dump\?id=.* failed: .*ECONNREFUSED/,
    );
    expect(result.stderr).not.toMatch(/TypeError: fetch failed/);
    expect(result.stderr).not.toMatch(/code: 'ECONNREFUSED'/);
  });

  it("session --dump requires OLIGARCHY_TOKEN before calling the proxy", async () => {
    const stub = await proxy();
    const result = await runCtrl(
      ["session", "--session-id", SUCCEEDED_ID, "--dump", "--server-url", stub.url],
      {
        OLIGARCHY_TOKEN: "",
      },
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(firstLine(result.stderr)).toBe("OLIGARCHY_TOKEN is not set");
    expect(stub.requests).toEqual([]);
  });

  it("test new without LINEAR_API_TOKEN exits 1 after parsing and writes nothing", async () => {
    const result = await runCtrl(
      [
        "test",
        "new",
        "--iso",
        "https://example.com/omarchy.iso",
        "--version",
        "1.2.3",
        "--server-url",
        SERVER,
      ],
      { LINEAR_API_TOKEN: "" },
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(firstLine(result.stderr)).toBe("LINEAR_API_TOKEN is not set");
  });
});
