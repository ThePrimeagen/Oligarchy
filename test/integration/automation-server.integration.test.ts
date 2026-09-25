import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as DbSchema from "@oligarchy/db/schema";
import * as Postgres from "../support/postgres.ts";

const AUTOMATION_SERVER = fileURLToPath(new URL("../../automation-server", import.meta.url));
const AUTOMATION_CLIENT = fileURLToPath(new URL("../../automation-client", import.meta.url));
const WEBHOOK_SECRET = "whsec_test";
// The board watch calls Linear as soon as the server listens, and dispatch moves a reserved
// ticket to In Progress before /run. https_proxy does not cover node:https under Bun, so a
// serving test points LINEAR_API_URL at a local stub instead of api.linear.app.
const LINEAR_TOKEN = "lin_api_test";
let happyLinearUrl = "";
const TOKEN = "test-token";
const UNREACHABLE = "postgres://user:sentinel-pw@127.0.0.1:1/oligarchy";
const EXIT_WITHIN_MS = 60_000;

const dbUrl = Postgres.getDbUrl();

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

// Sentry is initialised by the wrapper's --preload; a proxy nobody listens on keeps the test
// run's fatal lines out of the real project without touching the code under test.
const environment = (home: string, overrides: Record<string, string>): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    LINEAR_WEBHOOK_SECRET: WEBHOOK_SECRET,
    LINEAR_API_TOKEN: LINEAR_TOKEN,
    LINEAR_TEAM: "Fixture Team",
    OLIGARCHY_TOKEN: TOKEN,
    DATABASE_URL: dbUrl === "" ? UNREACHABLE : dbUrl,
    ...(happyLinearUrl === "" ? {} : { LINEAR_API_URL: happyLinearUrl }),
    https_proxy: "http://127.0.0.1:1",
    http_proxy: "http://127.0.0.1:1",
    no_proxy: "",
    ...overrides,
  };
  delete env.FORCE_COLOR;
  return env;
};

