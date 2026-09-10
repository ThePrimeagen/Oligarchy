import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as DbSchema from "../../src/db/schema.ts";
import * as Postgres from "../support/postgres.ts";

const AUTOMATION = fileURLToPath(new URL("../../automation", import.meta.url));
const WEBHOOK_SECRET = "whsec_test";
const UNREACHABLE = "postgres://user:sentinel-pw@127.0.0.1:1/oligarchy";
const EXIT_WITHIN_MS = 60_000;

const dbUrl = inject("dbUrl");

const sign = (payload: string): string =>
  createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");

type Process = {
  readonly child: ChildProcess;
  readonly home: string;
  readonly cwd: string;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  readonly waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<void>;
};

// Sentry is initialised by the wrapper's --import; a proxy nobody listens on keeps the test
// run's fatal lines out of the real project without touching the code under test.
const environment = (home: string, overrides: Record<string, string>): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    LINEAR_WEBHOOK_SECRET: WEBHOOK_SECRET,
    DATABASE_URL: dbUrl === "" ? UNREACHABLE : dbUrl,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim(),
    https_proxy: "http://127.0.0.1:1",
    http_proxy: "http://127.0.0.1:1",
    no_proxy: "",
    ...overrides,
  };
  delete env.FORCE_COLOR;
  delete env.OLIGARCHY_TOKEN;
  return env;
};

