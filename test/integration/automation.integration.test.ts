import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";

const AUTOMATION = fileURLToPath(new URL("../../automation", import.meta.url));
const WEBHOOK_SECRET = "whsec_test";
const EXIT_WITHIN_MS = 60_000;

const sign = (payload: string): string =>
  createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");

type Process = {
  readonly child: ChildProcess;
  // The process's HOME: an empty directory of its own, where the record file lands.
  readonly home: string;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  readonly waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<void>;
};

// Sentry is initialised by the wrapper's --import; a proxy nobody listens on keeps the test
// run's fatal lines out of the real project without touching the code under test. The service
// has no database, so a DATABASE_URL in the developer's environment is removed: it must not be
// what makes these pass.
const environment = (home: string, overrides: Record<string, string>): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    LINEAR_WEBHOOK_SECRET: WEBHOOK_SECRET,
    https_proxy: "http://127.0.0.1:1",
    http_proxy: "http://127.0.0.1:1",
    no_proxy: "",
    ...overrides,
  };
  delete env.FORCE_COLOR;
  delete env.DATABASE_URL;
  delete env.OLIGARCHY_TOKEN;
  return env;
};

// Each process runs in its own empty directory (no `.env` to read) that is also its HOME, so the
// record file is the test's own; removed once it has exited.
const spawnAutomation = (
  args: ReadonlyArray<string>,
  overrides: Record<string, string> = {},
): Process => {
  const dir = mkdtempSync(join(tmpdir(), "oligarchy-automation-test-"));
  const child = spawn(AUTOMATION, args, {
    cwd: dir,
    env: environment(dir, overrides),
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
      rmSync(dir, { recursive: true, force: true });
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
  return { child, home: dir, stdout: () => stdout, stderr: () => stderr, exited, waitFor };
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

  it.live("an occupied port exits 1 with EADDRINUSE", () =>
    Effect.promise(async () => {
      const { port, release } = await occupy();
      try {
        const process = spawnAutomation(["--port", String(port)]);
        const { code } = await process.exited;
        expect(code).toBe(1);
        const fatal = lines(process.stdout()).find((line) =>
          line.startsWith("[global] fatal: automation: "),
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

describe("automation serving", () => {
  const served = async (signal: "SIGINT" | "SIGTERM") => {
    const port = await freePort();
    const process = spawnAutomation(["--port", String(port)]);
    const record = join(process.home, "automation-logs");
    try {
      await process.waitFor(/oligarchy automation listening/);
      expect(lines(process.stdout())).toContain(
        `[global] oligarchy automation listening on 127.0.0.1:${String(port)}; recording to ./automation-logs`,
      );
      expect(existsSync(record)).toBe(false);

      const incomplete = await request(
        port,
        "POST",
        "/automate",
        { "content-type": "application/json" },
        '{"ticket":"OLI-1"}',
      );
      expect(incomplete.status).toBe(400);
      expect(await incomplete.json()).toMatchObject({
        error: expect.stringContaining('["model"]'),
      });
      expect(existsSync(record)).toBe(false);

      const first = await request(
        port,
        "POST",
        "/automate",
        { "content-type": "application/json" },
        '{"ticket":"OLI-1","model":"grok-4.6"}',
      );
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toContain("application/json");
      expect(await first.json()).toEqual({ ok: "true" });
      const second = await request(
        port,
        "POST",
        "/automate",
        { "content-type": "application/json" },
        '{"ticket":"OLI-2","model":"claude-opus-5"}',
      );
      expect(second.status).toBe(200);
      expect(readFileSync(record, "utf8")).toBe(
        "linear ticket OLI-1; model grok-4.6\nlinear ticket OLI-2; model claude-opus-5\n",
      );

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
      expect(readFileSync(record, "utf8")).toBe(
        "linear ticket OLI-1; model grok-4.6\nlinear ticket OLI-2; model claude-opus-5\n",
      );

      const signed = await request(
        port,
        "POST",
        "/linear",
        { "content-type": "application/json", "linear-signature": sign(webhookBody) },
        webhookBody,
      );
      expect(signed.status).toBe(200);
      expect(await signed.json()).toEqual({ ok: "true" });
      expect(readFileSync(record, "utf8")).toBe(
        `linear ticket OLI-1; model grok-4.6\nlinear ticket OLI-2; model claude-opus-5\n${webhookBody}\n`,
      );

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
    // The schema's detail spans two lines: the missing key, then where.
    expect(output).toContain("[global] error: POST /automate failed: Missing key");
    expect(output).toContain('  at ["model"]');
    expect(output).toContain("[OLI-1] automation recorded; grok-4.6");
    expect(output).toContain("[OLI-2] automation recorded; claude-opus-5");
    expect(output).toContain("[global] error: POST /linear failed: unauthorized");
    expect(output).toContain("[global] linear webhook recorded");
    expect(output.some((line) => line.includes("/start"))).toBe(false);
    expect(process.stderr()).toBe("");

    await expect(request(port, "GET", "/automate")).rejects.toThrow();
  };

  it.live(
    "listens without a database, records /automate and a signed /linear, answers 401, 400 and 404, and exits 0 on SIGINT",
    () => Effect.promise(() => served("SIGINT")),
    120_000,
  );

  it.live("exits 0 on SIGTERM", () => Effect.promise(() => served("SIGTERM")), 120_000);
});