// Each process gets an empty cwd (no `.env`) and a different empty HOME. Both directories are
// removed once it has exited.
const spawnProcess = (
  executable: string,
  name: string,
  args: ReadonlyArray<string>,
  overrides: Record<string, string>,
  prepare?: (cwd: string) => void,
): Process => {
  const home = mkdtempSync(join(tmpdir(), "oligarchy-automation-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "oligarchy-automation-cwd-"));
  prepare?.(cwd);
  const child = spawn(executable, args, {
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
              `${name} exited ${String(child.exitCode)} before ${pattern.source}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
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

const spawnAutomationServer = (
  args: ReadonlyArray<string>,
  overrides: Record<string, string> = {},
): Process => spawnProcess(AUTOMATION_SERVER, "automation server", args, overrides);

const writeDriver = (script: string) => (cwd: string) => {
  const file = join(cwd, "driver");
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
};

const spawnAutomationClient = (
  args: ReadonlyArray<string>,
  overrides: Record<string, string> = {},
  driver?: string,
): Process =>
  spawnProcess(
    AUTOMATION_CLIENT,
    "automation client",
    args,
    overrides,
    driver === undefined ? undefined : writeDriver(driver),
  );

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

const removeJobs = async (resultId: string) => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    await db.delete(DbSchema.automationJobs).where(eq(DbSchema.automationJobs.resultId, resultId));
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

describe("automation server startup refusals", () => {
  it.live("--help exits 0 and lists --port", () =>
    Effect.promise(async () => {
      const process = spawnAutomationServer(["--help"]);
      const { code } = await process.exited;
      expect(code).toBe(0);
      expect(process.stdout()).toContain("automation-server");
      expect(process.stdout()).toContain("--port");
      expect(process.stdout()).not.toContain("--model");
      expect(process.stdout()).not.toContain("--jobs");
      expect(process.stdout()).not.toContain("--max-jobs");
      expect(process.stdout()).not.toContain("--diagnostics-port");
      expect(process.stdout()).not.toContain("--display");
    }),
  );

  it.live("a --port that is not an integer exits 1 with a usage error", () =>
    Effect.promise(async () => {
      const process = spawnAutomationServer(["--port", "forty"]);
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("forty");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("a --model flag exits 1 and does not listen", () =>
    Effect.promise(async () => {
      const process = spawnAutomationServer(["--model", "muse-spark-1.3"]);
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("a missing LINEAR_WEBHOOK_SECRET exits 1 with LINEAR_WEBHOOK_SECRET is not set", () =>
    Effect.promise(async () => {
      const process = spawnAutomationServer([], { LINEAR_WEBHOOK_SECRET: "" });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("LINEAR_WEBHOOK_SECRET is not set");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("a missing LINEAR_API_TOKEN exits 1 with LINEAR_API_TOKEN is not set", () =>
    Effect.promise(async () => {
      const process = spawnAutomationServer([], { LINEAR_API_TOKEN: "" });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("LINEAR_API_TOKEN is not set");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("a missing LINEAR_TEAM exits 1 with LINEAR_TEAM is not set", () =>
    Effect.promise(async () => {
      const process = spawnAutomationServer([], { LINEAR_TEAM: "" });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("LINEAR_TEAM is not set");
      expect(process.stderr()).not.toContain("LINEAR_API_TOKEN is not set");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("a missing OLIGARCHY_TOKEN exits 1 with OLIGARCHY_TOKEN is not set", () =>
    Effect.promise(async () => {
      const process = spawnAutomationServer([], { OLIGARCHY_TOKEN: "" });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("OLIGARCHY_TOKEN is not set");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("a missing DATABASE_URL exits 1 with DATABASE_URL is not set", () =>
    Effect.promise(async () => {
      const process = spawnAutomationServer([], { DATABASE_URL: "" });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("DATABASE_URL is not set");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("an unreachable database exits 1 and never listens", () =>
    Effect.promise(async () => {
      const process = spawnAutomationServer([], { DATABASE_URL: UNREACHABLE });
      const { code } = await process.exited;
      expect(code).toBe(1);
      const fatal = lines(process.stdout()).find((line) =>
        line.startsWith("[FATAL] [automation] automation: automation server: "),
      );
      expect(fatal, process.stdout()).toBeDefined();
      expect(fatal).toContain("database unreachable");
      expect(process.stdout()).not.toContain("listening");
    }),
  );
});

const describeWithDatabase = dbUrl === "" ? describe.skip : describe;

describeWithDatabase("automation server startup refusals with a database", () => {
  it.live("an occupied port exits 1 naming the port in use", () =>
    Effect.promise(async () => {
      const { port, release } = await occupy();
      try {
        const process = spawnAutomationServer(["--port", String(port)]);
        const { code } = await process.exited;
        expect(code).toBe(1);
        const fatal = lines(process.stdout()).find((line) =>
          line.startsWith("[FATAL] [automation] automation: automation server: "),
        );
        expect(fatal, process.stdout()).toBeDefined();
        expect(fatal).toContain(`Failed to start server. Is port ${String(port)} in use?`);
        expect(process.stdout()).not.toContain("listening");
      } finally {
        await release();
      }
    }),
  );
});

const describeServing = dbUrl === "" ? describe.skip : describe;

describeServing("automation server serving", () => {
  const served = async (signal: "SIGINT" | "SIGTERM") => {
    const port = await freePort();
    const process = spawnAutomationServer(["--port", String(port)]);
    const record = join(process.cwd, "automation-logs");
    const linearId = `OLI-${randomUUID().slice(0, 8)}`;
    let resultId: string | undefined;
    try {
      await process.waitFor(/automation server listening/);
      expect(lines(process.stdout())).toContain(
        `[INFO] [automation] automation: automation server listening on 127.0.0.1:${String(port)}; drive meta/muse-spark-1.3-contributor; diagnose meta/muse-spark-1.3-contributor; mint meta/muse-spark-1.3-contributor`,
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

      resultId = await seedResult(linearId);
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
        updatedFrom: { stateId: "a4134e28-ad3b-4e3f-b7d2-4fb9132b95e0" },
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
        updatedFrom: { stateId: "2a566723-82d0-40ef-ac2a-55b1811da198" },
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
      // The jobs this test queued stay pending in this file's database and would be the oldest
      // rows the dispatch tests' servers claim first.
      if (resultId !== undefined) {
        await removeJobs(resultId);
      }
    }
    const { code } = await process.exited;
    expect(code, process.stdout()).toBe(0);
    const output = lines(process.stdout());
    expect(output).toContain("[ERROR] [automation] automation: POST /linear failed: unauthorized");
    expect(output).toContain("[INFO] [automation] automation: linear webhook recorded");
    expect(output).toContain(
      `[INFO] [${linearId}] automation: linear webhook queued drive; Automation Needed`,
    );
    expect(output).toContain(
      `[INFO] [${linearId}] automation: linear webhook queued diagnose; Needs Review`,
    );
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

  // A client killed eleven minutes ago, one two minutes quiet (past dispatch's window, so no job
  // is placed on it, and short of the sweep's), and a qemu server killed as long ago.
  const DEAD_CLIENT = "http://10.0.0.50:1";
  const QUIET_CLIENT = "http://10.0.0.51:1";
  const DEAD_QEMU = "http://10.0.0.52:1";

  it.live(
    "forgets an automation-client silent for ten minutes on its first tick, and leaves a quieter one and the qemu server",
    () =>
      Effect.promise(async () => {
        await seedServer(DEAD_CLIENT, "automation-client", "11 minutes");
        await seedServer(QUIET_CLIENT, "automation-client", "2 minutes");
        await seedServer(DEAD_QEMU, "qemu", "11 minutes");
        const port = await freePort();
        const process = spawnAutomationServer(["--port", String(port)]);
        try {
          await process.waitFor(/server forgotten; http:\/\/10\.0\.0\.50:1 silent for 10 minutes/);
          process.child.kill("SIGTERM");
          const { code } = await process.exited;
          expect(code, process.stdout()).toBe(0);
          const left = await serverUrls([DEAD_CLIENT, QUIET_CLIENT, DEAD_QEMU]);
          expect(left).toEqual([QUIET_CLIENT, DEAD_QEMU].sort());
          const output = lines(process.stdout());
          expect(output.filter((line) => line.includes("server forgotten"))).toEqual([
            `[INFO] [automation] automation: server forgotten; ${DEAD_CLIENT} silent for 10 minutes`,
          ]);
          expect(process.stderr()).toBe("");
        } finally {
          // A failed expectation must not leave the process listening, nor the rows for the
          // dispatch tests to find.
          process.child.kill("SIGTERM");
          await process.exited;
          for (const url of [DEAD_CLIENT, QUIET_CLIENT, DEAD_QEMU]) {
            await removeServer(url);
          }
        }
      }),
    120_000,
  );
});

// A row whose last heartbeat is `silentFor` (a Postgres interval) ago on the database's clock, the
// one the sweep measures against.
const seedServer = async (url: string, type: "qemu" | "automation-client", silentFor: string) => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    await db.insert(DbSchema.servers).values({
      url,
      type,
      heartbeatAt: sql`now() - ${silentFor}::interval`,
      generation: 1,
      stats: STATS,
    });
  } finally {
    await client.end();
  }
};

// Which of `urls` still have a row, sorted.
const serverUrls = async (urls: ReadonlyArray<string>): Promise<ReadonlyArray<string>> => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    const rows = await db
      .select({ url: DbSchema.servers.url })
      .from(DbSchema.servers)
      .where(inArray(DbSchema.servers.url, [...urls]));
    return rows.map((row) => row.url).sort();
  } finally {
    await client.end();
  }
};

const STATS: DbSchema.ServerStats = {
  qemus: 0,
  memory: { totalBytes: 1, usedBytes: 0 },
  cpu: { mean1m: 0, mean2m: 0, mean3m: 0 },
};

const seedLiveClient = async (url: string): Promise<string> => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    const [row] = await db
      .insert(DbSchema.servers)
      .values({
        url,
        type: "automation-client",
        heartbeatAt: new Date(),
        generation: 1,
        stats: STATS,
      })
      .returning({ id: DbSchema.servers.id });
    if (row === undefined) {
      throw new Error(`no server row for ${url}`);
    }
    return row.id;
  } finally {
    await client.end();
  }
};

const removeServer = async (url: string) => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    await db.delete(DbSchema.servers).where(eq(DbSchema.servers.url, url));
  } finally {
    await client.end();
  }
};

// What the driver does before ./driver exits: ./ctrl test-results closes the result.
const closeResult = async (resultId: string) => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    await db
      .update(DbSchema.testResults)
      .set({ status: "passed", finishedAt: new Date() })
      .where(eq(DbSchema.testResults.id, resultId));
  } finally {
    await client.end();
  }
};

const seedJob = async (resultId: string, action: "drive" | "diagnose") => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    await db.insert(DbSchema.automationJobs).values({ resultId, action, status: "pending" });
  } finally {
    await client.end();
  }
};

// The row an automation server that died mid-drive leaves behind: running on `serverId`.
const seedRunningJob = async (resultId: string, serverId: string) => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    await db.insert(DbSchema.automationJobs).values({
      resultId,
      action: "drive",
      status: "running",
      serverId,
      startedAt: new Date(),
    });
  } finally {
    await client.end();
  }
};

const waitForJob = async (
  resultId: string,
  status: string,
  timeoutMs = 15_000,
): Promise<(typeof DbSchema.automationJobs)["$inferSelect"]> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const jobs = await jobsFor(resultId);
    const job = jobs[0];
    if (job !== undefined && job.status === status) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const jobs = await jobsFor(resultId);
  throw new Error(`job did not become ${status}: ${JSON.stringify(jobs)}`);
};

const serveClient = (
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> =>
  new Promise((resolve, reject) => {
    const server = createHttpServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${String(portOf(server.address()))}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });

const MODEL = "meta/muse-spark-1.3-contributor";

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      text += chunk;
    });
    req.on("end", () => resolve(text));
  });

const graphqlFields = (
  body: string,
): { readonly query: string; readonly variables: Record<string, unknown> } => {
  const variables: Record<string, unknown> = {};
  let query = "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) {
      if ("query" in parsed && typeof parsed.query === "string") {
        query = parsed.query;
      }
      if (
        "variables" in parsed &&
        typeof parsed.variables === "object" &&
        parsed.variables !== null
      ) {
        for (const [key, value] of Object.entries(parsed.variables)) {
          variables[key] = value;
        }
      }
    }
  } catch {
    query = "";
  }
  return { query, variables };
};

const stateIdOf = (variables: Record<string, unknown>): string => {
  const input = variables.input;
  return typeof input === "object" && input !== null && "stateId" in input
    ? String(input.stateId)
    : "";
};

// Enough of Linear's GraphQL for the board watch and for moving a ticket.
const linearJson = (query: string, variables: Record<string, unknown>): unknown => {
  const name = typeof variables.name === "string" ? variables.name : "";
  if (query.includes("teams(")) {
    return { data: { teams: { nodes: [{ id: "team-id" }] } } };
  }
  if (query.includes("workflowStates")) {
    return { data: { workflowStates: { nodes: [{ id: `state-${name}` }] } } };
  }
  if (query.includes("issues(")) {
    return {
      data: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
    };
  }
  if (query.includes("issueLabels")) {
    return { data: { issueLabels: { nodes: [{ id: "label-ready" }] } } };
  }
  if (query.includes("commentCreate")) {
    return { data: { commentCreate: { success: true } } };
  }
  return { data: { issueUpdate: { success: true } } };
};

const writeJson = (res: ServerResponse, json: unknown) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(json));
};

let closeHappyLinear: () => Promise<void> = async () => undefined;

beforeAll(async () => {
  const linear = await serveClient((req, res) => {
    void readBody(req).then((body) => {
      const { query, variables } = graphqlFields(body);
      writeJson(res, linearJson(query, variables));
    });
  });
  happyLinearUrl = linear.url;
  closeHappyLinear = linear.close;
});

afterAll(async () => {
  await closeHappyLinear();
});

const qemuBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ agent: Schema.String })),
);

const ticketOf = (body: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null && "ticket" in parsed
      ? String(parsed.ticket)
      : undefined;
  } catch {
    return undefined;
  }
};

describeServing("automation server dispatch", () => {
  it.live(
    "a live client that closes the result and answers 200 marks the drive completed; the prompt names the configured model and the body does not",
    () =>
      Effect.promise(async () => {
        const linearId = `OLI-${randomUUID().slice(0, 8)}`;
        const resultId = await seedResult(linearId);
        const bodies: Array<string> = [];
        const client = await serveClient((req, res) => {
          void readBody(req).then(async (body) => {
            // /reserve is answered ok and forgotten; the run's body is what the test reads.
            if (req.url === "/run") {
              bodies.push(body);
              await closeResult(resultId);
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: "true" }));
          });
        });
        await seedJob(resultId, "drive");
        await seedLiveClient(client.url);
        const port = await freePort();
        const process = spawnAutomationServer(["--port", String(port)]);
        try {
          await process.waitFor(/automation server listening/);
          const job = await waitForJob(resultId, "completed");
          expect(job).toMatchObject({ action: "drive", status: "completed", reason: null });
          // The queue is shared with every integration file that ran before: a pending job one of
          // them left is dispatched here too, so this ticket's body is found by its ticket.
          const parsed: Array<{ prompt: string; model?: string }> = bodies.map((text) =>
            JSON.parse(text),
          );
          const body = parsed.find((candidate) => candidate.prompt.includes(linearId));
          expect(body, bodies.join("\n")).toBeDefined();
          expect(body?.model).toBeUndefined();
          expect(body?.prompt).toContain(MODEL);
          expect(process.stdout()).toContain(`dispatching drive; ${client.url}; ${MODEL}`);
        } finally {
          process.child.kill("SIGTERM");
          await process.exited;
          await removeServer(client.url);
          await client.close();
        }
      }),
  );

  it.live(
    "a live client that answers 200 with the result still pending marks the drive errored",
    () =>
      Effect.promise(async () => {
        const client = await serveClient((_req, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: "true" }));
        });
        const linearId = `OLI-${randomUUID().slice(0, 8)}`;
        const resultId = await seedResult(linearId);
        await seedJob(resultId, "drive");
        await seedLiveClient(client.url);
        const port = await freePort();
        const process = spawnAutomationServer(["--port", String(port)]);
        try {
          await process.waitFor(/automation server listening/);
          const job = await waitForJob(resultId, "errored");
          expect(job).toMatchObject({
            action: "drive",
            status: "errored",
            reason: `driver exited; result ${resultId} is pending`,
          });
        } finally {
          process.child.kill("SIGTERM");
          await process.exited;
          await removeServer(client.url);
          await client.close();
        }
      }),
  );

  it.live("a live client that answers 500 on reserve leaves the job pending", () =>
    Effect.promise(async () => {
      const client = await serveClient((_req, res) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "opencode exited 1" }));
      });
      const linearId = `OLI-${randomUUID().slice(0, 8)}`;
      const resultId = await seedResult(linearId);
      await seedJob(resultId, "drive");
      await seedLiveClient(client.url);
      const port = await freePort();
      const process = spawnAutomationServer(["--port", String(port)]);
      try {
        await process.waitFor(/automation server listening/);
        await process.waitFor(new RegExp(`reserve failed; ${client.url.replaceAll(".", "\\.")}`));
        const job = (await jobsFor(resultId))[0];
        expect(job).toMatchObject({
          status: "pending",
          serverId: null,
          startedAt: null,
          finishedAt: null,
          reason: null,
        });
        expect(process.stdout()).toContain(linearId);
        expect(process.stdout()).not.toContain("drive errored");
      } finally {
        process.child.kill("SIGTERM");
        await process.exited;
        await removeServer(client.url);
        await client.close();
      }
    }),
  );

  it.live(
    "SIGTERM while the client is still running stops the drive at the client, aborts the job and exits 0",
    () =>
      Effect.promise(async () => {
        const linearId = `OLI-${randomUUID().slice(0, 8)}`;
        // Another test's pending job can be dispatched to this stub too; only ours is counted.
        const seen: Array<string> = [];
        let running: () => void = () => undefined;
        const ran = new Promise<void>((resolve) => {
          running = resolve;
        });
        const client = await serveClient((req, res) => {
          void readBody(req).then((body) => {
            if (ticketOf(body) === linearId) {
              seen.push(`${req.method} ${req.url ?? ""}`);
              if (req.url === "/run") {
                running();
              }
            }
            if (req.url === "/reserve" || req.url === "/abort") {
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ ok: "true" }));
            }
          });
        });
        const resultId = await seedResult(linearId);
        await seedJob(resultId, "drive");
        await seedLiveClient(client.url);
        const port = await freePort();
        const process = spawnAutomationServer(["--port", String(port)]);
        try {
          await process.waitFor(/automation server listening/);
          await ran;
          process.child.kill("SIGTERM");
          const { code } = await process.exited;
          expect(code).toBe(0);
          expect(seen).toEqual(["POST /reserve", "POST /run", "POST /abort"]);
          const jobs = await jobsFor(resultId);
          expect(jobs).toEqual([
            expect.objectContaining({
              status: "aborted",
              reason: "automation server shutting down",
            }),
          ]);
        } finally {
          if (process.child.exitCode === null && process.child.signalCode === null) {
            process.child.kill("SIGKILL");
            await process.exited;
          }
          await removeServer(client.url);
          await client.close();
        }
      }),
  );
});

describeServing("automation server abort", () => {
  it.live("aborts a running job at the client that claimed it", () =>
    Effect.promise(async () => {
      const seen: Array<string> = [];
      const client = await serveClient((req, res) => {
        seen.push(`${req.method} ${req.url ?? ""}`);
        if (req.url === "/reserve" || req.url === "/abort") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: "true" }));
        }
      });
      const linearId = `OLI-${randomUUID().slice(0, 8)}`;
      const resultId = await seedResult(linearId);
      await seedJob(resultId, "drive");
      await seedLiveClient(client.url);
      const port = await freePort();
      const process = spawnAutomationServer(["--port", String(port)]);
      try {
        await process.waitFor(/automation server listening/);
        await waitForJob(resultId, "running");
        const response = await request(
          port,
          "POST",
          "/abort",
          { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          JSON.stringify({ ticket: linearId, action: "drive" }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: "true" });
        const job = await waitForJob(resultId, "aborted");
        expect(job).toMatchObject({
          status: "aborted",
          reason: "aborted",
        });
        expect(job.serverId).toEqual(expect.any(String));
        expect(seen).toContain("POST /abort");
      } finally {
        process.child.kill("SIGTERM");
        await process.exited;
        await removeServer(client.url);
        await client.close();
      }
    }),
  );

  it.live("closes a pending job as aborted while no client has it", () =>
    Effect.promise(async () => {
      const linearId = `OLI-${randomUUID().slice(0, 8)}`;
      const resultId = await seedResult(linearId);
      await seedJob(resultId, "drive");
      const port = await freePort();
      const process = spawnAutomationServer(["--port", String(port)]);
      try {
        await process.waitFor(/automation server listening/);
        expect((await jobsFor(resultId))[0]?.status).toBe("pending");
        const response = await request(
          port,
          "POST",
          "/abort",
          { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          JSON.stringify({ ticket: linearId, action: "drive" }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: "true" });
        const job = await waitForJob(resultId, "aborted");
        expect(job).toMatchObject({ status: "aborted", reason: "aborted", serverId: null });
        expect(job.finishedAt).toBeInstanceOf(Date);
        expect(job.startedAt).toBeNull();
        await process.waitFor(/aborted pending drive/);
        expect(lines(process.stdout())).toContain(
          `[INFO] [${linearId}] automation: aborted pending drive`,
        );
      } finally {
        process.child.kill("SIGTERM");
        await process.exited;
      }
    }),
  );

  it.live("400 when the ticket has nothing pending or running", () =>
    Effect.promise(async () => {
      const port = await freePort();
      const process = spawnAutomationServer(["--port", String(port)]);
      try {
        await process.waitFor(/automation server listening/);
        const response = await request(
          port,
          "POST",
          "/abort",
          { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          JSON.stringify({ ticket: "OLI-missing", action: "drive" }),
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: 'ticket "OLI-missing" has no drive to abort',
        });
      } finally {
        process.child.kill("SIGTERM");
        await process.exited;
      }
    }),
  );

  it.live(
    "a running job its client holds nothing for is reported JobNotFound, closed aborted, and answered 200",
    () =>
      Effect.promise(async () => {
        const client = await serveClient((req, res) => {
          if (req.url === "/reserve") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: "true" }));
            return;
          }
          if (req.url === "/abort") {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: 'unknown session "OLI-x"' }));
          }
        });
        const linearId = `OLI-${randomUUID().slice(0, 8)}`;
        const resultId = await seedResult(linearId);
        await seedJob(resultId, "drive");
        await seedLiveClient(client.url);
        const port = await freePort();
        const process = spawnAutomationServer(["--port", String(port)]);
        try {
          await process.waitFor(/automation server listening/);
          await waitForJob(resultId, "running");
          const response = await request(
            port,
            "POST",
            "/abort",
            { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
            JSON.stringify({ ticket: linearId, action: "drive" }),
          );
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ ok: "true" });
          const job = await waitForJob(resultId, "aborted");
          expect(job).toMatchObject({ status: "aborted", reason: "aborted" });
          await process.waitFor(/JobNotFound: Job had "running" status but 404'd\./);
          expect(lines(process.stdout())).toContain(
            `[ERROR] [${linearId}] automation: JobNotFound: Job had "running" status but 404'd.`,
          );
        } finally {
          process.child.kill("SIGTERM");
          await process.exited;
          await removeServer(client.url);
          await client.close();
        }
      }),
  );

  it.live("401 without a bearer", () =>
    Effect.promise(async () => {
      const port = await freePort();
      const process = spawnAutomationServer(["--port", String(port)]);
      try {
        await process.waitFor(/automation server listening/);
        const response = await request(
          port,
          "POST",
          "/abort",
          { "content-type": "application/json" },
          JSON.stringify({ ticket: "OLI-1", action: "drive" }),
        );
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "unauthorized" });
      } finally {
        process.child.kill("SIGTERM");
        await process.exited;
      }
    }),
  );
});

