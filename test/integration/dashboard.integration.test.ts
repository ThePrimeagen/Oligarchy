import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import * as DbSchema from "@oligarchy/db/schema";
import { app, scheduled } from "../../src/dashboard/dashboard.tsx";
import * as Postgres from "../support/postgres.ts";
import * as StubProxy from "../support/stub-proxy.ts";

const QUERY = fileURLToPath(new URL("../../src/dashboard/query.ts", import.meta.url));
const SCHEMA = fileURLToPath(new URL("../../packages/db/src/schema.ts", import.meta.url));
const SENTINEL_PASSWORD = "sentinel-secret-pw";
const REFUSED_URL = `postgres://user:${SENTINEL_PASSWORD}@127.0.0.1:1/oligarchy`;
const SEEDED_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const EXIT_WITHIN_MS = 15_000;

const dbUrl = Postgres.getDbUrl();

type QueryRun = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly hung: boolean;
};

// Each call runs in its own process and the script never calls process.exit: a pg client
// that is not ended keeps the event loop alive, so the process exiting on its own is the
// proof that end() ran, on success and on failure alike.
const runQuery = (script: string, databaseUrl: string): Promise<QueryRun> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `import * as query from ${JSON.stringify(QUERY)};\nconst url = process.env.DATABASE_URL;\n${script}`,
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl } },
    );
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
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, hung: signal === "SIGKILL" });
    });
  });

const lines = (output: string): ReadonlyArray<string> =>
  output.split("\n").filter((line) => line !== "");

