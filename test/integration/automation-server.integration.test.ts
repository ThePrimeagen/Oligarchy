import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
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

const AUTOMATION_SERVER = fileURLToPath(new URL("../../automation-server", import.meta.url));
const WEBHOOK_SECRET = "whsec_test";
const TOKEN = "test-token";
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
    OLIGARCHY_TOKEN: TOKEN,
    DATABASE_URL: dbUrl === "" ? UNREACHABLE : dbUrl,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim(),
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
const spawnAutomationServer = (
  args: ReadonlyArray<string>,
  overrides: Record<string, string> = {},
): Process => {
  const home = mkdtempSync(join(tmpdir(), "oligarchy-automation-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "oligarchy-automation-cwd-"));
  const child = spawn(AUTOMATION_SERVER, args, {
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
              `automation server exited ${String(child.exitCode)} before ${pattern.source}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
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
  it.live("--help exits 0 and lists --port and --model", () =>
    Effect.promise(async () => {
      const process = spawnAutomationServer(["--help"]);
      const { code } = await process.exited;
      expect(code).toBe(0);
      expect(process.stdout()).toContain("automation-server");
      expect(process.stdout()).toContain("--port");
      expect(process.stdout()).toContain("--model");
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

  it.live("a --model without a provider exits 1 with the rule", () =>
    Effect.promise(async () => {
      const process = spawnAutomationServer(["--model", "muse-spark-1.3"]);
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("model must be provider/model");
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
        line.startsWith("[automation] automation: fatal: automation server: "),
      );
      expect(fatal, process.stdout()).toBeDefined();
      expect(fatal).toContain("database unreachable");
      expect(process.stdout()).not.toContain("listening");
    }),
  );
});

const describeWithDatabase = dbUrl === "" ? describe.skip : describe;

describeWithDatabase("automation server startup refusals with a database", () => {
  it.live("an occupied port exits 1 with EADDRINUSE", () =>
    Effect.promise(async () => {
      const { port, release } = await occupy();
      try {
        const process = spawnAutomationServer(["--port", String(port)]);
        const { code } = await process.exited;
        expect(code).toBe(1);
        const fatal = lines(process.stdout()).find((line) =>
          line.startsWith("[automation] automation: fatal: automation server: "),
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
        `[automation] automation: automation server listening on 127.0.0.1:${String(port)}; running agents as opencode/muse-spark-1.3-contributor-free`,
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
      // The jobs this test queued stay pending in the shared database and would be the oldest rows
      // the dispatch tests' servers claim first.
      if (resultId !== undefined) {
        await removeJobs(resultId);
      }
    }
    const { code } = await process.exited;
    expect(code, process.stdout()).toBe(0);
    const output = lines(process.stdout());
    expect(output).toContain("[automation] automation: error: POST /linear failed: unauthorized");
    expect(output).toContain("[automation] automation: linear webhook recorded");
    expect(output).toContain(
      `[${linearId}] automation: linear webhook queued drive; Automation Needed`,
    );
    expect(output).toContain(
      `[${linearId}] automation: linear webhook queued diagnose; Needs Review`,
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
});

const STATS: DbSchema.ServerStats = {
  qemus: 0,
  memory: { totalBytes: 1, usedBytes: 0 },
  cpu: { mean1m: 0, mean2m: 0, mean3m: 0 },
};

const seedLiveClient = async (url: string) => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    await db.insert(DbSchema.servers).values({
      url,
      type: "automation-client",
      heartbeatAt: new Date(),
      generation: 1,
      stats: STATS,
    });
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

// What the driver does before opencode exits: ./ctrl test-results closes the result.
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

const MODEL = "openrouter/deepseek/deepseek-v4.1-flash";

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      text += chunk;
    });
    req.on("end", () => resolve(text));
  });

describeServing("automation server dispatch", () => {
  it.live(
    "a live client that closes the result and answers 200 marks the drive succeeded; the body carries --model",
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
        const process = spawnAutomationServer(["--port", String(port), "--model", MODEL]);
        try {
          await process.waitFor(/automation server listening/);
          const job = await waitForJob(resultId, "succeeded");
          expect(job).toMatchObject({ action: "drive", status: "succeeded", reason: null });
          expect(bodies).toHaveLength(1);
          const body: { prompt: string; model: string } = JSON.parse(bodies[0] ?? "{}");
          expect(body.model).toBe(MODEL);
          expect(body.prompt).toContain(linearId);
          expect(body.prompt).toContain(MODEL);
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
    "a live client that answers 200 with the result still pending marks the drive failed",
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
          const job = await waitForJob(resultId, "failed");
          expect(job).toMatchObject({
            action: "drive",
            status: "failed",
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

  it.live("a live client that answers 500 marks the job failed", () =>
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
        const job = await waitForJob(resultId, "failed");
        expect(job.status).toBe("failed");
        expect(job.reason).toContain("opencode exited 1");
      } finally {
        process.child.kill("SIGTERM");
        await process.exited;
        await removeServer(client.url);
        await client.close();
      }
    }),
  );

  it.live("SIGTERM while the client is still running aborts the job and exits 0", () =>
    Effect.promise(async () => {
      const client = await serveClient(() => {});
      const linearId = `OLI-${randomUUID().slice(0, 8)}`;
      const resultId = await seedResult(linearId);
      await seedJob(resultId, "drive");
      await seedLiveClient(client.url);
      const port = await freePort();
      const process = spawnAutomationServer(["--port", String(port)]);
      try {
        await process.waitFor(/automation server listening/);
        await waitForJob(resultId, "running");
        process.child.kill("SIGTERM");
        const { code } = await process.exited;
        expect(code).toBe(0);
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
        if (req.url === "/abort") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: "true" }));
          return;
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
          JSON.stringify({ ticket: linearId }),
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

  it.live("400 when the ticket is not running", () =>
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
          JSON.stringify({ ticket: "OLI-missing" }),
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: 'ticket "OLI-missing" is not running',
        });
      } finally {
        process.child.kill("SIGTERM");
        await process.exited;
      }
    }),
  );

  it.live("404 when the client does not know the session, and the job stays running", () =>
    Effect.promise(async () => {
      const client = await serveClient((req, res) => {
        if (req.url === "/abort") {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: 'unknown session "OLI-x"' }));
          return;
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
          JSON.stringify({ ticket: linearId }),
        );
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
          error: `unknown session "${linearId}"`,
        });
        const jobs = await jobsFor(resultId);
        expect(jobs).toEqual([expect.objectContaining({ status: "running" })]);
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
          JSON.stringify({ ticket: "OLI-1" }),
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