const RESTARTED = "automation server restarted";

const stop = async (process: Process) => {
  if (process.child.exitCode === null && process.child.signalCode === null) {
    process.child.kill("SIGKILL");
  }
  await process.exited;
};

describeServing("automation server restart", () => {
  it.live(
    "SIGKILL while /run waits leaves the drive running; the next automation server stops it at its automation client and errors it",
    () =>
      Effect.promise(async () => {
        const linearId = `OLI-${randomUUID().slice(0, 8)}`;
        const resultId = await seedResult(linearId);
        const aborts: Array<string> = [];
        // /run is never answered: the driver is still driving when the automation server dies.
        const client = await serveClient((req, res) => {
          void readBody(req).then((body) => {
            if (req.url === "/abort") {
              aborts.push(body);
            }
            if (req.url !== "/run") {
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ ok: "true" }));
            }
          });
        });
        await seedJob(resultId, "drive");
        await seedLiveClient(client.url);
        const first = spawnAutomationServer(["--port", String(await freePort())]);
        let second: Process | undefined;
        try {
          await first.waitFor(/automation server listening/);
          const running = await waitForJob(resultId, "running");
          first.child.kill("SIGKILL");
          expect((await first.exited).signal).toBe("SIGKILL");
          expect(await jobsFor(resultId)).toEqual([
            expect.objectContaining({ status: "running", serverId: running.serverId }),
          ]);
          expect(aborts.filter((body) => ticketOf(body) === linearId)).toEqual([]);

          second = spawnAutomationServer(["--port", String(await freePort())]);
          const job = await waitForJob(resultId, "errored", 30_000);
          expect(job).toMatchObject({ status: "errored", reason: RESTARTED });
          expect(job.serverId).toBe(running.serverId);
          expect(aborts.map(ticketOf).filter((ticket) => ticket === linearId)).toEqual([linearId]);
          await second.waitFor(new RegExp(`drive errored; ${RESTARTED}`));
          expect(lines(second.stdout()), second.stdout()).toContain(
            `[ERROR] [global] automation: drive errored; ${RESTARTED}`,
          );
        } finally {
          await stop(first);
          if (second !== undefined) {
            await stop(second);
          }
          await removeJobs(resultId);
          await removeServer(client.url);
          await client.close();
        }
      }),
    120_000,
  );

  it.live(
    "SIGKILL while /reserve waits leaves the drive pending; the next automation server places and finishes it",
    () =>
      Effect.promise(async () => {
        const linearId = `OLI-${randomUUID().slice(0, 8)}`;
        const resultId = await seedResult(linearId);
        let reserves = 0;
        let reserving: () => void = () => undefined;
        const reserved = new Promise<void>((resolve) => {
          reserving = resolve;
        });
        // This ticket's first /reserve is never answered. Every other request is ok.
        const client = await serveClient((req, res) => {
          void readBody(req).then(async (body) => {
            const ours = ticketOf(body) === linearId;
            if (req.url === "/reserve" && ours) {
              reserves += 1;
              if (reserves === 1) {
                reserving();
                return;
              }
            }
            if (req.url === "/run" && ours) {
              await closeResult(resultId);
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: "true" }));
          });
        });
        await seedJob(resultId, "drive");
        await seedLiveClient(client.url);
        const first = spawnAutomationServer(["--port", String(await freePort())]);
        let second: Process | undefined;
        try {
          await first.waitFor(/automation server listening/);
          await reserved;
          first.child.kill("SIGKILL");
          expect((await first.exited).signal).toBe("SIGKILL");
          expect(await jobsFor(resultId)).toEqual([
            expect.objectContaining({ status: "pending", serverId: null, startedAt: null }),
          ]);

          second = spawnAutomationServer(["--port", String(await freePort())]);
          const job = await waitForJob(resultId, "completed", 30_000);
          expect(job).toMatchObject({ status: "completed", reason: null });
          expect(reserves).toBe(2);
        } finally {
          await stop(first);
          if (second !== undefined) {
            await stop(second);
          }
          await removeJobs(resultId);
          await removeServer(client.url);
          await client.close();
        }
      }),
    120_000,
  );

  it.live(
    "SIGKILL while a real automation client reserves, which it still grants, leaves the drive pending; the next automation server reserves it there again, QEMU is asked once, and the drive succeeds",
    () =>
      Effect.promise(async () => {
        const linearId = `OLI-${randomUUID().slice(0, 8)}`;
        const resultId = await seedResult(linearId);
        let qemuReserves = 0;
        let reaching: () => void = () => undefined;
        const reached = new Promise<void>((resolve) => {
          reaching = resolve;
        });
        let grant: () => void = () => undefined;
        // This ticket's first QEMU reserve is answered only once the automation server that
        // asked for it is dead. Every other request is ok.
        const qemu = await serveClient((req, res) => {
          void readBody(req).then((body) => {
            const ok = () => {
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ ok: "true" }));
            };
            const ours = Option.exists(qemuBody(body), (parsed) => parsed.agent === linearId);
            if (req.url === "/reserve" && ours) {
              qemuReserves += 1;
              if (qemuReserves === 1) {
                grant = ok;
                reaching();
                return;
              }
            }
            ok();
          });
        });
        const clientPort = await freePort();
        const url = `http://127.0.0.1:${String(clientPort)}`;
        const client = spawnAutomationClient(
          [
            "--max-jobs",
            "4",
            "--name",
            `restart-${linearId}`,
            "--port",
            String(clientPort),
            "--url",
            url,
          ],
          { SERVER_URL: qemu.url },
          "exit 0",
        );
        let first: Process | undefined;
        let second: Process | undefined;
        try {
          await client.waitFor(/automation client listening/);
          await seedJob(resultId, "drive");
          first = spawnAutomationServer(["--port", String(await freePort())]);
          await reached;
          first.child.kill("SIGKILL");
          expect((await first.exited).signal).toBe("SIGKILL");
          expect(await jobsFor(resultId)).toEqual([
            expect.objectContaining({ status: "pending", serverId: null, startedAt: null }),
          ]);
          // Granted after its caller died: the automation client holds a reservation the row
          // does not record.
          grant();
          await closeResult(resultId);

          second = spawnAutomationServer(["--port", String(await freePort())]);
          const job = await waitForJob(resultId, "completed", 30_000);
          expect(job).toMatchObject({ status: "completed", reason: null });
          expect(qemuReserves).toBe(1);
          const ours = (output: string) => lines(output).filter((line) => line.includes(linearId));
          expect(ours(second.stdout()).filter((line) => line.includes("reserve failed"))).toEqual(
            [],
          );
          expect(ours(client.stdout()).filter((line) => line.includes("already reserved"))).toEqual(
            [],
          );
        } finally {
          if (first !== undefined) {
            await stop(first);
          }
          if (second !== undefined) {
            await stop(second);
          }
          await stop(client);
          await removeJobs(resultId);
          await removeServer(url);
          await qemu.close();
        }
      }),
    120_000,
  );

  it.live(
    "a drive left running before its /run started: the next automation server gives back the reservation a real automation client holds, its guest slot with it, and errors the drive",
    () =>
      Effect.promise(async () => {
        const linearId = `OLI-${randomUUID().slice(0, 8)}`;
        const resultId = await seedResult(linearId);
        const qemuCalls: Array<string> = [];
        const qemu = await serveClient((req, res) => {
          void readBody(req).then((body) => {
            if (Option.exists(qemuBody(body), (parsed) => parsed.agent === linearId)) {
              qemuCalls.push(req.url ?? "");
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: "true" }));
          });
        });
        const clientPort = await freePort();
        const url = `http://127.0.0.1:${String(clientPort)}`;
        const client = spawnAutomationClient(
          ["--max-jobs", "4", "--name", `inherited-${linearId}`, "--port", String(clientPort)],
          { SERVER_URL: qemu.url },
          "exit 0",
        );
        const bearer = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
        let automationServer: Process | undefined;
        try {
          await client.waitFor(/automation client listening/);
          // What the dead automation server did before its /run: reserved at the automation
          // client, then wrote the row running on it.
          const reserved = await request(
            clientPort,
            "POST",
            "/reserve",
            bearer,
            JSON.stringify({ ticket: linearId, action: "drive" }),
          );
          expect(reserved.status).toBe(200);
          const serverId = await seedLiveClient(url);
          await seedRunningJob(resultId, serverId);

          automationServer = spawnAutomationServer(["--port", String(await freePort())]);
          const job = await waitForJob(resultId, "errored", 30_000);
          expect(job).toMatchObject({ status: "errored", reason: RESTARTED, serverId });
          expect(qemuCalls).toEqual(["/reserve", "/relinquish"]);
          const refused = await request(
            clientPort,
            "POST",
            "/run",
            bearer,
            JSON.stringify({
              prompt: "do the work",
              ticket: linearId,
            }),
          );
          expect(refused.status).toBe(400);
          expect(await refused.json()).toEqual({ error: "no reservation" });
        } finally {
          if (automationServer !== undefined) {
            await stop(automationServer);
          }
          await stop(client);
          await removeJobs(resultId);
          await removeServer(url);
          await qemu.close();
        }
      }),
    120_000,
  );

  it.live(
    "SIGKILL after the drive is running and before Linear moves to In Progress leaves it running; the next automation server stops it at its automation client and errors it, and /run never starts",
    () =>
      Effect.promise(async () => {
        const linearId = `OLI-${randomUUID().slice(0, 8)}`;
        const resultId = await seedResult(linearId);
        const updates: Array<string> = [];
        let holding: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
          holding = resolve;
        });
        // Answer every Linear call except the move to In Progress, which stays open.
        const linear = await serveClient((req, res) => {
          void readBody(req).then((body) => {
            const { query, variables } = graphqlFields(body);
            const stateId = stateIdOf(variables);
            if (query.includes("issueUpdate") && stateId === "state-In Progress") {
              updates.push(stateId);
              holding();
              return;
            }
            if (query.includes("issueUpdate") && stateId !== "") {
              updates.push(stateId);
            }
            writeJson(res, linearJson(query, variables));
          });
        });
        let runs = 0;
        let ran: () => void = () => undefined;
        const startedRun = new Promise<void>((resolve) => {
          ran = resolve;
        });
        const aborts: Array<string> = [];
        const client = await serveClient((req, res) => {
          void readBody(req).then((body) => {
            if (req.url === "/abort") {
              aborts.push(body);
            }
            if (req.url === "/run" && ticketOf(body) === linearId) {
              runs += 1;
              ran();
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: "true" }));
          });
        });
        await seedJob(resultId, "drive");
        await seedLiveClient(client.url);
        const first = spawnAutomationServer(["--port", String(await freePort())], {
          LINEAR_API_URL: linear.url,
        });
        let second: Process | undefined;
        try {
          await first.waitFor(/automation server listening/);
          const running = await waitForJob(resultId, "running");
          // markRunning has committed. The In Progress update is the next step, and /run
          // waits for it to land.
          const moved = await Promise.race([
            held.then(() => "held" as const),
            startedRun.then(() => "ran" as const),
            new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 15_000)),
          ]);
          expect(moved).toBe("held");
          expect(runs).toBe(0);
          expect(updates).toEqual(["state-In Progress"]);
          first.child.kill("SIGKILL");
          expect((await first.exited).signal).toBe("SIGKILL");
          expect(await jobsFor(resultId)).toEqual([
            expect.objectContaining({ status: "running", serverId: running.serverId }),
          ]);
          expect(aborts.filter((body) => ticketOf(body) === linearId)).toEqual([]);

          second = spawnAutomationServer(["--port", String(await freePort())], {
            LINEAR_API_URL: linear.url,
          });
          const job = await waitForJob(resultId, "errored", 30_000);
          expect(job).toMatchObject({ status: "errored", reason: RESTARTED });
          expect(job.serverId).toBe(running.serverId);
          expect(aborts.map(ticketOf).filter((ticket) => ticket === linearId)).toEqual([linearId]);
          expect(runs).toBe(0);
          const deadline = Date.now() + 15_000;
          while (!updates.includes("state-Errored") && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          expect(updates).toContain("state-Errored");
          await second.waitFor(new RegExp(`drive errored; ${RESTARTED}`));
        } finally {
          await stop(first);
          if (second !== undefined) {
            await stop(second);
          }
          await removeJobs(resultId);
          await removeServer(client.url);
          await client.close();
          await linear.close();
        }
      }),
    120_000,
  );

  it.live(
    "a drive left running on an automation client that refuses connections is reported and errored, and the automation server keeps serving",
    () =>
      Effect.promise(async () => {
        const linearId = `OLI-${randomUUID().slice(0, 8)}`;
        const resultId = await seedResult(linearId);
        const url = `http://127.0.0.1:${String(await freePort())}`;
        const serverId = await seedLiveClient(url);
        await seedRunningJob(resultId, serverId);
        const port = await freePort();
        const process = spawnAutomationServer(["--port", String(port)]);
        try {
          const job = await waitForJob(resultId, "errored", 30_000);
          expect(job).toMatchObject({ status: "errored", reason: RESTARTED, serverId });
          await process.waitFor(
            new RegExp(`inherited abort failed; ${url.replaceAll(".", "\\.")}`),
          );
          expect(lines(process.stdout()), process.stdout()).toContain(
            `[ERROR] [${linearId}] automation: inherited abort failed; ${url}`,
          );
          await process.waitFor(/automation server listening/);
          const response = await request(port, "GET", "/linear");
          expect(response.status).toBe(404);
        } finally {
          await stop(process);
          await removeJobs(resultId);
          await removeServer(url);
        }
      }),
    120_000,
  );
});
