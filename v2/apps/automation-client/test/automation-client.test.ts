import { spawn } from "node:child_process";
import { createServer, type Server } from "node:net";
import { fileURLToPath } from "node:url";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as jarl from "jarl";
import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const TOKEN = "oligarchy-token";
const NAME = "c1";
const CLIENT_URL = "http://c1.test:4100";
const STOPPED = "[INFO] [global] automation-client: stopped; SIGTERM received";
const HEARTBEAT_FAILED = "[ERROR] [global] automation-client: heartbeat failed: ";

const startedText = (port: number) =>
  `started on 127.0.0.1:${String(port)}; name ${NAME}; announcing ${CLIENT_URL}`;
const startedLine = (port: number) => `[INFO] [global] automation-client: ${startedText(port)}`;

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

// The client as its own process, the way `bun run automation-client` starts it. A proxy nobody
// listens on refuses its requests to Sentry, so an error line it sends never reaches the real
// project.
const automationClient = (argv: ReadonlyArray<string>, env: Readonly<Record<string, string>>) => {
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

// A diagnose asks the qemu server nothing, so none listens at --server-url.
const flags = (port: number) => [
  "--port",
  String(port),
  "--name",
  NAME,
  "--url",
  CLIENT_URL,
  "--max-jobs",
  "1",
  "--server-url",
  "http://127.0.0.1:1",
];

// What the automation server's listLiveServers reads: a client heard from in the last 45 seconds.
const LIVE_CLIENTS =
  "select url, name from servers where type = 'automation-client' and heartbeat_at > now() - interval '45 seconds'";
const READINGS = "select name, type, jobs from process_stats";

describe("the automation client as a process", () => {
  it("listens on --port behind the bearer, announces itself as a live automation client under --name and --url, holds a reserve, runs until SIGTERM, lets the job go, takes its row back, says it stopped and exits 0, each line stored (happy)", async () => {
    const fake = await started();
    const port = await freePort();
    const running = automationClient(flags(port), {
      DATABASE_URL: fake.url,
      OLIGARCHY_TOKEN: TOKEN,
    });

    await vi.waitFor(() => expect(running.lines()).toContain(startedLine(port)), {
      timeout: 15_000,
    });
    await vi.waitFor(async () => expect(await query(fake.url, READINGS)).toHaveLength(1));
    expect(await query(fake.url, LIVE_CLIENTS)).toEqual([{ url: CLIENT_URL, name: NAME }]);
    const reserve = (headers: Readonly<Record<string, string>>) =>
      fetch(`http://127.0.0.1:${String(port)}/reserve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ jobId: "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11", action: "diagnose" }),
      });
    expect((await reserve({})).status).toBe(401);
    expect((await reserve({ Authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    expect(running.child.exitCode).toBe(null);
    running.child.kill("SIGTERM");

    expect(await running.exited).toBe(0);
    expect(running.lines()).toEqual([startedLine(port), STOPPED]);
    expect(await query(fake.url, "select url from servers")).toEqual([]);
    expect(await query(fake.url, READINGS)).toEqual([
      { name: NAME, type: "automation-client", jobs: 0 },
    ]);
    expect(await query(fake.url, "select level, location, text from logs order by id")).toEqual([
      { level: "info", location: "automation-client", text: startedText(port) },
      { level: "info", location: "automation-client", text: "stopped; SIGTERM received" },
    ]);
  });

  it("with no --url, refuses to start: says so on stderr, serves nothing, writes no row and exits 1 (unhappy)", async () => {
    const fake = await started();
    const port = await freePort();
    const running = automationClient(["--port", String(port), "--name", NAME, "--max-jobs", "1"], {
      DATABASE_URL: fake.url,
      OLIGARCHY_TOKEN: TOKEN,
    });

    expect(await running.exited).toBe(1);
    expect(running.stderr()).toBe("--url is required\n");
    expect(running.lines()).toEqual([]);
    expect(await query(fake.url, "select url from servers")).toEqual([]);
    expect(await query(fake.url, "select text from logs")).toEqual([]);
  });

  it("with its port already taken, says it could not listen and exits 1, announcing nothing (unhappy)", async () => {
    const fake = await started();
    const { port } = await held();

    const running = automationClient(flags(port), {
      DATABASE_URL: fake.url,
      OLIGARCHY_TOKEN: TOKEN,
    });

    expect(await running.exited).toBe(1);
    const lines = running.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      new RegExp(
        `^\\[FATAL\\] \\[global\\] automation-client: could not listen on 127\\.0\\.0\\.1:${String(port)}: .*EADDRINUSE`,
      ),
    );
    expect(await query(fake.url, "select url from servers")).toEqual([]);
    expect(await query(fake.url, READINGS)).toEqual([]);
  });

  it("with the database gone, says its heartbeat failed, still stops on SIGTERM and exits 0 (unhappy)", async () => {
    const fake = await started();
    await fake.stop();
    const port = await freePort();
    const running = automationClient(flags(port), {
      DATABASE_URL: fake.url,
      OLIGARCHY_TOKEN: TOKEN,
    });

    await vi.waitFor(
      () => expect(running.lines().some((line) => line.startsWith(HEARTBEAT_FAILED))).toBe(true),
      { timeout: 15_000 },
    );
    running.child.kill("SIGTERM");

    expect(await running.exited).toBe(0);
    const lines = running.lines();
    expect(lines[0]).toBe(startedLine(port));
    expect(lines).toContain(STOPPED);
    expect(lines.find((line) => line.startsWith(HEARTBEAT_FAILED))).toContain("ECONNREFUSED");
  });

  it("with no DATABASE_URL, says so on stderr and exits 1 (unhappy)", async () => {
    const running = automationClient(flags(await freePort()), {
      OLIGARCHY_TOKEN: TOKEN,
    });

    expect(await running.exited).toBe(1);
    expect(running.stderr()).toBe("DATABASE_URL is not set\n");
    expect(running.lines()).toEqual([]);
  });
});
