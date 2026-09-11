import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as DbSchema from "../../src/db/schema.ts";
import * as Postgres from "../support/postgres.ts";

// The root wrapper.
const CTRL = fileURLToPath(new URL("../../ctrl", import.meta.url));
const EXIT_WITHIN_MS = 60_000;
const SERVER = "https://qemu.example.com";
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
        // ctrl never talks to the proxy, so no action gets its token.
        OLIGARCHY_TOKEN: "",
        SERVER_URL: "",
        LINEAR_API_TOKEN: "",
        // The session comes from the flag unless a test names it here.
        SESSION_ID: "",
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

// No ctrl action ends a session, so an ended one is seeded straight into the container.
const seedEndedSession = async (
  status: "succeeded" | "failed" = "failed",
  reason = "installer hung",
): Promise<string> => {
  const sessionId = randomUUID();
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    await drizzle({ client })
      .insert(DbSchema.sessions)
      .values({ id: sessionId, config: { iso: "x" }, status, reason, endedAt: new Date() });
  } finally {
    await client.end();
  }
  return sessionId;
};

// A run with one result for the seeded definition, tied to the session given, or to none: the
// row `test new` would create, without Linear.
const seedResult = async (sessionId: string | null): Promise<string> => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client });
    const [definition] = await db
      .select({ id: DbSchema.testDefinitions.id })
      .from(DbSchema.testDefinitions)
      .where(eq(DbSchema.testDefinitions.name, DEFINITION))
      .limit(1);
    if (definition === undefined) {
      throw new Error(`seed: no test definition ${DEFINITION}`);
    }
    const [run] = await db
      .insert(DbSchema.testRuns)
      .values({ name: "seed", iso: "https://example.com/omarchy.iso", serverUrl: SERVER })
      .returning({ id: DbSchema.testRuns.id });
    if (run === undefined) {
      throw new Error("seed: no run inserted");
    }
    const [result] = await db
      .insert(DbSchema.testResults)
      .values({
        runId: run.id,
        definitionId: definition.id,
        sessionId,
        status: sessionId === null ? "pending" : "running",
      })
      .returning({ id: DbSchema.testResults.id });
    if (result === undefined) {
      throw new Error("seed: no result inserted");
    }
    return result.id;
  } finally {
    await client.end();
  }
};

const lines = (text: string): ReadonlyArray<string> =>
  text.split("\n").filter((line) => line !== "");

type SeededJob = {
  readonly ticket: string | null;
  readonly action: (typeof DbSchema.automationJobs.$inferInsert)["action"];
  readonly status: (typeof DbSchema.automationJobs.$inferInsert)["status"];
  readonly queuedSecondsAgo: number;
  readonly startedSecondsAgo?: number;
  readonly finishedSecondsAgo?: number;
};

const secondsAgo = (seconds: number) => sql`now() - make_interval(secs => ${seconds})`;

// One definition, and per job its own run and result. The jobs already in the container go
// first: this listing is its own to arrange.
const seedAutomationJobs = async (jobs: ReadonlyArray<SeededJob>): Promise<void> => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client });
    await db.delete(DbSchema.automationJobs);
    const [definition] = await db
      .insert(DbSchema.testDefinitions)
      .values({
        name: `automation-list-${randomUUID()}`,
        description: "d",
        instruction: "i",
        proof: "p",
      })
      .returning({ id: DbSchema.testDefinitions.id });
    if (definition === undefined) {
      throw new Error("seed: no definition inserted");
    }
    const runs = await db
      .insert(DbSchema.testRuns)
      .values(
        jobs.map((_, index) => ({
          name: `automation-list ${String(index)}`,
          iso: "https://example.com/omarchy.iso",
          serverUrl: SERVER,
        })),
      )
      .returning({ id: DbSchema.testRuns.id });
    const results = await db
      .insert(DbSchema.testResults)
      .values(
        jobs.map((job, index) => {
          const run = runs[index];
          if (run === undefined) {
            throw new Error("seed: no run inserted");
          }
          return {
            runId: run.id,
            definitionId: definition.id,
            linearId: job.ticket,
          };
        }),
      )
      .returning({ id: DbSchema.testResults.id });
    await db.insert(DbSchema.automationJobs).values(
      jobs.map((job, index) => {
        const result = results[index];
        if (result === undefined) {
          throw new Error("seed: no result inserted");
        }
        return {
          resultId: result.id,
          action: job.action,
          status: job.status,
          createdAt: secondsAgo(job.queuedSecondsAgo),
          startedAt: job.startedSecondsAgo === undefined ? null : secondsAgo(job.startedSecondsAgo),
          finishedAt:
            job.finishedSecondsAgo === undefined ? null : secondsAgo(job.finishedSecondsAgo),
        };
      }),
    );
  } finally {
    await client.end();
  }
};

