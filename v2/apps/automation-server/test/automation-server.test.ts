import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as jarl from "jarl";
import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const { models } = JSON.parse(readFileSync(Env.CONFIG_PATH, "utf8"));
const STARTED = `[INFO] [global] automation-server: started; drive ${models.drive}; diagnose ${models.diagnose}; setup ${models.setup}`;
const STOPPED = "[INFO] [global] automation-server: stopped; SIGTERM received";

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

// The server as its own process, the way `bun run automation-server` starts it. A proxy nobody
// listens on refuses its requests to Sentry, so an error line it sends never reaches the real
// project.
const server = (env: Readonly<Record<string, string>>) => {
  const { DATABASE_URL: _, ...inherited } = process.env;
  const child = spawn(process.execPath, ["--no-env-file", MAIN], {
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
  it("says it started with its models, runs until SIGTERM, stops without waiting out the dispatch interval, says it stopped and exits 0, each line stored (happy)", async () => {
    const fake = await started();
    const running = server({ DATABASE_URL: fake.url });

    await vi.waitFor(() => expect(running.lines()).toContain(STARTED), { timeout: 15_000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(running.child.exitCode).toBe(null);
    const killedAt = Date.now();
    running.child.kill("SIGTERM");

    expect(await running.exited).toBe(0);
    expect(Date.now() - killedAt).toBeLessThan(5_000);
    expect(running.lines()).toEqual([STARTED, STOPPED]);
    expect(await query(fake.url, "select level, location, text from logs order by id")).toEqual([
      {
        level: "info",
        location: "automation-server",
        text: `started; drive ${models.drive}; diagnose ${models.diagnose}; setup ${models.setup}`,
      },
      { level: "info", location: "automation-server", text: "stopped; SIGTERM received" },
    ]);
  });

  it("with the database gone, still starts and stops on SIGTERM, each line followed by its refused insert (unhappy)", async () => {
    const fake = await started();
    await fake.stop();
    const running = server({ DATABASE_URL: fake.url });

    await vi.waitFor(() => expect(running.lines()).toContain(STARTED), { timeout: 15_000 });
    running.child.kill("SIGTERM");

    expect(await running.exited).toBe(0);
    const lines = running.lines();
    const refused = /^\[ERROR\] \[global\] db: log insert failed: /;
    expect(lines[0]).toBe(STARTED);
    expect(lines[1]).toMatch(refused);
    const stoppedAt = lines.indexOf(STOPPED);
    expect(stoppedAt).toBeGreaterThan(1);
    expect(lines[stoppedAt + 1]).toMatch(refused);
    expect(lines.join("\n")).toContain("ECONNREFUSED");
  });

  it("with no DATABASE_URL, says so on stderr and exits 1 (unhappy)", async () => {
    const running = server({});

    expect(await running.exited).toBe(1);
    expect(running.stderr()).toBe("DATABASE_URL is not set\n");
    expect(running.lines()).toEqual([]);
  });
});
