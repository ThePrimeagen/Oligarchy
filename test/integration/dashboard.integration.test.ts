import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";

const QUERY = fileURLToPath(new URL("../../src/dashboard/query.ts", import.meta.url));
const SCHEMA = fileURLToPath(new URL("../../src/db/schema.ts", import.meta.url));
const SENTINEL_PASSWORD = "sentinel-secret-pw";
const REFUSED_URL = `postgres://user:${SENTINEL_PASSWORD}@127.0.0.1:1/oligarchy`;
const SEEDED_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const EXIT_WITHIN_MS = 15_000;

const dbUrl = inject("dbUrl");

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
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
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
      "const rows = await query.listSessions(url);\nconsole.log(rows.map((row) => [row.id, typeof row.status, row.imageId === null ? 'null' : typeof row.imageId, row.queriedAt instanceof Date, row.definitionName === null ? 'null' : row.definitionName, row.model === null ? 'null' : row.model].join(' ')).join('\\n'));",
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const rows = lines(result.stdout);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(50);
    for (const row of rows) {
      expect(row).toMatch(/^[0-9a-f-]{36} string (null|string) true \S+ \S+$/);
    }
    expect(rows.some((row) => row.startsWith(`${SEEDED_SESSION_ID} `))).toBe(true);
  });

  it("joins each session to its result model, including two models on one run (happy)", async () => {
    const result = await runQuery(
      `
const { eq } = await import("drizzle-orm");
const { drizzle } = await import("drizzle-orm/node-postgres");
const { Client } = await import("pg");
const schema = await import(${JSON.stringify(SCHEMA)});
const client = new Client({ connectionString: url });
await client.connect();
const db = drizzle(client);
const [lock] = await db.select({ id: schema.testDefinitions.id }).from(schema.testDefinitions).where(eq(schema.testDefinitions.name, "lock-screen"));
const [install] = await db.insert(schema.testDefinitions).values({ name: "install", description: "d", instruction: "i", proof: "p" }).returning({ id: schema.testDefinitions.id });
const [run] = await db.insert(schema.testRuns).values({ name: "Omarchy experiment", iso: "https://example.com/omarchy.iso", serverUrl: "http://127.0.0.1:42069" }).returning({ id: schema.testRuns.id });
await db.insert(schema.testResults).values([
  { runId: run.id, definitionId: lock.id, sessionId: ${JSON.stringify(SEEDED_SESSION_ID)}, status: "passed", model: "grok-4.6" },
  { runId: run.id, definitionId: install.id, sessionId: "22222222-2222-4222-8222-222222222222", status: "failed", model: "composer-2.5" },
]);
await client.end();
const rows = await query.listSessions(url);
const lockRow = rows.find((row) => row.id === ${JSON.stringify(SEEDED_SESSION_ID)});
const installRow = rows.find((row) => row.id === "22222222-2222-4222-8222-222222222222");
console.log([lockRow?.definitionName, lockRow?.model, installRow?.definitionName, installRow?.model].join(" "));
console.log(JSON.stringify(query.definitionStats(rows)));
`,
      dbUrl,
    );
    expect(result.hung, "process did not exit: the pg client was not ended").toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const [linked, stats] = lines(result.stdout);
    expect(linked).toBe("lock-screen grok-4.6 install composer-2.5");
    expect(JSON.parse(stats ?? "")).toEqual([
      { name: "install", succeeded: 0, failed: 0, other: 1, models: ["composer-2.5"] },
      { name: "lock-screen", succeeded: 1, failed: 0, other: 0, models: ["grok-4.6"] },
    ]);
  });

  it("lists test result outcomes with definition name and model and ends the connection", async () => {
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
const [run] = await db.insert(schema.testRuns).values({ name: "Omarchy experiment", iso: "https://example.com/omarchy.iso", serverUrl: "http://127.0.0.1:42069" }).returning({ id: schema.testRuns.id });
await db.insert(schema.testResults).values([
  { runId: run.id, definitionId: lock.id, status: "passed", model: "grok-4.6" },
  { runId: run.id, definitionId: install.id, status: "failed", model: "composer-2.5" },
]);
await client.end();
const rows = await query.listTestResultOutcomes(url);
const counted = query.modelStats(rows.filter((row) => row.definitionName === "lock-outcomes" || row.definitionName === "install-outcomes"));
console.log(rows.filter((row) => row.definitionName === "lock-outcomes" || row.definitionName === "install-outcomes").map((row) => [row.definitionName, row.model, row.status].join(" ")).sort().join("\\n"));
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
      "install-outcomes composer-2.5 failed",
      "lock-outcomes grok-4.6 passed",
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
});