// ---------------------------------------------------------------------------
// Without a database: parsing, environment order
// ---------------------------------------------------------------------------

describe("./ctrl without a database", () => {
  it("bare ./ctrl prints help and exits 0; an unknown action exits 1 (changed: R3)", async () => {
    const bare = await runCtrl([], { DATABASE_URL: "" });
    expect(bare.code).toBe(0);
    expect(bare.stdout).toMatch(/test-results/);
    expect(bare.stdout).toMatch(/session/);
    expect(bare.stdout).toMatch(/automation/);

    const unknown = await runCtrl(["reboot"], { DATABASE_URL: "" });
    expect(unknown.code).toBe(1);
    expect(unknown.stdout.includes("{")).toBe(false);
  });

  it("--help on the root, test, session and a subcommand exits 0 without a database", async () => {
    for (const args of [
      ["--help"],
      ["test", "--help"],
      ["session", "--help"],
      ["test", "start", "--help"],
      ["diagnose", "--help"],
      ["automation", "--help"],
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

  it("test run and diagnose run are unknown actions that spawn no agent", async () => {
    for (const args of [
      ["test", "run", "--ticket", "OLI-42"],
      ["diagnose", "run", "--session-id", SUCCEEDED_ID],
    ]) {
      const result = await runCtrl(args, { DATABASE_URL: UNUSED_DB });
      expect(result.code, args.join(" ")).toBe(1);
      expect(result.stdout.includes("Agent here"), args.join(" ")).toBe(false);
      expect(result.stdout.includes("{"), args.join(" ")).toBe(false);
    }
  });

  it("rejects a missing DATABASE_URL before doing anything, on every database action", async () => {
    for (const args of [
      ["test", "--list"],
      ["test", "list"],
      // Tickets written before --server-url left ctrl still name it here: it parses, unread.
      [
        "test",
        "start",
        "--session-id",
        SUCCEEDED_ID,
        "--test-result-id",
        randomUUID(),
        "--model",
        "m",
        "--server-url",
        SERVER,
      ],
      [
        "test-results",
        "--agent-id",
        "a",
        "--id",
        randomUUID(),
        "--status",
        "success",
        "--server-url",
        SERVER,
      ],
      ["session", "list"],
      ["session", "--session-id", SUCCEEDED_ID, "--logs"],
      ["session", "--search", "--test-result-id", randomUUID()],
      ["error-type", "new", "--key", "k", "--description", "d"],
      ["error-type", "list"],
      [
        "diagnose",
        "--session-id",
        SUCCEEDED_ID,
        "--verdict",
        "failed",
        "--type",
        "k",
        "--summary",
        "s",
        "--model",
        "m",
      ],
      ["automation", "--list"],
    ]) {
      const result = await runCtrl(args, {
        DATABASE_URL: "",
        LINEAR_API_TOKEN: "l",
      });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(firstLine(result.stderr)).toBe("DATABASE_URL is not set");
    }
  });

  it("session refuses the flag pairs that cannot combine before any query, and wants a session from somewhere", async () => {
    const env = { DATABASE_URL: UNUSED_DB };
    const cases: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
      [["session", "--search"], "session: --search needs --test-result-id"],
      [
        ["session", "--search", "--test-result-id", randomUUID(), "--all"],
        "session: --search takes no selector",
      ],
      [
        ["session", "--session-id", randomUUID(), "--test-result-id", randomUUID(), "--logs"],
        "session: --test-result-id needs --search",
      ],
      [["session", "--status"], "session: --session-id or SESSION_ID is required"],
      [["session"], "session: --session-id or SESSION_ID is required"],
    ];
    for (const [args, headline] of cases) {
      const result = await runCtrl(args, env);
      expect(result.code, args.join(" ")).toBe(1);
      expect(result.stdout, args.join(" ")).toBe("");
      expect(firstLine(result.stderr), args.join(" ")).toBe(headline);
      expect(result.stderr, args.join(" ")).toMatch(/CommandError/);
      expect(result.stderr, args.join(" ")).not.toMatch(/ECONNREFUSED/);
    }
  });

  it("test start and diagnose without --session-id or SESSION_ID are usage errors", async () => {
    const env = { DATABASE_URL: UNUSED_DB };
    for (const args of [
      ["test", "start", "--test-result-id", randomUUID(), "--model", "m"],
      ["diagnose", "--verdict", "passed", "--summary", "s", "--model", "m"],
    ]) {
      const result = await runCtrl(args, env);
      expect(result.code, args.join(" ")).toBe(1);
      expect(result.stdout.includes("{"), args.join(" ")).toBe(false);
      expect(result.stderr, args.join(" ")).toMatch(/Missing required flag: --session-id/);
    }
  });

  it("spells out a database that refuses the connection: the headline, then the cause (changed: R1)", async () => {
    const result = await runCtrl(["test", "--list"], {
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
      [["test"], /Missing required flag: --list/, env],
      // The proxy url is test new's alone; nothing else has a proxy to name.
      [["test", "--list", "--server-url", SERVER], /Unrecognized flag: --server-url/, env],
      [["session", "list", "--server-url", SERVER], /Unrecognized flag: --server-url/, env],
      [
        ["session", "--session-id", randomUUID(), "--logs", "--server-url", SERVER],
        /Unrecognized flag: --server-url/,
        env,
      ],
      [
        ["session", "--session-id", randomUUID(), "--dump"],
        /Unrecognized flag: --dump/,
        { ...env, OLIGARCHY_TOKEN: "t" },
      ],
      [["error-type", "list", "--server-url", SERVER], /Unrecognized flag: --server-url/, env],
      [
        [
          "diagnose",
          "--session-id",
          randomUUID(),
          "--verdict",
          "passed",
          "--summary",
          "s",
          "--model",
          "m",
          "--server-url",
          SERVER,
        ],
        /Unrecognized flag: --server-url/,
        env,
      ],
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
        ["test-results", "--id", randomUUID(), "--status", "success"],
        /Missing required flag: --agent-id/,
        env,
      ],
      [
        ["test", "start", "--session_id", randomUUID(), "--test_result_id", randomUUID()],
        /Unrecognized flag: --session_id/,
        env,
      ],
      [
        ["session", "list", "--count", "0"],
        /Invalid value for flag --count: "0"[\s\S]*count must be at least 1/,
        env,
      ],
      [["session", "list", "--count", "ten"], /Invalid value for flag --count: "ten"/, env],
      [["automation"], /Missing required flag: --list/, env],
      [
        ["automation", "--list", "--count", "0"],
        /Invalid value for flag --count: "0"[\s\S]*count must be at least 1/,
        env,
      ],
      [["automation", "--list", "--count", "ten"], /Invalid value for flag --count: "ten"/, env],
      [["session", "list", "--session-id", randomUUID()], /Unrecognized flag: --session-id/, env],
      [
        ["session", "--session-id", randomUUID(), "--logs", "--active"],
        /Unrecognized flag: --active/,
        env,
      ],
      [
        ["session", "--session-id", randomUUID(), "--logs", "--count", "3"],
        /Unrecognized flag: --count/,
        env,
      ],
      [
        ["session", "--search", "--test-result-id", ""],
        /--test-result-id[\s\S]*length of at least 1/,
        env,
      ],
      [
        ["session", "--search", "--test-result-id", randomUUID(), "--server-url", SERVER],
        /Unrecognized flag: --server-url/,
        env,
      ],
      [
        ["error-type", "new", "--key", "Guest Boot", "--description", "d"],
        /key must be snake_case: a-z, 0-9 and _, starting with a letter/,
        env,
      ],
      [
        ["error-type", "new", "--key", "guest_boot_hang"],
        /Missing required flag: --description/,
        env,
      ],
      [
        [
          "diagnose",
          "--session-id",
          randomUUID(),
          "--verdict",
          "failed",
          "--type",
          "guest-boot-hang",
          "--summary",
          "s",
          "--model",
          "m",
        ],
        /key must be snake_case: a-z, 0-9 and _, starting with a letter/,
        env,
      ],
      [
        [
          "diagnose",
          "--session-id",
          randomUUID(),
          "--verdict",
          "failed",
          "--type",
          "k",
          "--model",
          "m",
        ],
        /Missing required flag: --summary/,
        env,
      ],
      [
        ["diagnose", "--session-id", randomUUID(), "--type", "k", "--summary", "s", "--model", "m"],
        /Missing required flag: --verdict/,
        env,
      ],
      [
        [
          "diagnose",
          "--session-id",
          randomUUID(),
          "--verdict",
          "succeeded",
          "--summary",
          "s",
          "--model",
          "m",
        ],
        /Invalid value for flag --verdict: "succeeded"/,
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
    const result = await runCtrl(["test", "--list"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(lines(result.stdout)).toContain(DEFINITION);
    expect(result.stdout.includes("{")).toBe(false);

    const named = await runCtrl(["test", "--list", "--name", DEFINITION]);
    expect(named.stderr).toBe("");
    expect(named.code).toBe(0);
    expect(named.stdout).toBe(`${DEFINITION}\n`);
  });

  it("test --list --details --name prints every field of one definition as JSON", async () => {
    const result = await runCtrl(["test", "--list", "--details", "--name", DEFINITION]);
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
    const result = await runCtrl(["test", "--list", "--name", "missing-definition"]);
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
      "--model",
      "grok-4.6",
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
    ]);
    expect(results.code).toBe(1);
    expect(firstLine(results.stderr)).toBe(`test-results: result ${resultId} not found`);
  });

  it("session list prints coloured status, age, and id lines, newest first", async () => {
    const result = await runCtrl(["session", "list"]);
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
    const two = await runCtrl(["session", "list", "--count", "2"]);
    expect(two.stderr).toBe("");
    expect(two.code).toBe(0);
    expect(lines(two.stdout).length).toBeLessThanOrEqual(2);

    const one = await runCtrl(["session", "list", "--count=1"]);
    expect(one.stderr).toBe("");
    expect(one.code).toBe(0);
    expect(lines(one.stdout)).toHaveLength(1);
  });

  it("session list --active --json returns only active sessions with running rows first", async () => {
    const result = await runCtrl(["session", "list", "--active", "--json", "--count", "10"]);
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

  it("automation --list prints running, then pending, then completed, from the database", async () => {
    await seedAutomationJobs([
      {
        ticket: "CTL-101",
        action: "drive",
        status: "running",
        queuedSecondsAgo: 300,
        startedSecondsAgo: 5,
      },
      {
        ticket: "CTL-102",
        action: "diagnose",
        status: "running",
        queuedSecondsAgo: 100,
        startedSecondsAgo: 2,
      },
      { ticket: "CTL-103", action: "drive", status: "pending", queuedSecondsAgo: 90 },
      { ticket: "CTL-104", action: "diagnose", status: "pending", queuedSecondsAgo: 30 },
      {
        ticket: "CTL-105",
        action: "drive",
        status: "succeeded",
        queuedSecondsAgo: 3_000,
        startedSecondsAgo: 2_900,
        finishedSecondsAgo: 600,
      },
      {
        ticket: "CTL-106",
        action: "drive",
        status: "failed",
        queuedSecondsAgo: 2_000,
        startedSecondsAgo: 1_900,
        finishedSecondsAgo: 60,
      },
    ]);
    const result = await runCtrl(["automation", "--list"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const printed = lines(result.stdout);
    expect(printed[0]).toBe("running");
    expect(printed[1]).toContain("CTL-102");
    expect(printed[1]).toContain("diagnose");
    expect(printed[1]).toContain("running");
    expect(printed[2]).toContain("CTL-101");
    expect(printed[2]).toContain("drive");
    const pendingAt = printed.indexOf("pending");
    expect(printed[pendingAt + 1]).toContain("CTL-104");
    expect(printed[pendingAt + 2]).toContain("CTL-103");
    const completedAt = printed.indexOf("completed");
    expect(printed[completedAt + 1]).toContain("CTL-106");
    expect(printed[completedAt + 1]).toContain("failed");
    expect(printed[completedAt + 2]).toContain("CTL-105");
    expect(printed[completedAt + 2]).toContain("succeeded");
  });

  it("automation --list --count bounds only the completed jobs", async () => {
    await seedAutomationJobs([
      { ticket: "CTL-201", action: "drive", status: "pending", queuedSecondsAgo: 10 },
      {
        ticket: "CTL-202",
        action: "drive",
        status: "succeeded",
        queuedSecondsAgo: 200,
        startedSecondsAgo: 180,
        finishedSecondsAgo: 90,
      },
      {
        ticket: "CTL-203",
        action: "diagnose",
        status: "failed",
        queuedSecondsAgo: 300,
        startedSecondsAgo: 280,
        finishedSecondsAgo: 20,
      },
    ]);
    const result = await runCtrl(["automation", "--list", "--count=1"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const printed = lines(result.stdout);
    expect(printed).toContain("pending");
    expect(printed.some((line) => line.includes("CTL-201"))).toBe(true);
    expect(printed.some((line) => line.includes("CTL-203"))).toBe(true);
    expect(printed.some((line) => line.includes("CTL-202"))).toBe(false);
  });

  it("session --logs prints the bare JSON array and needs neither OLIGARCHY_TOKEN nor SERVER_URL", async () => {
    const result = await runCtrl(["session", "--session-id", SUCCEEDED_ID, "--logs"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(Array.isArray(JSON.parse(result.stdout))).toBe(true);
  });

  it("session --all prints { session, logs, results, test_definition, test_run, actions, images, debug_log, diagnosis } for a seeded session", async () => {
    const result = await runCtrl(["session", "--session-id", RUNNING_ID, "--all"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const printed: Record<string, unknown> = JSON.parse(result.stdout);
    expect(Object.keys(printed)).toEqual([
      "session",
      "logs",
      "results",
      "test_definition",
      "test_run",
      "actions",
      "images",
      "debug_log",
      "diagnosis",
    ]);
    expect(printed.session).toMatchObject({
      id: RUNNING_ID,
      status: "running",
      config: { iso: "y" },
    });
    expect(Array.isArray(printed.logs)).toBe(true);
    expect(Array.isArray(printed.actions)).toBe(true);
    expect(printed.images).toEqual([]);
    expect(printed.results).toBeNull();
    expect(printed.test_definition).toBeNull();
    expect(printed.test_run).toBeNull();
    expect(printed.debug_log).toBeNull();
    expect(printed.diagnosis).toBeNull();
  });

  it("session --status prints the bare session row", async () => {
    const result = await runCtrl(["session", "--session-id", SUCCEEDED_ID, "--status"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const row: Record<string, unknown> = JSON.parse(result.stdout);
    expect(row).toMatchObject({ id: SUCCEEDED_ID, status: "succeeded", config: { iso: "x" } });
    expect(Object.keys(row).sort()).toEqual([
      "config",
      "endedAt",
      "id",
      "reason",
      "startedAt",
      "status",
    ]);
  });

  it("error-type new stores a type that error-type list prints, and refuses the key twice", async () => {
    const key = `guest_boot_hang_${randomUUID().replaceAll("-", "_")}`;
    const created = await runCtrl([
      "error-type",
      "new",
      "--key",
      key,
      "--description",
      "never reached login",
    ]);
    expect(created.stderr).toBe("");
    expect(created.code).toBe(0);
    // The Log service's stdout copy of the logs row; no agent, so [global].
    expect(created.stdout).toBe(`[global] error type created; ${key}\n`);

    const listed = await runCtrl(["error-type", "list"]);
    expect(listed.stderr).toBe("");
    expect(listed.code).toBe(0);
    expect(lines(listed.stdout).some((line) => line.startsWith(`${key} `))).toBe(true);
    expect(lines(listed.stdout).some((line) => line.endsWith("  never reached login"))).toBe(true);

    const asJson = await runCtrl(["error-type", "list", "--json"]);
    expect(asJson.code).toBe(0);
    const rows: Array<{ key: string; description: string; createdAt: string }> = JSON.parse(
      asJson.stdout,
    );
    expect(rows.find((row) => row.key === key)).toMatchObject({
      description: "never reached login",
    });

    const again = await runCtrl([
      "error-type",
      "new",
      "--key",
      key,
      "--description",
      "a second meaning",
    ]);
    expect(again.code).toBe(1);
    expect(again.stdout).toBe("");
    expect(firstLine(again.stderr)).toBe(`error-type new: ${key} already exists`);
    expect(again.stderr).toMatch(/CommandError/);
  });

  it("diagnose refuses an unknown session, a running session, a verdict without its type, and an unknown type", async () => {
    const sessionId = randomUUID();
    const diagnose = (id: string, ...verdict: ReadonlyArray<string>) =>
      runCtrl([
        "diagnose",
        "--session-id",
        id,
        ...verdict,
        "--summary",
        "the kernel waited on the root device",
        "--model",
        "composer-2.5",
      ]);
    const unknown = await diagnose(sessionId, "--verdict", "failed", "--type", "guest_boot_hang");
    expect(unknown.code).toBe(1);
    expect(unknown.stdout).toBe("");
    expect(firstLine(unknown.stderr)).toBe(`diagnose: no session ${sessionId}`);

    const running = await diagnose(RUNNING_ID, "--verdict", "failed", "--type", "guest_boot_hang");
    expect(running.code).toBe(1);
    expect(firstLine(running.stderr)).toBe(`diagnose: session ${RUNNING_ID} is still running`);

    const failed = await seedEndedSession();
    const untyped = await diagnose(failed, "--verdict", "failed");
    expect(untyped.code).toBe(1);
    expect(firstLine(untyped.stderr)).toBe("diagnose: --verdict failed needs --type");

    const typedPass = await diagnose(failed, "--verdict", "passed", "--type", "guest_boot_hang");
    expect(typedPass.code).toBe(1);
    expect(firstLine(typedPass.stderr)).toBe("diagnose: --verdict passed takes no --type");

    const key = `never_${randomUUID().replaceAll("-", "_")}`;
    const missing = await diagnose(failed, "--verdict", "failed", "--type", key);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
    expect(firstLine(missing.stderr)).toBe(
      `diagnose: no error type ${key}; create it with ./ctrl error-type new`,
    );
    expect(missing.stderr).toMatch(/CommandError/);
  });

  it("diagnose records a passed verdict on a succeeded session; session --diagnosis prints it with a null type", async () => {
    const sessionId = await seedEndedSession("succeeded", "lock screen on screen");
    const result = await runCtrl([
      "diagnose",
      "--session-id",
      sessionId,
      "--verdict",
      "passed",
      "--summary",
      "the last image shows the lock screen with the clock",
      "--model",
      "composer-2.5",
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`[global] ${sessionId}: diagnosed; passed; composer-2.5\n`);

    const printed = await runCtrl(["session", "--session-id", sessionId, "--diagnosis"]);
    expect(printed.code).toBe(0);
    expect(JSON.parse(printed.stdout)).toMatchObject({
      sessionId,
      verdict: "passed",
      errorType: null,
      summary: "the last image shows the lock screen with the clock",
      model: "composer-2.5",
    });
  });

  it("session --diagnosis prints null for a session without one", async () => {
    const result = await runCtrl(["session", "--session-id", SUCCEEDED_ID, "--diagnosis"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("null\n");
  });

  it("diagnose writes the row for a failed session once; session --diagnosis prints it", async () => {
    const sessionId = await seedEndedSession();
    const key = `installer_hang_${randomUUID().replaceAll("-", "_")}`;
    expect(
      (
        await runCtrl([
          "error-type",
          "new",
          "--key",
          key,
          "--description",
          "the installer never finished",
        ])
      ).code,
    ).toBe(0);

    const diagnose = (type: string, summary: string) =>
      runCtrl([
        "diagnose",
        "--session-id",
        sessionId,
        "--verdict",
        "failed",
        "--type",
        type,
        "--summary",
        summary,
        "--model",
        "composer-2.5",
      ]);
    const first = await diagnose(key, "serial stops after the partition step");
    expect(first.stderr).toBe("");
    expect(first.code).toBe(0);
    expect(first.stdout).toBe(`[global] ${sessionId}: diagnosed; failed; ${key}; composer-2.5\n`);

    const second = await diagnose(key, "on reflection");
    expect(second.code).toBe(1);
    expect(second.stdout).toBe("");
    expect(firstLine(second.stderr)).toBe(`diagnose: session ${sessionId} already has a diagnosis`);

    const printed = await runCtrl(["session", "--session-id", sessionId, "--diagnosis"]);
    expect(printed.stderr).toBe("");
    expect(printed.code).toBe(0);
    const row: { sessionId: string; errorType: string; summary: string; model: string } =
      JSON.parse(printed.stdout);
    expect(row).toMatchObject({
      sessionId,
      verdict: "failed",
      errorType: key,
      summary: "serial stops after the partition step",
      model: "composer-2.5",
    });
    expect(Object.keys(row).sort()).toEqual([
      "createdAt",
      "errorType",
      "model",
      "sessionId",
      "summary",
      "verdict",
    ]);
  });

  it("session --search prints the session a result ran in, which SESSION_ID then names for inspection", async () => {
    const sessionId = await seedEndedSession("succeeded", "lock screen on screen");
    const resultId = await seedResult(sessionId);
    const found = await runCtrl(["session", "--search", `--test-result-id=${resultId}`]);
    expect(found.stderr).toBe("");
    expect(found.code).toBe(0);
    expect(found.stdout).toBe(`${sessionId}\n`);

    // The bare line is made to be captured: SESSION_ID=$(./ctrl session --search ...).
    const inspected = await runCtrl(["session", "--status"], { SESSION_ID: sessionId });
    expect(inspected.stderr).toBe("");
    expect(inspected.code).toBe(0);
    expect(JSON.parse(inspected.stdout)).toMatchObject({ id: sessionId, status: "succeeded" });

    // The flag wins over the environment.
    const flagged = await runCtrl(["session", "--session-id", SUCCEEDED_ID, "--status"], {
      SESSION_ID: sessionId,
    });
    expect(flagged.code).toBe(0);
    expect(JSON.parse(flagged.stdout)).toMatchObject({ id: SUCCEEDED_ID });

    // SESSION_ID names the session for test start and diagnose too; here it starts the result
    // a second seeded run holds and then reviews the same session.
    const pendingId = await seedResult(null);
    const startSession = await seedEndedSession("failed");
    const started = await runCtrl(
      ["test", "start", "--test-result-id", pendingId, "--model", "composer-2.5"],
      { SESSION_ID: startSession },
    );
    expect(started.stderr).toBe("");
    expect(started.code).toBe(0);
    const startedSearch = await runCtrl(["session", "--search", "--test-result-id", pendingId]);
    expect(startedSearch.code).toBe(0);
    expect(startedSearch.stdout).toBe(`${startSession}\n`);
    const diagnosed = await runCtrl(
      ["diagnose", "--verdict", "passed", "--summary", "s", "--model", "composer-2.5"],
      { SESSION_ID: startSession },
    );
    expect(diagnosed.stderr).toBe("");
    expect(diagnosed.code).toBe(0);
    expect(diagnosed.stdout).toBe(`[global] ${startSession}: diagnosed; passed; composer-2.5\n`);
  });

  it("session --search refuses a result nobody has and one no session has run yet", async () => {
    const unknownId = randomUUID();
    const unknown = await runCtrl(["session", "--search", "--test-result-id", unknownId]);
    expect(unknown.code).toBe(1);
    expect(unknown.stdout).toBe("");
    expect(firstLine(unknown.stderr)).toBe(`session: no test result ${unknownId}`);
    expect(unknown.stderr).toMatch(/CommandError/);

    const pendingId = await seedResult(null);
    const pending = await runCtrl(["session", "--search", "--test-result-id", pendingId]);
    expect(pending.code).toBe(1);
    expect(pending.stdout).toBe("");
    expect(firstLine(pending.stderr)).toBe(`session: result ${pendingId} has no session yet`);
  });

  it("session requires a selector and rejects an unknown session", async () => {
    const sessionId = randomUUID();
    const noSelector = await runCtrl(["session", "--session-id", sessionId]);
    expect(noSelector.code).toBe(1);
    expect(firstLine(noSelector.stderr)).toBe(
      "session: --status, --logs, --test-def, --test-results, --test-run, --actions, --images, --debug-logs, --diagnosis, or --all is required",
    );
    expect(noSelector.stderr).toMatch(/CommandError/);
    expect(noSelector.stderr).not.toMatch(/at sessionInspectRun/);

    const unknown = await runCtrl(["session", "--session-id", sessionId, "--logs"]);
    expect(unknown.code).toBe(1);
    expect(firstLine(unknown.stderr)).toBe(`session: no session ${sessionId}`);
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
