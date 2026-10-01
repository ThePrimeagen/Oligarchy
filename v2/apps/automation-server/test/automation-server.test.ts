import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { fileURLToPath } from "node:url";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as jarl from "jarl";
import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const { models } = JSON.parse(readFileSync(Env.CONFIG_PATH, "utf8"));
const TOKEN = "oligarchy-token";
const STOPPED = "[INFO] [global] automation-server: stopped; SIGTERM received";
const SILENT = "http://127.0.0.1:1/silent-client";
const FORGOTTEN = `[INFO] [global] automation-server: server forgotten; ${SILENT} silent for 600 seconds`;
const SWEEP_FAILED = "[ERROR] [global] automation-server: stale server cleanup failed: ";

const startedText = (port: number) =>
  `started on 127.0.0.1:${String(port)}; drive ${models.drive}; diagnose ${models.diagnose}; setup ${models.setup}`;
const startedLine = (port: number) => `[INFO] [global] automation-server: ${startedText(port)}`;

const cleanups: Array<() => Promise<unknown> | unknown> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

const started = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  return fake;
};

const query = async (url: string, sql: string) => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
};

// A port held open on 127.0.0.1 until the test ends.
const held = async (): Promise<{ readonly port: number; readonly server: Server }> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("no port");
  }
  return { port: address.port, server };
};

// A port nothing listens on.
const freePort = async (): Promise<number> => {
  const { port, server } = await held();
  await new Promise((resolve) => server.close(resolve));
  return port;
};

// The server as its own process, the way `bun run automation-server` starts it. A proxy nobody
// listens on refuses its requests to Sentry, so an error line it sends never reaches the real
// project.
const server = (argv: ReadonlyArray<string>, env: Readonly<Record<string, string>>) => {
  const { DATABASE_URL: _, OLIGARCHY_TOKEN: __, ...inherited } = process.env;
  const child = spawn(process.execPath, ["--no-env-file", MAIN, ...argv], {
    env: {
      ...inherited,
      ...env,
      https_proxy: "http://127.0.0.1:1",
      http_proxy: "http://127.0.0.1:1",
      no_proxy: "",
    },
  });
  cleanups.push(() => child.kill("SIGKILL"));
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const lines = () => stdout.split("\n").filter((line) => line !== "");
  return { child, exited, lines, stderr: () => stderr };
};

describe("the automation server as a process", () => {
  it("listens on --port behind the bearer, forgets a client silent for ten minutes, runs until SIGTERM, stops without waiting out the dispatch interval and exits 0, each line stored (happy)", async () => {
    const fake = await started();
    await query(
      fake.url,
      `insert into servers (url, type, heartbeat_at) values ('${SILENT}', 'automation-client', now() - interval '11 minutes')`,
    );
    const port = await freePort();
    const running = server(["--port", String(port)], {
      DATABASE_URL: fake.url,
      OLIGARCHY_TOKEN: TOKEN,
    });

    await vi.waitFor(() => expect(running.lines()).toContain(FORGOTTEN), { timeout: 15_000 });
    const unauthorized = await fetch(`http://127.0.0.1:${String(port)}/abort`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11" }),
    });
    expect(unauthorized.status).toBe(401);
    expect(running.child.exitCode).toBe(null);
    const killedAt = Date.now();
    running.child.kill("SIGTERM");

    expect(await running.exited).toBe(0);
    expect(Date.now() - killedAt).toBeLessThan(5_000);
    expect(running.lines()).toEqual([startedLine(port), FORGOTTEN, STOPPED]);
    expect(await query(fake.url, "select url from servers")).toEqual([]);
    expect(await query(fake.url, "select level, location, text from logs order by id")).toEqual([
      { level: "info", location: "automation-server", text: startedText(port) },
      {
        level: "info",
        location: "automation-server",
        text: `server forgotten; ${SILENT} silent for 600 seconds`,
      },
      { level: "info", location: "automation-server", text: "stopped; SIGTERM received" },
    ]);
  });

  it("with its port already taken, says it could not listen and exits 1, starting nothing (unhappy)", async () => {
    const fake = await started();
    await query(
      fake.url,
      `insert into servers (url, type, heartbeat_at) values ('${SILENT}', 'automation-client', now() - interval '11 minutes')`,
    );
    const { port } = await held();

    const running = server(["--port", String(port)], {
      DATABASE_URL: fake.url,
      OLIGARCHY_TOKEN: TOKEN,
    });

    expect(await running.exited).toBe(1);
    const lines = running.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      new RegExp(
        `^\\[FATAL\\] \\[global\\] automation-server: could not listen on 127\\.0\\.0\\.1:${String(port)}: .*EADDRINUSE`,
      ),
    );
    expect(await query(fake.url, "select url from servers")).toEqual([{ url: SILENT }]);
  });

  it("with the database gone, says the sweep failed, still stops on SIGTERM, each line followed by its refused insert (unhappy)", async () => {
    const fake = await started();
    await fake.stop();
    const port = await freePort();
    const running = server(["--port", String(port)], {
      DATABASE_URL: fake.url,
      OLIGARCHY_TOKEN: TOKEN,
    });

    await vi.waitFor(
      () => expect(running.lines().some((line) => line.startsWith(SWEEP_FAILED))).toBe(true),
      { timeout: 15_000 },
    );
    running.child.kill("SIGTERM");

    expect(await running.exited).toBe(0);
    const lines = running.lines();
    const refused = /^\[ERROR\] \[global\] db: log insert failed: /;
    expect(lines[0]).toBe(startedLine(port));
    expect(lines[1]).toMatch(refused);
    const stoppedAt = lines.indexOf(STOPPED);
    expect(stoppedAt).toBeGreaterThan(1);
    expect(lines[stoppedAt + 1]).toMatch(refused);
    expect(lines.join("\n")).toContain("ECONNREFUSED");
  });

  it("with no DATABASE_URL, says so on stderr and exits 1 (unhappy)", async () => {
    const running = server(["--port", String(await freePort())], { OLIGARCHY_TOKEN: TOKEN });

    expect(await running.exited).toBe(1);
    expect(running.stderr()).toBe("DATABASE_URL is not set\n");
    expect(running.lines()).toEqual([]);
  });
});