// Each process gets an empty cwd (no `.env`) and a different empty HOME. Both directories are
// removed once it has exited.
const spawnAutomation = (
  args: ReadonlyArray<string>,
  overrides: Record<string, string> = {},
): Process => {
  const home = mkdtempSync(join(tmpdir(), "oligarchy-automation-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "oligarchy-automation-cwd-"));
  const child = spawn(AUTOMATION, args, {
    cwd,
    env: environment(home, overrides),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const listeners = new Set<() => void>();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (data: string) => {
    stdout += data;
    for (const listener of listeners) listener();
  });
  child.stderr.on("data", (data: string) => {
    stderr += data;
    for (const listener of listeners) listener();
  });
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), EXIT_WITHIN_MS);
    child.on("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      for (const listener of listeners) listener();
      resolve({ code, signal });
    });
  });
  const waitFor = (pattern: RegExp, timeoutMs = 30_000) =>
    new Promise<void>((resolve, reject) => {
      const check = () => {
        if (pattern.test(stdout) || pattern.test(stderr)) {
          listeners.delete(check);
          clearTimeout(timer);
          resolve();
        } else if (child.exitCode !== null) {
          listeners.delete(check);
          clearTimeout(timer);
          reject(
            new Error(
              `automation exited ${String(child.exitCode)} before ${pattern.source}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
            ),
          );
        }
      };
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`no ${pattern.source} within ${String(timeoutMs)}ms\nstdout:\n${stdout}`));
      }, timeoutMs);
      listeners.add(check);
      check();
    });
  return { child, home, cwd, stdout: () => stdout, stderr: () => stderr, exited, waitFor };
};

const portOf = (address: string | AddressInfo | null): number =>
  typeof address === "object" && address !== null ? address.port : 0;

// A loopback port held open for as long as `release` is not called; released at once for a free one.
const occupy = (): Promise<{ readonly port: number; readonly release: () => Promise<void> }> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: portOf(server.address()),
        release: () => new Promise((done) => server.close(() => done())),
      });
    });
  });

const freePort = async (): Promise<number> => {
  const { port, release } = await occupy();
  await release();
  return port;
};

const lines = (output: string): ReadonlyArray<string> =>
  output.split("\n").filter((line) => line !== "");

const request = (
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
) =>
  fetch(
    `http://127.0.0.1:${String(port)}${path}`,
    body === undefined ? { method, headers } : { method, headers, body },
  );

const seedResult = async (linearId: string): Promise<string> => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    const [definition] = await db.select().from(DbSchema.testDefinitions).limit(1);
    if (definition === undefined) {
      throw new Error("no seeded test definition");
    }
    const runId = randomUUID();
    const resultId = randomUUID();
    await db.insert(DbSchema.testRuns).values({
      id: runId,
      name: `automation-${linearId}`,
      iso: "https://example.com/omarchy.iso",
      serverUrl: "http://127.0.0.1:42069",
      status: "pending",
    });
    await db.insert(DbSchema.testResults).values({
      id: resultId,
      runId,
      definitionId: definition.id,
      linearId,
      status: "pending",
    });
    return resultId;
  } finally {
    await client.end();
  }
};

const jobsFor = async (resultId: string) => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    return await db
      .select()
      .from(DbSchema.automationJobs)
      .where(eq(DbSchema.automationJobs.resultId, resultId));
  } finally {
    await client.end();
  }
};

describe("automation startup refusals", () => {
  it.live("--help exits 0 and lists --port alone", () =>
    Effect.promise(async () => {
      const process = spawnAutomation(["--help"]);
      const { code } = await process.exited;
      expect(code).toBe(0);
      expect(process.stdout()).toContain("--port");
      expect(process.stdout()).not.toContain("--diagnostics-port");
      expect(process.stdout()).not.toContain("--display");
    }),
  );

  it.live("a --port that is not an integer exits 1 with a usage error", () =>
    Effect.promise(async () => {
      const process = spawnAutomation(["--port", "forty"]);
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("forty");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("a missing LINEAR_WEBHOOK_SECRET exits 1 with LINEAR_WEBHOOK_SECRET is not set", () =>
    Effect.promise(async () => {
      const process = spawnAutomation([], { LINEAR_WEBHOOK_SECRET: "" });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("LINEAR_WEBHOOK_SECRET is not set");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("a missing DATABASE_URL exits 1 with DATABASE_URL is not set", () =>
    Effect.promise(async () => {
      const process = spawnAutomation([], { DATABASE_URL: "" });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("DATABASE_URL is not set");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("an unreachable database exits 1 and never listens", () =>
    Effect.promise(async () => {
      const process = spawnAutomation([], { DATABASE_URL: UNREACHABLE });
      const { code } = await process.exited;
      expect(code).toBe(1);
      const fatal = lines(process.stdout()).find((line) =>
        line.startsWith("[automation] automation: fatal: automation: "),
      );
      expect(fatal, process.stdout()).toBeDefined();
      expect(fatal).toContain("database unreachable");
      expect(process.stdout()).not.toContain("listening");
    }),
  );
});

const describeWithDatabase = dbUrl === "" ? describe.skip : describe;

describeWithDatabase("automation startup refusals with a database", () => {
  it.live("an occupied port exits 1 with EADDRINUSE", () =>
    Effect.promise(async () => {
      const { port, release } = await occupy();
      try {
        const process = spawnAutomation(["--port", String(port)]);
        const { code } = await process.exited;
        expect(code).toBe(1);
        const fatal = lines(process.stdout()).find((line) =>
          line.startsWith("[automation] automation: fatal: automation: "),
        );
        expect(fatal, process.stdout()).toBeDefined();
        expect(fatal).toContain("EADDRINUSE");
        expect(fatal).toContain(`127.0.0.1:${String(port)}`);
        expect(process.stdout()).not.toContain("listening");
      } finally {
        await release();
      }
    }),
  );
});

const describeServing = dbUrl === "" ? describe.skip : describe;

describeServing("automation serving", () => {
  const served = async (signal: "SIGINT" | "SIGTERM") => {
    const port = await freePort();
    const process = spawnAutomation(["--port", String(port)]);
    const record = join(process.cwd, "automation-logs");
    try {
      await process.waitFor(/oligarchy automation listening/);
      expect(lines(process.stdout())).toContain(
        `[automation] automation: oligarchy automation listening on 127.0.0.1:${String(port)}`,
      );
      expect(existsSync(record)).toBe(false);

      const automate = await request(
        port,
        "POST",
        "/automate",
        { "content-type": "application/json" },
        '{"ticket":"OLI-1","model":"grok-4.6"}',
      );
      expect(automate.status).toBe(404);
      expect(await automate.json()).toEqual({ error: "not found" });

      const webhookBody = '{"action":"update","type":"Issue","data":{"identifier":"OLI-9"}}';
      const unsigned = await request(
        port,
        "POST",
        "/linear",
        { "content-type": "application/json" },
        webhookBody,
      );
      expect(unsigned.status).toBe(401);
      expect(await unsigned.json()).toEqual({ error: "unauthorized" });
      expect(existsSync(record)).toBe(false);

      const signed = await request(
        port,
        "POST",
        "/linear",
        { "content-type": "application/json", "linear-signature": sign(webhookBody) },
        webhookBody,
      );
      expect(signed.status).toBe(200);
      expect(signed.headers.get("content-type")).toContain("application/json");
      expect(await signed.json()).toEqual({ ok: "true" });
      expect(existsSync(record)).toBe(false);

      const linearId = `OLI-${randomUUID().slice(0, 8)}`;
      const resultId = await seedResult(linearId);
      const driveBody = JSON.stringify({
        action: "update",
        type: "Issue",
        data: {
          identifier: linearId,
          state: {
            id: "a9fe2d89-3cb3-47dd-8645-5d224f997134",
            name: "Automation Needed",
            type: "unstarted",
          },
        },
        updatedFrom: { state: { name: "Backlog" } },
      });
      const drive = await request(
        port,
        "POST",
        "/linear",
        { "content-type": "application/json", "linear-signature": sign(driveBody) },
        driveBody,
      );
      expect(drive.status).toBe(200);
      expect(await drive.json()).toEqual({ ok: "true" });
      expect(await jobsFor(resultId)).toEqual([
        expect.objectContaining({ resultId, action: "drive", status: "pending" }),
      ]);

      const diagnoseBody = JSON.stringify({
        action: "update",
        type: "Issue",
        data: {
          identifier: linearId,
          state: {
            id: "cdf3eb61-bc4b-4b61-8e47-cc2c145a6b6a",
            name: "Needs Review",
            type: "started",
          },
        },
        updatedFrom: { state: { name: "In Progress" } },
      });
      const diagnose = await request(
        port,
        "POST",
        "/linear",
        { "content-type": "application/json", "linear-signature": sign(diagnoseBody) },
        diagnoseBody,
      );
      expect(diagnose.status).toBe(200);
      const jobs = await jobsFor(resultId);
      expect(jobs).toHaveLength(2);
      expect(jobs.map((job) => job.action).sort()).toEqual(["diagnose", "drive"]);

      const start = await request(
        port,
        "POST",
        "/start",
        { "content-type": "application/json" },
        '{"iso":"omarchy.iso","agent":"OLI-1"}',
      );
      expect(start.status).toBe(404);
      expect(await start.json()).toEqual({ error: "not found" });
      const nope = await request(port, "GET", "/automate");
      expect(nope.status).toBe(404);
      const noGet = await request(port, "GET", "/linear");
      expect(noGet.status).toBe(404);
    } finally {
      // A failed expectation must not leave the process listening past the test.
      process.child.kill(signal);
    }
    const { code } = await process.exited;
    expect(code, process.stdout()).toBe(0);
    const output = lines(process.stdout());
    expect(output).toContain("[automation] automation: error: POST /linear failed: unauthorized");
    expect(output).toContain("[automation] automation: linear webhook recorded");
    expect(output).toContain(
      "[OLI-1063] automation: linear webhook queued drive; Automation Needed",
    );
    expect(output).toContain("[OLI-1063] automation: linear webhook queued diagnose; Needs Review");
    expect(output.some((line) => line.includes("/automate"))).toBe(false);
    expect(output.some((line) => line.includes("/start"))).toBe(false);
    expect(process.stderr()).toBe("");

    await expect(request(port, "GET", "/linear")).rejects.toThrow();
  };

  it.live(
    "listens with a database, queues drive and diagnose from signed /linear, answers 401 and 404, and exits 0 on SIGINT",
    () => Effect.promise(() => served("SIGINT")),
    120_000,
  );

  it.live("exits 0 on SIGTERM", () => Effect.promise(() => served("SIGTERM")), 120_000);
});