describe.skipIf(dbUrl === "")("dashboard/query happy path", () => {
  it("lists test definitions and ends the connection so the process exits on its own", async () => {
    const result = await runQuery(
      "const rows = await query.listTestDefinitions(url);\nconsole.log(rows.map((row) => row.name).join('\\n'));",
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(lines(result.stdout)).toContain("lock-screen");
  });

  it("lists sessions with their latest image id and ends the connection", async () => {
    const result = await runQuery(
      "const rows = await query.listSessions(url);\nconsole.log(rows.map((row) => [row.id, typeof row.status, row.imageId === null ? 'null' : typeof row.imageId, row.queriedAt instanceof Date, row.definitionName === null ? 'null' : row.definitionName, row.definitionVersion === null ? 'null' : typeof row.definitionVersion, row.model === null ? 'null' : row.model].join(' ')).join('\\n'));",
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const rows = lines(result.stdout);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(50);
    for (const row of rows) {
      expect(row).toMatch(/^[0-9a-f-]{36} string (null|string) true \S+ (null|number) \S+$/);
    }
    expect(rows.some((row) => row.startsWith(`${SEEDED_SESSION_ID} `))).toBe(true);
  });

  it("joins each session to its result's definition, version and model, including two models on one run (happy)", async () => {
    const result = await runQuery(
      `
const { drizzle } = await import("drizzle-orm/node-postgres");
const { Client } = await import("pg");
const schema = await import(${JSON.stringify(SCHEMA)});
const client = new Client({ connectionString: url });
await client.connect();
const db = drizzle(client);
// Two wordings of one name: the session that ran the second is labelled v2, not v1.
await db.insert(schema.testDefinitions).values({ name: "lock-sessions", description: "d", instruction: "first", proof: "p" });
const [lockV2] = await db.insert(schema.testDefinitions).values({ name: "lock-sessions", description: "d", instruction: "second", proof: "p" }).returning({ id: schema.testDefinitions.id });
const [install] = await db.insert(schema.testDefinitions).values({ name: "install", description: "d", instruction: "i", proof: "p" }).returning({ id: schema.testDefinitions.id });
const [run] = await db.insert(schema.testRuns).values({ name: "Omarchy experiment", iso: "https://example.com/omarchy.iso", serverUrl: "http://127.0.0.1:42069" }).returning({ id: schema.testRuns.id });
await db.insert(schema.testResults).values([
  { runId: run.id, definitionId: lockV2.id, sessionId: ${JSON.stringify(SEEDED_SESSION_ID)}, status: "passed", model: "grok-4.6" },
  { runId: run.id, definitionId: install.id, sessionId: "22222222-2222-4222-8222-222222222222", status: "failed", model: "composer-2.5" },
]);
await client.end();
const rows = await query.listSessions(url);
const lockRow = rows.find((row) => row.id === ${JSON.stringify(SEEDED_SESSION_ID)});
const installRow = rows.find((row) => row.id === "22222222-2222-4222-8222-222222222222");
console.log([lockRow?.definitionName, lockRow?.definitionVersion, lockRow?.model, installRow?.definitionName, installRow?.definitionVersion, installRow?.model].join(" "));
console.log(JSON.stringify(query.definitionStats(rows).filter((row) => row.name === "install" || row.name === "lock-sessions")));
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const [linked, stats] = lines(result.stdout);
    expect(linked).toBe("lock-sessions 2 grok-4.6 install 1 composer-2.5");
    expect(JSON.parse(stats ?? "")).toEqual([
      { name: "install", succeeded: 0, failed: 0, other: 1, models: ["composer-2.5"] },
      { name: "lock-sessions", succeeded: 1, failed: 0, other: 0, models: ["grok-4.6"] },
    ]);
  });

  it("lists test result outcomes with the wording's id, the model and the run, and ends the connection", async () => {
    const result = await runQuery(
      `
const { drizzle } = await import("drizzle-orm/node-postgres");
const { Client } = await import("pg");
const schema = await import(${JSON.stringify(SCHEMA)});
const client = new Client({ connectionString: url });
await client.connect();
const db = drizzle(client);
const [lock] = await db.insert(schema.testDefinitions).values({ name: "lock-outcomes", description: "d", instruction: "i", proof: "p" }).returning({ id: schema.testDefinitions.id });
const [install] = await db.insert(schema.testDefinitions).values({ name: "install-outcomes", description: "d", instruction: "i", proof: "p" }).returning({ id: schema.testDefinitions.id });
const [run] = await db.insert(schema.testRuns).values({ name: "Omarchy experiment", iso: "https://example.com/omarchy.iso", serverUrl: "http://127.0.0.1:42069" }).returning({ id: schema.testRuns.id, startedAt: schema.testRuns.startedAt });
await db.insert(schema.testResults).values([
  { runId: run.id, definitionId: lock.id, status: "passed", model: "grok-4.6" },
  { runId: run.id, definitionId: install.id, status: "failed", model: "composer-2.5" },
]);
await client.end();
const rows = await query.listTestResultOutcomes(url);
const ours = rows.filter((row) => row.definitionId === lock.id || row.definitionId === install.id);
const counted = query.modelStats(ours);
console.log(ours.map((row) => [row.definitionId === lock.id ? "lock" : "install", row.model, row.status, row.runId === run.id, row.iso, row.startedAt.getTime() === run.startedAt.getTime()].join(" ")).sort().join("\\n"));
console.log(JSON.stringify(counted));
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const printed = lines(result.stdout);
    const stats = printed.at(-1);
    const listed = printed.slice(0, -1);
    expect(listed).toEqual([
      "install composer-2.5 failed true https://example.com/omarchy.iso true",
      "lock grok-4.6 passed true https://example.com/omarchy.iso true",
    ]);
    expect(JSON.parse(stats ?? "")).toEqual([
      { model: "composer-2.5", succeeded: 0, failed: 1 },
      { model: "grok-4.6", succeeded: 1, failed: 0 },
    ]);
  });

  it("lists base prompts and ends the connection", async () => {
    const result = await runQuery(
      "const rows = await query.listTestBasePrompts(url);\nconsole.log(rows.map((row) => `${row.name} ${typeof row.prompt}`).join('\\n'));",
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const rows = lines(result.stdout);
    expect(rows).toContain("base string");
    for (const row of rows) {
      expect(row).toMatch(/^\S+ string$/);
    }
  });

  it("lists the newest process reading per name, by type then name, and ends the connection", async () => {
    const qemu = `proc-qemu-${randomUUID().slice(0, 8)}`;
    const auto = `proc-auto-${randomUUID().slice(0, 8)}`;
    await seed(dbUrl, async (db) => {
      await db.insert(DbSchema.processStats).values([
        {
          name: qemu,
          type: "qemu",
          jobs: 9,
          memoryBytes: 9,
          cpuPercent: 99,
          reportedAt: sql`now() - interval '1 minute'`,
        },
        {
          name: qemu,
          type: "qemu",
          jobs: 2,
          memoryBytes: 1000,
          cpuPercent: 12.5,
        },
        {
          name: auto,
          type: "automation-client",
          jobs: 1,
          memoryBytes: 2000,
          cpuPercent: 4,
        },
      ]);
    });
    const result = await runQuery(
      `
const mine = new Set(${JSON.stringify([qemu, auto])});
const rows = (await query.listProcessStats(url)).filter((row) => mine.has(row.name));
console.log(rows.map((row) => [row.name, row.type, row.jobs, row.memoryBytes, row.cpuPercent, row.reportedAt instanceof Date, row.queriedAt instanceof Date].join(" ")).join("\\n"));
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    // `type` is the server_type enum, declared qemu then automation-client, and an enum column
    // orders by declaration: the qemu servers come first, as the servers page lays them out.
    expect(lines(result.stdout)).toEqual([
      `${qemu} qemu 2 1000 12.5 true true`,
      `${auto} automation-client 1 2000 4 true true`,
    ]);
  });

  it("lists the last 60 process readings per name as a series, oldest first, drops a reading older than 30 minutes, and ends the connection", async () => {
    const qemu = `series-qemu-${randomUUID().slice(0, 8)}`;
    const auto = `series-auto-${randomUUID().slice(0, 8)}`;
    await seed(dbUrl, async (db) => {
      await db.insert(DbSchema.processStats).values([
        ...Array.from({ length: 61 }, (_, index) => ({
          name: qemu,
          type: "qemu" as const,
          jobs: index,
          memoryBytes: index,
          cpuPercent: index,
          reportedAt: new Date(Date.now() - (60 - index) * 1_000),
        })),
        {
          name: auto,
          type: "automation-client" as const,
          jobs: 1,
          memoryBytes: 2,
          cpuPercent: 3,
        },
        {
          name: qemu,
          type: "qemu" as const,
          jobs: 99,
          memoryBytes: 99,
          cpuPercent: 99,
          reportedAt: new Date(Date.now() - 31 * 60_000),
        },
      ]);
    });
    const result = await runQuery(
      `
const mine = new Set(${JSON.stringify([qemu, auto])});
const rows = (await query.listProcessSeries(url)).filter((row) => mine.has(row.name));
console.log(rows.map((row) => [row.name, row.type, row.jobs, row.samples.length, row.samples[0].jobs, row.samples.at(-1).jobs].join(" ")).join("\\n"));
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(lines(result.stdout)).toEqual([
      `${qemu} qemu 60 60 1 60`,
      `${auto} automation-client 1 1 1 1`,
    ]);
  });

  it("reads one name's verdicts, durations and per-wording tallies, and ends the connection", async () => {
    const result = await runQuery(
      `
const { drizzle } = await import("drizzle-orm/node-postgres");
const { Client } = await import("pg");
const schema = await import(${JSON.stringify(SCHEMA)});
const client = new Client({ connectionString: url });
await client.connect();
const db = drizzle(client);
const [v1] = await db.insert(schema.testDefinitions).values({ name: "lock-results", description: "d", instruction: "first", proof: "p" }).returning({ id: schema.testDefinitions.id });
const [v2] = await db.insert(schema.testDefinitions).values({ name: "lock-results", description: "d", instruction: "second", proof: "p" }).returning({ id: schema.testDefinitions.id });
const [other] = await db.insert(schema.testDefinitions).values({ name: "install-results", description: "d", instruction: "i", proof: "p" }).returning({ id: schema.testDefinitions.id });
const [run] = await db.insert(schema.testRuns).values({ name: "results", iso: "https://example.com/omarchy.iso", serverUrl: "http://127.0.0.1:42069" }).returning({ id: schema.testRuns.id });
const at = (minute) => new Date(Date.UTC(2026, 8, 1, 0, minute));
await db.insert(schema.testResults).values([
  { runId: run.id, definitionId: v1.id, status: "failed", model: "grok-4.6", createdAt: at(0), finishedAt: at(1) },
  { runId: run.id, definitionId: v2.id, status: "passed", model: "grok-4.6", createdAt: at(10), finishedAt: at(14) },
  { runId: run.id, definitionId: v2.id, status: "failed", model: "grok-4.6", createdAt: at(20), finishedAt: at(22) },
  { runId: run.id, definitionId: v2.id, status: "passed", model: "grok-4.6", createdAt: at(30) },
  { runId: run.id, definitionId: v2.id, status: "pending", model: "grok-4.6" },
  { runId: run.id, definitionId: other.id, status: "passed", model: "grok-4.6", createdAt: at(40), finishedAt: at(49) },
]);
await client.end();
const results = await query.listDefinitionRuns(url, "lock-results");
const wording = (id) => (id === v1.id ? "v1" : id === v2.id ? "v2" : "other");
console.log(results.runs.map((row) => row.status).join(" "));
console.log(JSON.stringify(results.durations.bars));
console.log(JSON.stringify(results.tallies.map((row) => [wording(row.definitionId), row.passed, row.failed])));
console.log(JSON.stringify(query.currentVersionTally({ name: "lock-results", versions: [{ id: v1.id }, { id: v2.id }] }, results.tallies)));
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const [runs, bars, tallies, current] = lines(result.stdout);
    expect(runs).toBe("passed failed passed failed");
    // The pass with no finish has no duration; install's nine minutes are another name's.
    expect(JSON.parse(bars ?? "")).toEqual([
      { ms: 60_000, succeeded: false },
      { ms: 120_000, succeeded: false },
      { ms: 240_000, succeeded: true },
    ]);
    expect(JSON.parse(tallies ?? "")).toEqual([
      ["v1", 0, 1],
      ["v2", 2, 1],
    ]);
    expect(JSON.parse(current ?? "")).toEqual({ version: 2, passed: 2, failed: 1 });
  });

  it("returns undefined for an unknown image id and still exits", async () => {
    const result = await runQuery(
      'const image = await query.getImage(url, "00000000-0000-4000-8000-000000000000");\nconsole.log(String(image));',
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("undefined\n");
  });
});

describe.skipIf(dbUrl === "")("dashboard/query unhappy path: failed query", () => {
  it("surfaces the Postgres error from a failed query and still ends the connection", async () => {
    const result = await runQuery(
      'try {\n  await query.getImage(url, "not-a-uuid");\n} catch (err) {\n  console.error(`${err.message}: ${err.cause.message}`);\n  process.exitCode = 3;\n}',
      dbUrl,
    );
    expect(
      result.hung,
      "process did not exit: the pg client was not ended after the failed query",
    ).toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/Failed query: select "data"/);
    expect(result.stderr).toMatch(/invalid input syntax for type uuid/);
  });
});

type Page = {
  readonly status: number;
  readonly html: string;
};

// The Worker in-process: the Hono app answers a Request with the Hyperdrive binding pointed at
// the container, so the page is what production renders from these rows.
const getPage = async (path: string, databaseUrl: string): Promise<Page> => {
  const response = await app.request(path, undefined, {
    HYPERDRIVE: { connectionString: databaseUrl },
  });
  return { status: response.status, html: await response.text() };
};

const seed = async <T>(
  databaseUrl: string,
  run: (db: NodePgDatabase) => Promise<T>,
): Promise<T> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await run(drizzle(client));
  } finally {
    await client.end();
  }
};

// A form submission as the browser sends it, answered without following the redirect.
const postForm = async (
  fields: Record<string, string>,
  databaseUrl: string,
  path = "/definitions",
): Promise<{
  readonly status: number;
  readonly location: string | null;
  readonly text: string;
}> => {
  const response = await app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    },
    { HYPERDRIVE: { connectionString: databaseUrl } },
  );
  return {
    status: response.status,
    location: response.headers.get("location"),
    text: await response.text(),
  };
};

const wordingsOf = async (databaseUrl: string, name: string): Promise<ReadonlyArray<string>> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const rows = await drizzle(client)
      .select({ instruction: DbSchema.testDefinitions.instruction })
      .from(DbSchema.testDefinitions)
      .where(eq(DbSchema.testDefinitions.name, name))
      .orderBy(DbSchema.testDefinitions.id);
    return rows.map((row) => row.instruction);
  } finally {
    await client.end();
  }
};

describe.skipIf(dbUrl === "")("dashboard test diagnostic unhappy path", () => {
  it("answers 404 for a result nobody ran, or an id that is not one", async () => {
    const unknown = await getPage("/tests/99999999-9999-4999-8999-999999999999", dbUrl);
    expect(unknown.status).toBe(404);
    const bad = await getPage("/tests/not-a-result", dbUrl);
    expect(bad.status).toBe(404);
  });
});

describe.skipIf(dbUrl === "")("dashboard/definitions page unhappy path", () => {
  it("answers 404 for a name no definition carries", async () => {
    const { status } = await getPage("/definitions/no-such-definition", dbUrl);
    expect(status).toBe(404);
  });
});

describe.skipIf(dbUrl === "")("dashboard/definitions edit happy path", () => {
  it("saves a changed wording as the next version and returns to the name", async () => {
    await seed(dbUrl, async (db) => {
      await db.insert(DbSchema.testDefinitions).values([
        { name: "wide-save", description: "d", instruction: "first", proof: "p" },
        { name: "wide-save", description: "d", instruction: "second", proof: "p" },
      ]);
    });
    // Typed over two lines: the browser sends CRLF, the wording is stored with LF as ctrl writes it.
    const saved = await postForm(
      { name: "wide-save", description: "d", instruction: "third\r\nand more", proof: "p" },
      dbUrl,
    );
    expect(saved.status).toBe(303);
    expect(saved.location).toBe("/definitions/wide-save");
    expect(await wordingsOf(dbUrl, "wide-save")).toEqual(["first", "second", "third\nand more"]);
  });

  it("saves a wording that changes one field only (happy)", async () => {
    await seed(dbUrl, async (db) => {
      await db
        .insert(DbSchema.testDefinitions)
        .values({ name: "wide-one-field", description: "d", instruction: "i", proof: "p" });
    });
    const saved = await postForm(
      { name: "wide-one-field", description: "d", instruction: "i", proof: "p2" },
      dbUrl,
    );
    expect(saved.status).toBe(303);
    expect(saved.location).toBe("/definitions/wide-one-field");
    expect(await wordingsOf(dbUrl, "wide-one-field")).toEqual(["i", "i"]);
  });
});

describe.skipIf(dbUrl === "")("dashboard/definitions edit unhappy path", () => {
  it("refuses a wording identical to the newest: nothing is written", async () => {
    await seed(dbUrl, async (db) => {
      await db.insert(DbSchema.testDefinitions).values({
        name: "wide-same",
        description: "d",
        instruction: "i\nover two lines",
        proof: "p",
      });
    });
    // A browser submits a textarea's newlines as CRLF; the wording ctrl wrote has LF.
    const same = await postForm(
      { name: "wide-same", description: "d", instruction: "i\r\nover two lines", proof: "p" },
      dbUrl,
    );
    expect(same.status).toBe(303);
    expect(same.location).toBe("/definitions/wide-same?edit=unchanged");
    expect(await wordingsOf(dbUrl, "wide-same")).toEqual(["i\nover two lines"]);
  });

  it("refuses an empty field: nothing is written", async () => {
    await seed(dbUrl, async (db) => {
      await db
        .insert(DbSchema.testDefinitions)
        .values({ name: "wide-empty", description: "d", instruction: "i", proof: "p" });
    });
    const empty = await postForm(
      { name: "wide-empty", description: "d", instruction: "", proof: "p" },
      dbUrl,
    );
    expect(empty.status).toBe(303);
    expect(empty.location).toBe("/definitions/wide-empty?edit=empty");
    const missing = await postForm({ name: "wide-empty", description: "d", proof: "p" }, dbUrl);
    expect(missing.status).toBe(303);
    expect(missing.location).toBe("/definitions/wide-empty?edit=empty");
    expect(await wordingsOf(dbUrl, "wide-empty")).toEqual(["i"]);
  });

  it("answers 404 for a name nobody carries, or none at all: a new test is ctrl test define's", async () => {
    const unknown = await postForm(
      { name: "wide-nobody", description: "d", instruction: "i", proof: "p" },
      dbUrl,
    );
    expect(unknown.status).toBe(404);
    const nameless = await postForm({ description: "d", instruction: "i", proof: "p" }, dbUrl);
    expect(nameless.status).toBe(404);
    expect(await wordingsOf(dbUrl, "wide-nobody")).toEqual([]);
  });
});

describe("dashboard/definitions edit unhappy path: unreachable database", () => {
  it("answers 500 without echoing the password", async () => {
    const result = await postForm(
      { name: "lock-screen", description: "d", instruction: "i", proof: "p" },
      REFUSED_URL,
    );
    expect(result.status).toBe(500);
    expect(result.text).not.toContain(SENTINEL_PASSWORD);
  });
});

describe("dashboard/definitions page unhappy path: unreachable database", () => {
  it("answers 500 for the page and its running list, and never echoes the password", async () => {
    for (const path of ["/definitions/lock-screen", "/definitions/running"]) {
      const { status, html } = await getPage(path, REFUSED_URL);
      expect(status, path).toBe(500);
      expect(html, path).not.toContain(SENTINEL_PASSWORD);
    }
  });
});

describe("dashboard/query unhappy path: unreachable database", () => {
  it("surfaces a refused connection and exits without echoing the password", async () => {
    const result = await runQuery(
      "try {\n  await query.listTestDefinitions(url);\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toContain(SENTINEL_PASSWORD);
  });

  it("surfaces a refused connection from listTestResultOutcomes without echoing the password", async () => {
    const result = await runQuery(
      "try {\n  await query.listTestResultOutcomes(url);\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toContain(SENTINEL_PASSWORD);
  });

  it("listDefinitionRuns surfaces a refused connection and exits without echoing the password", async () => {
    const result = await runQuery(
      "try {\n  await query.listDefinitionRuns(url, 'lock-screen');\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toContain(SENTINEL_PASSWORD);
  });

  it("listProcessStats surfaces a refused connection and exits without echoing the password", async () => {
    const result = await runQuery(
      "try {\n  await query.listProcessStats(url);\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toContain(SENTINEL_PASSWORD);
  });

  it("listProcessSeries surfaces a refused connection and exits without echoing the password", async () => {
    const result = await runQuery(
      "try {\n  await query.listProcessSeries(url);\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toContain(SENTINEL_PASSWORD);
  });
});

const registered = async (
  databaseUrl: string,
): Promise<ReadonlyArray<{ readonly url: string; readonly type: string }>> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await drizzle(client)
      .select({ url: DbSchema.servers.url, type: DbSchema.servers.type })
      .from(DbSchema.servers);
  } finally {
    await client.end();
  }
};

const registeredUrls = async (databaseUrl: string): Promise<ReadonlyArray<string>> =>
  (await registered(databaseUrl)).map((row) => row.url);

describe.skipIf(dbUrl === "")("dashboard/servers page happy path", () => {
  it("adds a qemu server once, however often it is posted, and sends the browser back to the page", async () => {
    const first = await postForm({ url: "http://10.1.0.9:42069" }, dbUrl, "/servers");
    expect(first.status).toBe(303);
    expect(first.location).toBe("/servers");
    const again = await postForm({ url: "http://10.1.0.9:42069" }, dbUrl, "/servers");
    expect(again.status).toBe(303);
    const rows = await registered(dbUrl);
    expect(rows.filter((row) => row.url === "http://10.1.0.9:42069")).toEqual([
      { url: "http://10.1.0.9:42069", type: "qemu" },
    ]);
  });

  it("deletes a server and sends the browser back to the page", async () => {
    const result = await postForm({ url: "http://10.1.0.9:42069" }, dbUrl, "/servers/delete");
    expect(result.status).toBe(303);
    expect(result.location).toBe("/servers");
    expect(await registeredUrls(dbUrl)).not.toContain("http://10.1.0.9:42069");
  });
});

describe.skipIf(dbUrl === "")("dashboard/servers page unhappy path", () => {
  it("refuses a url that is not http or https: 400, nothing stored", async () => {
    const result = await postForm({ url: "ftp://qemu.example.com" }, dbUrl, "/servers");
    expect(result.status).toBe(400);
    expect(await registeredUrls(dbUrl)).not.toContain("ftp://qemu.example.com");
  });

  it("refuses a form without a url the same way", async () => {
    const result = await postForm({ nope: "x" }, dbUrl, "/servers");
    expect(result.status).toBe(400);
  });

  it("answers 404 for deleting a url that was never registered", async () => {
    const result = await postForm({ url: "http://10.1.0.77:42069" }, dbUrl, "/servers/delete");
    expect(result.status).toBe(404);
  });
});

type QueuedJob = {
  // null for a result nobody has ticketed yet.
  readonly ticket: string | null;
  readonly action: (typeof DbSchema.automationJobs.$inferInsert)["action"];
  readonly status: (typeof DbSchema.automationJobs.$inferInsert)["status"];
  readonly reason?: string;
  readonly queuedSecondsAgo: number;
  readonly startedSecondsAgo?: number;
  readonly finishedSecondsAgo?: number;
};

// A stamp some seconds before the database's clock, the clock the page reads ages against.
const secondsAgo = (seconds: number) => sql`now() - make_interval(secs => ${seconds})`;

// One definition, and per job its own run and result carrying the ticket. The jobs already in the
// database go first: the integration files share one, and the queue this page expects is its own
// to arrange.
const seedQueue = async (
  db: NodePgDatabase,
  name: string,
  jobs: ReadonlyArray<QueuedJob>,
): Promise<void> => {
  await db.delete(DbSchema.automationJobs);
  const [definition] = await db
    .insert(DbSchema.testDefinitions)
    .values({ name, description: "d", instruction: "i", proof: "p" })
    .returning({ id: DbSchema.testDefinitions.id });
  const runs = await db
    .insert(DbSchema.testRuns)
    .values(
      jobs.map((_, index) => ({
        name: `${name} ${String(index)}`,
        iso: "https://example.com/omarchy.iso",
        serverUrl: "http://127.0.0.1:42069",
      })),
    )
    .returning({ id: DbSchema.testRuns.id });
  const results = await db
    .insert(DbSchema.testResults)
    .values(
      jobs.map((job, index) => ({
        runId: runs[index].id,
        definitionId: definition.id,
        linearId: job.ticket,
      })),
    )
    .returning({ id: DbSchema.testResults.id });
  await db.insert(DbSchema.automationJobs).values(
    jobs.map((job, index) => ({
      resultId: results[index].id,
      action: job.action,
      status: job.status,
      reason: job.reason,
      createdAt: secondsAgo(job.queuedSecondsAgo),
      startedAt: job.startedSecondsAgo === undefined ? null : secondsAgo(job.startedSecondsAgo),
      finishedAt: job.finishedSecondsAgo === undefined ? null : secondsAgo(job.finishedSecondsAgo),
    })),
  );
};

// Two running, the diagnose queued after the drive; four pending, a diagnose between two drives
// and one nobody has ticketed; six finished, one of each closing status, in another order than
// they were queued.
const QUEUE_JOBS: ReadonlyArray<QueuedJob> = [
  {
    ticket: "QUE-101",
    action: "drive",
    status: "running",
    queuedSecondsAgo: 300,
    startedSecondsAgo: 200,
  },
  {
    ticket: "QUE-102",
    action: "diagnose",
    status: "running",
    queuedSecondsAgo: 100,
    startedSecondsAgo: 50,
  },
  { ticket: "QUE-103", action: "drive", status: "pending", queuedSecondsAgo: 90 },
  { ticket: "QUE-104", action: "diagnose", status: "pending", queuedSecondsAgo: 30 },
  { ticket: "QUE-105", action: "drive", status: "pending", queuedSecondsAgo: 10 },
  { ticket: null, action: "drive", status: "pending", queuedSecondsAgo: 5 },
  {
    ticket: "QUE-106",
    action: "drive",
    status: "succeeded",
    queuedSecondsAgo: 3_000,
    startedSecondsAgo: 2_900,
    finishedSecondsAgo: 600,
  },
  {
    ticket: "QUE-107",
    action: "drive",
    status: "failed",
    reason: "session timed out",
    queuedSecondsAgo: 2_000,
    startedSecondsAgo: 1_900,
    finishedSecondsAgo: 60,
  },
  {
    ticket: "QUE-108",
    action: "diagnose",
    status: "aborted",
    reason: "run stopped",
    queuedSecondsAgo: 1_000,
    startedSecondsAgo: 900,
    finishedSecondsAgo: 300,
  },
  {
    ticket: "QUE-109",
    action: "drive",
    status: "timed_out",
    reason: "no report",
    queuedSecondsAgo: 4_000,
    startedSecondsAgo: 3_900,
    finishedSecondsAgo: 1_200,
  },
  {
    ticket: "QUE-110",
    action: "drive",
    status: "completed",
    queuedSecondsAgo: 5_000,
    startedSecondsAgo: 4_900,
    finishedSecondsAgo: 1_500,
  },
  {
    ticket: "QUE-111",
    action: "drive",
    status: "errored",
    reason: "qemu exited 137",
    queuedSecondsAgo: 6_000,
    startedSecondsAgo: 5_900,
    finishedSecondsAgo: 1_800,
  },
];

describe.skipIf(dbUrl === "")("dashboard/servers page: the automation half happy path", () => {
  it("orders running and pending diagnoses ahead of drives and then in queue order, completed newest finished first, and ends the connection", async () => {
    await seed(dbUrl, (db) => seedQueue(db, "queue-order", QUEUE_JOBS));
    const result = await runQuery(
      `
const queue = await query.listAutomationQueue(url);
console.log(queue.running.map((job) => job.ticket).join(" "));
console.log(queue.pending.map((job) => String(job.ticket)).join(" "));
console.log(queue.completed.map((job) => job.ticket + ":" + job.status).join(" "));
const failed = queue.completed[0];
const waiting = queue.pending[0];
console.log([failed.test, failed.action, failed.reason, failed.createdAt instanceof Date, failed.startedAt instanceof Date, failed.finishedAt instanceof Date, failed.queriedAt instanceof Date, String(waiting.reason), String(waiting.startedAt), String(waiting.finishedAt), String(queue.running[0].finishedAt)].join(" "));
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(lines(result.stdout)).toEqual([
      "QUE-102 QUE-101",
      "QUE-104 QUE-103 QUE-105 null",
      "QUE-107:failed QUE-108:aborted QUE-106:succeeded QUE-109:timed_out QUE-110:completed QUE-111:errored",
      "queue-order drive session timed out true true true true null null null null",
    ]);
  });

  it("cuts each list at fifty: the fifty that finished last, the fifty at the front of the queue", async () => {
    const completed: ReadonlyArray<QueuedJob> = Array.from({ length: 55 }, (_, index) => ({
      ticket: `QUE-C-${String(index)}`,
      action: "drive",
      status: "succeeded",
      queuedSecondsAgo: 10_000,
      startedSecondsAgo: 9_000,
      finishedSecondsAgo: index * 60,
    }));
    const pending: ReadonlyArray<QueuedJob> = Array.from({ length: 52 }, (_, index) => ({
      ticket: `QUE-P-${String(index)}`,
      action: "drive",
      status: "pending",
      queuedSecondsAgo: index,
    }));
    await seed(dbUrl, (db) => seedQueue(db, "queue-cap", [...completed, ...pending]));
    const result = await runQuery(
      `
const queue = await query.listAutomationQueue(url);
console.log([queue.completed.length, queue.completed[0].ticket, queue.completed[49].ticket].join(" "));
console.log([queue.pending.length, queue.pending[0].ticket, queue.pending[49].ticket].join(" "));
console.log(queue.running.length);
console.log([queue.runningCount, queue.pendingCount].join(" "));
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(lines(result.stdout)).toEqual([
      "50 QUE-C-0 QUE-C-49",
      "50 QUE-P-51 QUE-P-2",
      "0",
      "0 52",
    ]);
  });

  it("lists the three newest suites, newest first, each with how many passed and failed and completed once every result has run", async () => {
    const inserted = await seed(dbUrl, async (db) => {
      const definitions = await db
        .insert(DbSchema.testDefinitions)
        .values([
          { name: "suite-latest-a", description: "d", instruction: "i", proof: "p" },
          { name: "suite-latest-b", description: "d", instruction: "i", proof: "p" },
          { name: "suite-latest-c", description: "d", instruction: "i", proof: "p" },
        ])
        .returning({ id: DbSchema.testDefinitions.id });
      const [first, second, third] = definitions;
      if (first === undefined || second === undefined || third === undefined) {
        throw new Error("suite-latest definitions were not inserted");
      }
      const run = (name: string, startsIn: number, status: "pending" | "running") => ({
        name,
        iso: "https://example.com/omarchy.iso",
        serverUrl: "http://127.0.0.1:42069",
        status,
        startedAt: secondsAgo(-startsIn),
      });
      // Started ahead of every run the other tests left, so these four are the newest and the
      // first of them is the one the three leave out.
      const runs = await db
        .insert(DbSchema.testRuns)
        .values([
          run("suite-latest-oldest", 60, "pending"),
          // The run row still says running. The results have all closed, so it is completed.
          run("suite-latest-done", 120, "running"),
          run("suite-latest-open", 180, "pending"),
          run("suite-latest-stopped", 240, "pending"),
        ])
        .returning({ id: DbSchema.testRuns.id, name: DbSchema.testRuns.name });
      const runId = (name: string): string => {
        const found = runs.find((row) => row.name === name);
        if (found === undefined) {
          throw new Error(`${name} was not inserted`);
        }
        return found.id;
      };
      await db.insert(DbSchema.testResults).values([
        { runId: runId("suite-latest-oldest"), definitionId: first.id, status: "passed" },
        { runId: runId("suite-latest-done"), definitionId: first.id, status: "passed" },
        { runId: runId("suite-latest-done"), definitionId: second.id, status: "passed" },
        { runId: runId("suite-latest-done"), definitionId: third.id, status: "failed" },
        { runId: runId("suite-latest-open"), definitionId: first.id, status: "passed" },
        { runId: runId("suite-latest-open"), definitionId: second.id, status: "failed" },
        { runId: runId("suite-latest-open"), definitionId: third.id, status: "running" },
        { runId: runId("suite-latest-stopped"), definitionId: first.id, status: "passed" },
        { runId: runId("suite-latest-stopped"), definitionId: second.id, status: "aborted" },
      ]);
      return {
        runIds: runs.map((row) => row.id),
        definitionIds: definitions.map((row) => row.id),
      };
    });
    try {
      const result = await runQuery(
        `
const queue = await query.listAutomationQueue(url);
for (const suite of queue.suites) {
  console.log([suite.name, suite.status, suite.passed, suite.failed, suite.startedAt instanceof Date, suite.queriedAt instanceof Date].join(" "));
}
`,
        dbUrl,
      );
      expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(lines(result.stdout)).toEqual([
        "suite-latest-stopped aborted 1 0 true true",
        "suite-latest-open running 1 1 true true",
        "suite-latest-done completed 2 1 true true",
      ]);
    } finally {
      await seed(dbUrl, async (db) => {
        await db
          .delete(DbSchema.testResults)
          .where(inArray(DbSchema.testResults.runId, inserted.runIds));
        await db.delete(DbSchema.testRuns).where(inArray(DbSchema.testRuns.id, inserted.runIds));
        await db
          .delete(DbSchema.testDefinitions)
          .where(inArray(DbSchema.testDefinitions.id, inserted.definitionIds));
      });
    }
  });
});

type SuiteReach = { readonly automationUrl: string; readonly linearUrl: string };

// Both refuse unless a test stands them up.
const UNREACHABLE: SuiteReach = {
  automationUrl: "http://127.0.0.1:1",
  linearUrl: "http://127.0.0.1:1",
};

const abortSuiteBindings = (databaseUrl: string, reach: SuiteReach) => ({
  HYPERDRIVE: { connectionString: databaseUrl },
  OLIGARCHY_TOKEN: "t",
  AUTOMATION_SERVER_URL: reach.automationUrl,
  LINEAR_API_URL: `${reach.linearUrl}/graphql`,
  LINEAR_API_TOKEN: "lin",
  LINEAR_TEAM: "Local Board",
});

const postAbortSuite = async (
  databaseUrl: string,
  run: string,
  reach: SuiteReach = UNREACHABLE,
): Promise<number> => {
  const response = await app.request(
    "/suites/abort",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "hx-request": "true",
      },
      body: new URLSearchParams({ run }).toString(),
    },
    abortSuiteBindings(databaseUrl, reach),
  );
  return response.status;
};

const graphqlOf = (received: StubProxy.Received) => {
  const body = received.body;
  const query =
    typeof body === "object" && body !== null && "query" in body && typeof body.query === "string"
      ? body.query
      : "";
  const variables =
    typeof body === "object" && body !== null && "variables" in body ? body.variables : undefined;
  const id =
    typeof variables === "object" && variables !== null && "id" in variables
      ? String(variables.id)
      : "";
  return { query, id };
};

// Linear as moveToAborted meets it: the ticket's team has an Aborted state, and the update takes.
const linearAborting: StubProxy.Script = (received) =>
  graphqlOf(received).query.includes("issueUpdate")
    ? StubProxy.json(200, { data: { issueUpdate: { success: true } } })
    : StubProxy.json(200, {
        data: { issue: { team: { states: { nodes: [{ id: "state-aborted" }] } } } },
      });

// The tickets Linear was asked to move, in order.
const movedTickets = (linear: StubProxy.StubProxy): ReadonlyArray<string> =>
  linear.requests.flatMap((received) => {
    const { query, id } = graphqlOf(received);
    return query.includes("issueUpdate") ? [id] : [];
  });

// One open suite: a drive running on one result and a drive waiting on another, each result
// carrying its ticket.
const seedOpenSuite = (name: string, running: string, pending: string) =>
  seed(dbUrl, async (db) => {
    const [first] = await db
      .insert(DbSchema.testDefinitions)
      .values({ name: `${name}-run`, description: "d", instruction: "i", proof: "p" })
      .returning({ id: DbSchema.testDefinitions.id });
    const [second] = await db
      .insert(DbSchema.testDefinitions)
      .values({ name: `${name}-pen`, description: "d", instruction: "i", proof: "p" })
      .returning({ id: DbSchema.testDefinitions.id });
    const [run] = await db
      .insert(DbSchema.testRuns)
      .values({
        name,
        iso: "https://example.com/omarchy.iso",
        serverUrl: "http://127.0.0.1:42069",
        status: "pending",
      })
      .returning({ id: DbSchema.testRuns.id });
    const [runningResult] = await db
      .insert(DbSchema.testResults)
      .values({ runId: run.id, definitionId: first.id, status: "running", linearId: running })
      .returning({ id: DbSchema.testResults.id });
    const [pendingResult] = await db
      .insert(DbSchema.testResults)
      .values({ runId: run.id, definitionId: second.id, status: "pending", linearId: pending })
      .returning({ id: DbSchema.testResults.id });
    await db.insert(DbSchema.automationJobs).values([
      { resultId: runningResult.id, action: "drive", status: "running" },
      { resultId: pendingResult.id, action: "drive", status: "pending" },
    ]);
    return {
      runId: run.id,
      definitionIds: [first.id, second.id],
      resultIds: [runningResult.id, pendingResult.id],
    };
  });

const dropSuite = (inserted: Awaited<ReturnType<typeof seedOpenSuite>>) =>
  seed(dbUrl, async (db) => {
    await db
      .delete(DbSchema.automationJobs)
      .where(inArray(DbSchema.automationJobs.resultId, inserted.resultIds));
    await db.delete(DbSchema.testResults).where(eq(DbSchema.testResults.runId, inserted.runId));
    await db.delete(DbSchema.testRuns).where(eq(DbSchema.testRuns.id, inserted.runId));
    await db
      .delete(DbSchema.testDefinitions)
      .where(inArray(DbSchema.testDefinitions.id, inserted.definitionIds));
  });

// Aborting is the operator's way off a suite whose results never reached a verdict. The
// automation server and Linear are down here: a running job still aborts in the database,
// and the ticket stays on the board.
describe.skipIf(dbUrl === "")("dashboard abort a test suite", () => {
  it("aborts the results still open and their jobs, and leaves a result that already passed", async () => {
    const inserted = await seed(dbUrl, async (db) => {
      const [definition] = await db
        .insert(DbSchema.testDefinitions)
        .values({ name: "suite-close", description: "d", instruction: "i", proof: "p" })
        .returning({ id: DbSchema.testDefinitions.id });
      const [run] = await db
        .insert(DbSchema.testRuns)
        .values({
          name: "suite-close",
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          status: "pending",
        })
        .returning({ id: DbSchema.testRuns.id });
      const [second] = await db
        .insert(DbSchema.testDefinitions)
        .values({ name: "suite-close-b", description: "d", instruction: "i", proof: "p" })
        .returning({ id: DbSchema.testDefinitions.id });
      const [third] = await db
        .insert(DbSchema.testDefinitions)
        .values({ name: "suite-close-c", description: "d", instruction: "i", proof: "p" })
        .returning({ id: DbSchema.testDefinitions.id });
      const results = await db
        .insert(DbSchema.testResults)
        .values([
          {
            runId: run.id,
            definitionId: definition.id,
            status: "running",
            linearId: "CLS-RUN",
          },
          {
            runId: run.id,
            definitionId: second.id,
            status: "pending",
            linearId: "CLS-PEN",
          },
          { runId: run.id, definitionId: third.id, status: "passed", linearId: "CLS-OK" },
        ])
        .returning({ id: DbSchema.testResults.id, status: DbSchema.testResults.status });
      const runningResult = results.find((row) => row.status === "running");
      const pendingResult = results.find((row) => row.status === "pending");
      const passedResult = results.find((row) => row.status === "passed");
      if (
        runningResult === undefined ||
        pendingResult === undefined ||
        passedResult === undefined
      ) {
        throw new Error("suite-close results were not inserted");
      }
      await db.insert(DbSchema.automationJobs).values([
        { resultId: runningResult.id, action: "drive", status: "running" },
        { resultId: pendingResult.id, action: "drive", status: "pending" },
        { resultId: passedResult.id, action: "diagnose", status: "pending" },
      ]);
      return {
        runId: run.id,
        definitionIds: [definition.id, second.id, third.id],
        resultIds: results.map((row) => row.id),
        passedId: passedResult.id,
      };
    });
    try {
      expect(await postAbortSuite(dbUrl, inserted.runId)).toBe(200);
      const stored = await seed(dbUrl, async (db) => {
        const [run] = await db
          .select()
          .from(DbSchema.testRuns)
          .where(eq(DbSchema.testRuns.id, inserted.runId));
        const results = await db
          .select({
            id: DbSchema.testResults.id,
            status: DbSchema.testResults.status,
            reason: DbSchema.testResults.reason,
            finishedAt: DbSchema.testResults.finishedAt,
          })
          .from(DbSchema.testResults)
          .where(eq(DbSchema.testResults.runId, inserted.runId));
        const jobs = await db
          .select({
            resultId: DbSchema.automationJobs.resultId,
            status: DbSchema.automationJobs.status,
            reason: DbSchema.automationJobs.reason,
            finishedAt: DbSchema.automationJobs.finishedAt,
          })
          .from(DbSchema.automationJobs)
          .where(inArray(DbSchema.automationJobs.resultId, inserted.resultIds));
        return { run, results, jobs };
      });
      expect(stored.run?.status).toBe("aborted");
      expect(stored.run?.reason).toBe("aborted");
      expect(stored.run?.endedAt).toBeInstanceOf(Date);
      const byId = new Map(stored.results.map((row) => [row.id, row]));
      const passed = byId.get(inserted.passedId);
      expect(passed?.status).toBe("passed");
      expect(passed?.finishedAt).toBeNull();
      for (const result of stored.results) {
        if (result.id === inserted.passedId) {
          continue;
        }
        expect(result.status).toBe("aborted");
        expect(result.reason).toBe("aborted");
        expect(result.finishedAt).toBeInstanceOf(Date);
      }
      const passedJob = stored.jobs.find((job) => job.resultId === inserted.passedId);
      expect(passedJob?.status).toBe("pending");
      expect(passedJob?.finishedAt).toBeNull();
      for (const job of stored.jobs) {
        if (job.resultId === inserted.passedId) {
          continue;
        }
        expect(job.status).toBe("aborted");
        expect(job.reason).toBe("aborted");
        expect(job.finishedAt).toBeInstanceOf(Date);
      }
    } finally {
      await seed(dbUrl, async (db) => {
        await db
          .delete(DbSchema.automationJobs)
          .where(inArray(DbSchema.automationJobs.resultId, inserted.resultIds));
        await db.delete(DbSchema.testResults).where(eq(DbSchema.testResults.runId, inserted.runId));
        await db.delete(DbSchema.testRuns).where(eq(DbSchema.testRuns.id, inserted.runId));
        await db
          .delete(DbSchema.testDefinitions)
          .where(inArray(DbSchema.testDefinitions.id, inserted.definitionIds));
      });
    }
  });

  it("leaves a suite whose results have all closed", async () => {
    const inserted = await seed(dbUrl, async (db) => {
      const [definition] = await db
        .insert(DbSchema.testDefinitions)
        .values({ name: "suite-close-done", description: "d", instruction: "i", proof: "p" })
        .returning({ id: DbSchema.testDefinitions.id });
      const [run] = await db
        .insert(DbSchema.testRuns)
        .values({
          name: "suite-close-done",
          iso: "https://example.com/omarchy.iso",
          serverUrl: "http://127.0.0.1:42069",
          status: "pending",
        })
        .returning({ id: DbSchema.testRuns.id });
      const [result] = await db
        .insert(DbSchema.testResults)
        .values({ runId: run.id, definitionId: definition.id, status: "passed" })
        .returning({ id: DbSchema.testResults.id });
      return { runId: run.id, definitionId: definition.id, resultId: result.id };
    });
    try {
      expect(await postAbortSuite(dbUrl, inserted.runId)).toBe(200);
      const stored = await seed(dbUrl, async (db) => {
        const [run] = await db
          .select()
          .from(DbSchema.testRuns)
          .where(eq(DbSchema.testRuns.id, inserted.runId));
        const [result] = await db
          .select({ status: DbSchema.testResults.status })
          .from(DbSchema.testResults)
          .where(eq(DbSchema.testResults.id, inserted.resultId));
        return { run, result };
      });
      expect(stored.run?.status).toBe("pending");
      expect(stored.run?.endedAt).toBeNull();
      expect(stored.result?.status).toBe("passed");
    } finally {
      await seed(dbUrl, async (db) => {
        await db.delete(DbSchema.testResults).where(eq(DbSchema.testResults.runId, inserted.runId));
        await db.delete(DbSchema.testRuns).where(eq(DbSchema.testRuns.id, inserted.runId));
        await db
          .delete(DbSchema.testDefinitions)
          .where(eq(DbSchema.testDefinitions.id, inserted.definitionId));
      });
    }
  });

  it("moves the ticket of a job it aborted itself, and leaves a ticket the automation server already moved when it aborted the job", async () => {
    const automation = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(linearAborting);
    const inserted = await seedOpenSuite("suite-moved", "SMV-RUN", "SMV-PEN");
    try {
      expect(
        await postAbortSuite(dbUrl, inserted.runId, {
          automationUrl: automation.url,
          linearUrl: linear.url,
        }),
      ).toBe(200);
      expect(automation.requests).toContainEqual(
        expect.objectContaining({ url: "/abort", body: { ticket: "SMV-RUN", action: "drive" } }),
      );
      expect(movedTickets(linear)).toEqual(["SMV-PEN"]);
    } finally {
      await dropSuite(inserted);
      await automation.close();
      await linear.close();
    }
  });

  it("moves a running job's ticket too when the automation server did not abort it", async () => {
    const automation = await StubProxy.startStubProxy(() =>
      StubProxy.refusal(500, "internal error"),
    );
    const linear = await StubProxy.startStubProxy(linearAborting);
    const inserted = await seedOpenSuite("suite-unmoved", "SUM-RUN", "SUM-PEN");
    try {
      expect(
        await postAbortSuite(dbUrl, inserted.runId, {
          automationUrl: automation.url,
          linearUrl: linear.url,
        }),
      ).toBe(200);
      expect(automation.requests.length).toBeGreaterThan(0);
      expect([...movedTickets(linear)].sort()).toEqual(["SUM-PEN", "SUM-RUN"]);
    } finally {
      await dropSuite(inserted);
      await automation.close();
      await linear.close();
    }
  });
});

describe.skipIf(dbUrl === "")("dashboard ticket follow", () => {
  it("answers 404 for the page and its feed when no result carries the ticket", async () => {
    const page = await getPage("/tickets/FOL-NONE", dbUrl);
    const feed = await getPage("/tickets/FOL-NONE/feed", dbUrl);
    expect(page.status).toBe(404);
    expect(feed.status).toBe(404);
  });
});

describe("dashboard/servers page unhappy path: unreachable database", () => {
  it("answers 500 for the page and each fragment, never echoing the password", async () => {
    for (const path of ["/servers", "/servers/process", "/servers/fleet", "/servers/queue"]) {
      const { status, html } = await getPage(path, REFUSED_URL);
      expect(status, path).toBe(500);
      expect(html, path).not.toContain(SENTINEL_PASSWORD);
    }
  });

  it("listAutomationQueue surfaces a refused connection and exits without echoing the password", async () => {
    const result = await runQuery(
      "try {\n  await query.listAutomationQueue(url);\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toContain(SENTINEL_PASSWORD);
  });

  it("adding and deleting answer 500 the same way", async () => {
    const added = await postForm({ url: "http://10.1.0.5:42069" }, REFUSED_URL, "/servers");
    expect(added.status).toBe(500);
    expect(added.text).not.toContain(SENTINEL_PASSWORD);
    const deleted = await postForm(
      { url: "http://10.1.0.5:42069" },
      REFUSED_URL,
      "/servers/delete",
    );
    expect(deleted.status).toBe(500);
    expect(deleted.text).not.toContain(SENTINEL_PASSWORD);
  });
});

const TOKEN = "test-token";
const LINEAR_TOKEN = "lin_api_test";
// Every url an abort may reach when the test does not stand one up: each refuses.
const REFUSED_HTTP = "http://127.0.0.1:1";

type AbortEnv = {
  readonly databaseUrl: string;
  readonly automationUrl: string;
  readonly linearUrl: string;
};

const abortBindings = (env: AbortEnv) => ({
  HYPERDRIVE: { connectionString: env.databaseUrl },
  OLIGARCHY_TOKEN: TOKEN,
  AUTOMATION_SERVER_URL: env.automationUrl,
  LINEAR_API_URL: `${env.linearUrl}/graphql`,
  LINEAR_API_TOKEN: LINEAR_TOKEN,
  LINEAR_TEAM: "Local Board",
});

// The body names the row the way the page's form does: the ticket and the row's action.
const postAbort = async (
  ticket: string,
  env: AbortEnv,
  action: QueuedJob["action"] = "drive",
): Promise<{ readonly status: number; readonly body: unknown }> => {
  const response = await app.request(
    "/abort",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket, action }),
    },
    abortBindings(env),
  );
  return { status: response.status, body: await response.json() };
};

// The one request the dashboard's abort makes: to the automation server, with the bearer.
const forwarded = (ticket: string, action: QueuedJob["action"] = "drive") => ({
  method: "POST",
  url: "/abort",
  authorization: `Bearer ${TOKEN}`,
  body: { ticket, action },
});

const jobByTicket = async (
  databaseUrl: string,
  ticket: string,
  action: QueuedJob["action"] = "drive",
): Promise<{
  readonly status: string;
  readonly reason: string | null;
  readonly finishedAt: Date | null;
}> => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const [row] = await drizzle(client)
      .select({
        status: DbSchema.automationJobs.status,
        reason: DbSchema.automationJobs.reason,
        finishedAt: DbSchema.automationJobs.finishedAt,
      })
      .from(DbSchema.automationJobs)
      .innerJoin(
        DbSchema.testResults,
        eq(DbSchema.testResults.id, DbSchema.automationJobs.resultId),
      )
      .where(
        and(eq(DbSchema.testResults.linearId, ticket), eq(DbSchema.automationJobs.action, action)),
      );
    if (row === undefined) {
      throw new Error(`no ${action} job for ${ticket}`);
    }
    return row;
  } finally {
    await client.end();
  }
};

// One ticket with both of its jobs: the drive running, the diagnose queued behind it, the state a
// ticket is in between the driver moving it to Needs Review and the drive closing. seedQueue gives
// every job its own result, so this pair is seeded onto one.
const seedSiblings = async (db: NodePgDatabase, name: string, ticket: string): Promise<void> => {
  await db.delete(DbSchema.automationJobs);
  const [definition] = await db
    .insert(DbSchema.testDefinitions)
    .values({ name, description: "d", instruction: "i", proof: "p" })
    .returning({ id: DbSchema.testDefinitions.id });
  const [run] = await db
    .insert(DbSchema.testRuns)
    .values({ name, iso: "https://example.com/omarchy.iso", serverUrl: "http://127.0.0.1:42069" })
    .returning({ id: DbSchema.testRuns.id });
  const [result] = await db
    .insert(DbSchema.testResults)
    .values({ runId: run.id, definitionId: definition.id, linearId: ticket })
    .returning({ id: DbSchema.testResults.id });
  await db.insert(DbSchema.automationJobs).values([
    {
      resultId: result.id,
      action: "drive",
      status: "running",
      createdAt: secondsAgo(300),
      startedAt: secondsAgo(200),
    },
    { resultId: result.id, action: "diagnose", status: "pending", createdAt: secondsAgo(20) },
  ]);
};

const runningJob = (ticket: string): QueuedJob => ({
  ticket,
  action: "drive",
  status: "running",
  queuedSecondsAgo: 10,
  startedSecondsAgo: 5,
});

const pendingJob = (ticket: string): QueuedJob => ({
  ticket,
  action: "drive",
  status: "pending",
  queuedSecondsAgo: 10,
});

const finishedJob = (ticket: string): QueuedJob => ({
  ticket,
  action: "drive",
  status: "succeeded",
  queuedSecondsAgo: 30,
  startedSecondsAgo: 20,
  finishedSecondsAgo: 5,
});

describe("dashboard POST /abort happy path: the outbound calls", () => {
  it("posts a form ticket the same way the servers page abort button does", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(() => StubProxy.OK);
    try {
      const response = await app.request(
        "/abort",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ ticket: "ABT-FORM", action: "drive" }).toString(),
        },
        abortBindings({
          databaseUrl: REFUSED_URL,
          automationUrl: proxy.url,
          linearUrl: linear.url,
        }),
      );
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/servers");
      expect(proxy.requests).toEqual([forwarded("ABT-FORM")]);
      expect(linear.requests).toEqual([]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("posts a definitions-page abort the same way, and returns to that definition", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(() => StubProxy.OK);
    try {
      const response = await app.request(
        "/abort",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            ticket: "ABT-FORM-DEF",
            action: "drive",
            view: "definitions",
            definition: "lock-screen",
          }).toString(),
        },
        abortBindings({
          databaseUrl: REFUSED_URL,
          automationUrl: proxy.url,
          linearUrl: linear.url,
        }),
      );
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/definitions/lock-screen");
      expect(proxy.requests).toEqual([forwarded("ABT-FORM-DEF")]);
      expect(linear.requests).toEqual([]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("forwards the ticket and action with the bearer, answers 200, and asks Linear nothing", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(() => StubProxy.OK);
    try {
      const response = await postAbort(
        "ABT-200",
        { databaseUrl: REFUSED_URL, automationUrl: proxy.url, linearUrl: linear.url },
        "diagnose",
      );
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect(proxy.requests).toEqual([forwarded("ABT-200", "diagnose")]);
      expect(linear.requests).toEqual([]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });
});

describe.skipIf(dbUrl === "")("dashboard POST /abort happy path", () => {
  it("forwards a running drive and the pending diagnose behind it, and writes no row", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(() => StubProxy.OK);
    try {
      await seed(dbUrl, (db) => seedSiblings(db, "abort-forward", "ABT-FWD"));
      const env = { databaseUrl: dbUrl, automationUrl: proxy.url, linearUrl: linear.url };
      expect((await postAbort("ABT-FWD", env, "diagnose")).status).toBe(200);
      expect((await postAbort("ABT-FWD", env, "drive")).status).toBe(200);
      expect(proxy.requests).toEqual([
        forwarded("ABT-FWD", "diagnose"),
        forwarded("ABT-FWD", "drive"),
      ]);
      expect(await jobByTicket(dbUrl, "ABT-FWD", "diagnose")).toMatchObject({
        status: "pending",
        reason: null,
        finishedAt: null,
      });
      expect((await jobByTicket(dbUrl, "ABT-FWD", "drive")).status).toBe("running");
      expect(linear.requests).toEqual([]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });
});

describe("dashboard POST /abort unhappy path: always 200", () => {
  it("does nothing for a body whose action is missing or not one a job has", async () => {
    const proxy = await StubProxy.startStubProxy(() => StubProxy.OK);
    const linear = await StubProxy.startStubProxy(() => StubProxy.OK);
    try {
      for (const body of [{ ticket: "ABT-NOACT" }, { ticket: "ABT-NOACT", action: "reboot" }]) {
        const response = await app.request(
          "/abort",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
          abortBindings({
            databaseUrl: REFUSED_URL,
            automationUrl: proxy.url,
            linearUrl: linear.url,
          }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: "true" });
      }
      expect(proxy.requests).toEqual([]);
      expect(linear.requests).toEqual([]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("answers 200 when the automation server returns 400, asking Linear nothing", async () => {
    const proxy = await StubProxy.startStubProxy(() =>
      StubProxy.refusal(400, 'ticket "ABT-400" is not running'),
    );
    const linear = await StubProxy.startStubProxy(() => StubProxy.OK);
    try {
      const response = await postAbort("ABT-400", {
        databaseUrl: REFUSED_URL,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect(proxy.requests).toEqual([forwarded("ABT-400")]);
      expect(linear.requests).toEqual([]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("answers 200 without a redirect when the definitions page asks over htmx and names no job", async () => {
    const response = await app.request(
      "/abort",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "hx-request": "true",
        },
        body: new URLSearchParams({ view: "definitions", definition: "lock-screen" }).toString(),
      },
      abortBindings({
        databaseUrl: REFUSED_URL,
        automationUrl: REFUSED_HTTP,
        linearUrl: REFUSED_HTTP,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("answers 200 when the automation server is unreachable", async () => {
    const response = await postAbort("ABT-DOWN", {
      databaseUrl: REFUSED_URL,
      automationUrl: REFUSED_HTTP,
      linearUrl: REFUSED_HTTP,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: "true" });
  });

  it("answers 200 when the automation server accepts the request and never answers", async () => {
    const server = createHttpServer(() => {});
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("hanging abort server: no tcp address");
      }
      const response = await postAbort("ABT-HANG", {
        databaseUrl: REFUSED_URL,
        automationUrl: `http://127.0.0.1:${String(address.port)}`,
        linearUrl: REFUSED_HTTP,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});

describe.skipIf(dbUrl === "")("dashboard POST /abort unhappy path", () => {
  it("answers 200 and leaves a running job running, moving nothing, when the automation server returns 400, returns 500 or is unreachable", async () => {
    const refusing = await StubProxy.startStubProxy(() =>
      StubProxy.refusal(400, 'ticket "ABT-400" is not running'),
    );
    const failing = await StubProxy.startStubProxy(() =>
      StubProxy.refusal(500, "opencode exited 1"),
    );
    const linear = await StubProxy.startStubProxy(() => StubProxy.OK);
    try {
      await seed(dbUrl, (db) =>
        seedQueue(db, "abort-http-refused", [
          runningJob("ABT-400"),
          runningJob("ABT-500"),
          runningJob("ABT-DOWN"),
        ]),
      );
      for (const [ticket, automationUrl] of [
        ["ABT-400", refusing.url],
        ["ABT-500", failing.url],
        ["ABT-DOWN", REFUSED_HTTP],
      ] as const) {
        const response = await postAbort(ticket, {
          databaseUrl: dbUrl,
          automationUrl,
          linearUrl: linear.url,
        });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: "true" });
        expect(await jobByTicket(dbUrl, ticket)).toMatchObject({
          status: "running",
          reason: null,
          finishedAt: null,
        });
      }
      expect(linear.requests).toEqual([]);
    } finally {
      await refusing.close();
      await failing.close();
      await linear.close();
    }
  });

  it("answers 200, leaves a finished job finished and moves nothing when the automation server returns 400", async () => {
    const proxy = await StubProxy.startStubProxy(() =>
      StubProxy.refusal(400, 'ticket "ABT-DONE" is not running'),
    );
    const linear = await StubProxy.startStubProxy(() => StubProxy.OK);
    try {
      await seed(dbUrl, (db) => seedQueue(db, "abort-http-done", [finishedJob("ABT-DONE")]));
      const response = await postAbort("ABT-DONE", {
        databaseUrl: dbUrl,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect((await jobByTicket(dbUrl, "ABT-DONE")).status).toBe("succeeded");
      expect(linear.requests).toEqual([]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });

  it("answers 200 and moves nothing for a ticket no job carries", async () => {
    const proxy = await StubProxy.startStubProxy(() =>
      StubProxy.refusal(400, 'ticket "ABT-NOBODY" is not running'),
    );
    const linear = await StubProxy.startStubProxy(() => StubProxy.OK);
    try {
      await seed(dbUrl, (db) => seedQueue(db, "abort-http-nobody", [pendingJob("ABT-OTHER")]));
      const response = await postAbort("ABT-NOBODY", {
        databaseUrl: dbUrl,
        automationUrl: proxy.url,
        linearUrl: linear.url,
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: "true" });
      expect((await jobByTicket(dbUrl, "ABT-OTHER")).status).toBe("pending");
      expect(proxy.requests).toEqual([forwarded("ABT-NOBODY")]);
      expect(linear.requests).toEqual([]);
    } finally {
      await proxy.close();
      await linear.close();
    }
  });
});

// A stamp some days before the database's clock, the clock the sweep's cutoff is read from.
const daysAgo = (days: number) => sql`now() - make_interval(days => ${days})`;

const CRON = { cron: "0 4 * * *" };
const SWEEP =
  "const deleted = await query.deleteOldRows(url);\nconsole.log(JSON.stringify(deleted));";

// The ids the sweep is measured by afterwards: one session's tree, the run whose result it ran,
// and the tag naming the rows keyed by text.
type Aged = {
  readonly tag: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly imageActionId: number;
  readonly runId: string;
  readonly resultId: string;
};

// Everything the sweep reads an age off, `days` old: a session with its agent, two actions, the
// image of the last, its debug log, its diagnosis and its route; a run whose one result the
// session ran, with the job that drove it; a log line, a process reading and the agent's
// reservation. Beside them, of the same age, the configuration the sweep must leave: the
// definition the result pinned, the error type the diagnosis names, and a server.
const seedAged = async (db: NodePgDatabase, tag: string, days: number): Promise<Aged> => {
  const at = daysAgo(days);
  const sessionId = randomUUID();
  const agentId = `PRUNE-${tag}`;
  const url = `http://prune-${tag}:42069`;
  await db.insert(DbSchema.sessions).values({
    id: sessionId,
    config: { iso: "x" },
    status: "succeeded",
    startedAt: at,
    endedAt: at,
  });
  await db.insert(DbSchema.agentRuns).values({ agentId, sessionId, startedAt: at, endedAt: at });
  const [, last] = await db
    .insert(DbSchema.actions)
    .values([
      { sessionId, agentId, request: { name: "click" }, state: "completed", createdAt: at },
      { sessionId, agentId, request: { name: "screenshot" }, state: "completed", createdAt: at },
    ])
    .returning({ id: DbSchema.actions.id });
  await db.insert(DbSchema.images).values({ actionId: last.id, data: Buffer.from("png") });
  await db.insert(DbSchema.debugLogs).values({
    sessionId,
    sources: { serial: "", proxy: "", qemu: "", actions: "" },
    createdAt: at,
  });
  await db
    .insert(DbSchema.postRunErrorTypes)
    .values({ key: `prune-${tag}`, description: "d", createdAt: at });
  await db.insert(DbSchema.postRunDiagnosis).values({
    sessionId,
    verdict: "failed",
    errorType: `prune-${tag}`,
    summary: "s",
    model: "m",
    createdAt: at,
  });
  await db.insert(DbSchema.sessionServers).values({ sessionId, serverUrl: url, createdAt: at });
  const [definition] = await db
    .insert(DbSchema.testDefinitions)
    .values({ name: `prune-${tag}`, description: "d", instruction: "i", proof: "p", createdAt: at })
    .returning({ id: DbSchema.testDefinitions.id });
  const [run] = await db
    .insert(DbSchema.testRuns)
    .values({
      name: `prune ${tag}`,
      iso: "https://example.com/omarchy.iso",
      serverUrl: url,
      status: "passed",
      startedAt: at,
      endedAt: at,
    })
    .returning({ id: DbSchema.testRuns.id });
  const [result] = await db
    .insert(DbSchema.testResults)
    .values({
      runId: run.id,
      definitionId: definition.id,
      sessionId,
      model: "m",
      linearId: agentId,
      status: "passed",
      createdAt: at,
      finishedAt: at,
    })
    .returning({ id: DbSchema.testResults.id });
  await db.insert(DbSchema.automationJobs).values({
    resultId: result.id,
    action: "drive",
    status: "succeeded",
    createdAt: at,
    startedAt: at,
    finishedAt: at,
  });
  await db
    .insert(DbSchema.logs)
    .values({ location: sessionId, agentId, text: "line", createdAt: at });
  await db.insert(DbSchema.processStats).values({
    name: `prune-${tag}`,
    type: "qemu",
    jobs: 0,
    memoryBytes: 0,
    cpuPercent: 0,
    reportedAt: at,
  });
  await db.insert(DbSchema.agentServers).values({ agentId, serverUrl: url, createdAt: at });
  await db.insert(DbSchema.servers).values({ url, createdAt: at });
  return { tag, sessionId, agentId, imageActionId: last.id, runId: run.id, resultId: result.id };
};

type AgedRows = {
  readonly sessions: number;
  readonly agentRuns: number;
  readonly actions: number;
  readonly images: number;
  readonly debugLogs: number;
  readonly postRunDiagnosis: number;
  readonly sessionServers: number;
  readonly testRuns: number;
  readonly testResults: number;
  readonly automationJobs: number;
  readonly logs: number;
  readonly processStats: number;
  readonly agentServers: number;
  readonly testDefinitions: number;
  readonly postRunErrorTypes: number;
  readonly servers: number;
};

// What is left of one seedAged, table by table.
const remaining = async (db: NodePgDatabase, aged: Aged): Promise<AgedRows> => ({
  sessions: await db.$count(DbSchema.sessions, eq(DbSchema.sessions.id, aged.sessionId)),
  agentRuns: await db.$count(DbSchema.agentRuns, eq(DbSchema.agentRuns.agentId, aged.agentId)),
  actions: await db.$count(DbSchema.actions, eq(DbSchema.actions.sessionId, aged.sessionId)),
  images: await db.$count(DbSchema.images, eq(DbSchema.images.actionId, aged.imageActionId)),
  debugLogs: await db.$count(DbSchema.debugLogs, eq(DbSchema.debugLogs.sessionId, aged.sessionId)),
  postRunDiagnosis: await db.$count(
    DbSchema.postRunDiagnosis,
    eq(DbSchema.postRunDiagnosis.sessionId, aged.sessionId),
  ),
  sessionServers: await db.$count(
    DbSchema.sessionServers,
    eq(DbSchema.sessionServers.sessionId, aged.sessionId),
  ),
  testRuns: await db.$count(DbSchema.testRuns, eq(DbSchema.testRuns.id, aged.runId)),
  testResults: await db.$count(DbSchema.testResults, eq(DbSchema.testResults.runId, aged.runId)),
  automationJobs: await db.$count(
    DbSchema.automationJobs,
    eq(DbSchema.automationJobs.resultId, aged.resultId),
  ),
  logs: await db.$count(DbSchema.logs, eq(DbSchema.logs.agentId, aged.agentId)),
  processStats: await db.$count(
    DbSchema.processStats,
    eq(DbSchema.processStats.name, `prune-${aged.tag}`),
  ),
  agentServers: await db.$count(
    DbSchema.agentServers,
    eq(DbSchema.agentServers.agentId, aged.agentId),
  ),
  testDefinitions: await db.$count(
    DbSchema.testDefinitions,
    eq(DbSchema.testDefinitions.name, `prune-${aged.tag}`),
  ),
  postRunErrorTypes: await db.$count(
    DbSchema.postRunErrorTypes,
    eq(DbSchema.postRunErrorTypes.key, `prune-${aged.tag}`),
  ),
  servers: await db.$count(
    DbSchema.servers,
    eq(DbSchema.servers.url, `http://prune-${aged.tag}:42069`),
  ),
});

const SEEDED: AgedRows = {
  sessions: 1,
  agentRuns: 1,
  actions: 2,
  images: 1,
  debugLogs: 1,
  postRunDiagnosis: 1,
  sessionServers: 1,
  testRuns: 1,
  testResults: 1,
  automationJobs: 1,
  logs: 1,
  processStats: 1,
  agentServers: 1,
  testDefinitions: 1,
  postRunErrorTypes: 1,
  servers: 1,
};

// Swept: every row with an age gone, the configuration as it was.
const SWEPT: AgedRows = {
  ...SEEDED,
  sessions: 0,
  agentRuns: 0,
  actions: 0,
  images: 0,
  debugLogs: 0,
  postRunDiagnosis: 0,
  sessionServers: 0,
  testRuns: 0,
  testResults: 0,
  automationJobs: 0,
  logs: 0,
  processStats: 0,
  agentServers: 0,
};

// A run that started `runDays` ago with one result attributed to a plain session started
// `sessionDays` ago; the ids the sweep is measured by afterwards.
const seedLinked = async (
  db: NodePgDatabase,
  tag: string,
  runDays: number,
  sessionDays: number,
): Promise<{ readonly sessionId: string; readonly runId: string; readonly resultId: string }> => {
  const sessionId = randomUUID();
  await db.insert(DbSchema.sessions).values({
    id: sessionId,
    config: { iso: "x" },
    status: "succeeded",
    startedAt: daysAgo(sessionDays),
  });
  const [definition] = await db
    .insert(DbSchema.testDefinitions)
    .values({ name: `prune-${tag}`, description: "d", instruction: "i", proof: "p" })
    .returning({ id: DbSchema.testDefinitions.id });
  const [run] = await db
    .insert(DbSchema.testRuns)
    .values({
      name: `prune ${tag}`,
      iso: "https://example.com/omarchy.iso",
      serverUrl: "http://127.0.0.1:42069",
      startedAt: daysAgo(runDays),
    })
    .returning({ id: DbSchema.testRuns.id });
  const [result] = await db
    .insert(DbSchema.testResults)
    .values({
      runId: run.id,
      definitionId: definition.id,
      sessionId,
      status: "passed",
      model: "m",
      linearId: `PRUNE-${tag}`,
    })
    .returning({ id: DbSchema.testResults.id });
  await db
    .insert(DbSchema.automationJobs)
    .values({ resultId: result.id, action: "drive", status: "succeeded" });
  return { sessionId, runId: run.id, resultId: result.id };
};

// The first test sweeps a database with no other row past the cutoff, so its counts are exact;
// the ones after it match on the rows they seeded.
describe.skipIf(dbUrl === "")("dashboard/query deleteOldRows happy path", () => {
  it("deletes every row older than seven days with what hangs off it, keeps younger rows and the configuration, counts what went, and ends the connection", async () => {
    const { old, kept } = await seed(dbUrl, async (db) => ({
      old: await seedAged(db, "old", 8),
      kept: await seedAged(db, "kept", 6),
    }));
    const result = await runQuery(SWEEP, dbUrl);
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      automationJobs: 1,
      testResults: 1,
      testRuns: 1,
      images: 1,
      actions: 2,
      agentRuns: 1,
      debugLogs: 1,
      postRunDiagnosis: 1,
      sessionServers: 1,
      sessions: 1,
      logs: 1,
      processStats: 1,
      agentServers: 1,
    });
    const rows = await seed(dbUrl, async (db) => ({
      old: await remaining(db, old),
      kept: await remaining(db, kept),
    }));
    expect(rows.old).toEqual(SWEPT);
    expect(rows.kept).toEqual(SEEDED);
  });

  it("takes an old run's results and jobs with it and leaves the younger session one of them ran", async () => {
    const linked = await seed(dbUrl, (db) => seedLinked(db, "late", 8, 1));
    const result = await runQuery(SWEEP, dbUrl);
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      automationJobs: 1,
      testResults: 1,
      testRuns: 1,
      sessions: 0,
    });
    const left = await seed(dbUrl, async (db) => ({
      testRuns: await db.$count(DbSchema.testRuns, eq(DbSchema.testRuns.id, linked.runId)),
      testResults: await db.$count(
        DbSchema.testResults,
        eq(DbSchema.testResults.id, linked.resultId),
      ),
      sessions: await db.$count(DbSchema.sessions, eq(DbSchema.sessions.id, linked.sessionId)),
    }));
    expect(left).toEqual({ testRuns: 0, testResults: 0, sessions: 1 });
  });

  it("runs as the Worker's scheduled handler: the old rows go and the cron resolves", async () => {
    await seed(dbUrl, async (db) => {
      await db.insert(DbSchema.logs).values([
        { location: "server", agentId: "PRUNE-cron", text: "old", createdAt: daysAgo(8) },
        { location: "server", agentId: "PRUNE-cron", text: "kept", createdAt: daysAgo(6) },
      ]);
    });
    await expect(
      scheduled(
        CRON,
        abortBindings({
          databaseUrl: dbUrl,
          automationUrl: REFUSED_HTTP,
          linearUrl: REFUSED_HTTP,
        }),
      ),
    ).resolves.toBeUndefined();
    const texts = await seed(dbUrl, (db) =>
      db
        .select({ text: DbSchema.logs.text })
        .from(DbSchema.logs)
        .where(eq(DbSchema.logs.agentId, "PRUNE-cron")),
    );
    expect(texts).toEqual([{ text: "kept" }]);
  });
});

describe.skipIf(dbUrl === "")("dashboard/query deleteOldRows unhappy path", () => {
  it("deletes nothing when one delete is refused, and the next sweep takes the rows once the refusal is gone", async () => {
    // A young run's result on an old session: nothing writes this, and the session's own delete
    // is refused by the foreign key. The whole sweep rolls back, the session's actions included.
    const held = await seed(dbUrl, async (db) => {
      const linked = await seedLinked(db, "held", 1, 8);
      await db.insert(DbSchema.actions).values({
        sessionId: linked.sessionId,
        request: { name: "click" },
        createdAt: daysAgo(8),
      });
      return linked;
    });
    const refused = await runQuery(
      "try {\n  await query.deleteOldRows(url);\n} catch (err) {\n  console.error(`${err.message}: ${err.cause.message}`);\n  process.exitCode = 3;\n}",
      dbUrl,
    );
    expect(refused.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(refused.code).toBe(3);
    expect(refused.stderr).toMatch(/Failed query: delete from "sessions"/);
    expect(refused.stderr).toMatch(/violates foreign key constraint/);
    const untouched = await seed(dbUrl, async (db) => ({
      actions: await db.$count(DbSchema.actions, eq(DbSchema.actions.sessionId, held.sessionId)),
      sessions: await db.$count(DbSchema.sessions, eq(DbSchema.sessions.id, held.sessionId)),
    }));
    expect(untouched).toEqual({ actions: 1, sessions: 1 });

    await seed(dbUrl, async (db) => {
      await db
        .delete(DbSchema.automationJobs)
        .where(eq(DbSchema.automationJobs.resultId, held.resultId));
      await db.delete(DbSchema.testResults).where(eq(DbSchema.testResults.id, held.resultId));
      await db.delete(DbSchema.testRuns).where(eq(DbSchema.testRuns.id, held.runId));
    });
    const swept = await runQuery(SWEEP, dbUrl);
    expect(swept.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(swept.stderr).toBe("");
    expect(swept.code).toBe(0);
    expect(JSON.parse(swept.stdout)).toMatchObject({ sessions: 1, actions: 1 });
    const gone = await seed(dbUrl, async (db) => ({
      actions: await db.$count(DbSchema.actions, eq(DbSchema.actions.sessionId, held.sessionId)),
      sessions: await db.$count(DbSchema.sessions, eq(DbSchema.sessions.id, held.sessionId)),
    }));
    expect(gone).toEqual({ actions: 0, sessions: 0 });
  });
});

describe("dashboard/query deleteOldRows unhappy path: unreachable database", () => {
  it("surfaces a refused connection and exits without echoing the password", async () => {
    const result = await runQuery(
      "try {\n  await query.deleteOldRows(url);\n} catch (err) {\n  console.error(err.message);\n  process.exitCode = 3;\n}",
      REFUSED_URL,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).not.toContain(SENTINEL_PASSWORD);
  });

  // The cron's failure is thrown, so Cloudflare records the event as failed and Sentry's wrapper
  // reports it; the connection string never reaches the message.
  it("the scheduled handler rejects with the refused connection, without echoing the password", async () => {
    const outcome = await scheduled(
      CRON,
      abortBindings({
        databaseUrl: REFUSED_URL,
        automationUrl: REFUSED_HTTP,
        linearUrl: REFUSED_HTTP,
      }),
    ).then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(outcome).toMatch(/ECONNREFUSED/);
    expect(outcome).not.toContain(SENTINEL_PASSWORD);
  });
});
