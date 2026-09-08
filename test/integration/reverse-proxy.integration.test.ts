import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as Client from "../../src/db/client.ts";
import * as DbSchema from "../../src/db/schema.ts";
import * as Postgres from "../support/postgres.ts";

const REVERSE_PROXY = fileURLToPath(new URL("../../reverse-proxy", import.meta.url));
const TOKEN = "t";
const UNREACHABLE = "postgres://user:sentinel-pw@127.0.0.1:1/oligarchy";
const EXIT_WITHIN_MS = 60_000;

const dbUrl = inject("dbUrl");

type Process = {
  readonly child: ChildProcess;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  readonly waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<void>;
};

// Sentry is initialised by the wrapper's --import; a proxy nobody listens on keeps the test
// run's fatal lines out of the real project without touching the code under test.
const environment = (overrides: Record<string, string>): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OLIGARCHY_TOKEN: TOKEN,
    DATABASE_URL: dbUrl === "" ? UNREACHABLE : dbUrl,
    https_proxy: "http://127.0.0.1:1",
    http_proxy: "http://127.0.0.1:1",
    no_proxy: "",
    ...overrides,
  };
  delete env.FORCE_COLOR;
  return env;
};

// Each process runs in its own empty directory (no `.env` to read), removed once it has exited.
const spawnReverseProxy = (
  args: ReadonlyArray<string>,
  overrides: Record<string, string> = {},
): Process => {
  const dir = mkdtempSync(join(tmpdir(), "oligarchy-reverse-proxy-test-"));
  const child = spawn(REVERSE_PROXY, args, {
    cwd: dir,
    env: environment(overrides),
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
              `reverse proxy exited ${String(child.exitCode)} before ${pattern.source}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
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
  return { child, stdout: () => stdout, stderr: () => stderr, exited, waitFor };
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

describe("reverse proxy startup refusals", () => {
  it.live("--help exits 0 and lists --port and --diagnostics-port", () =>
    Effect.promise(async () => {
      const process = spawnReverseProxy(["--help"]);
      const { code } = await process.exited;
      expect(code).toBe(0);
      expect(process.stdout()).toContain("--port");
      expect(process.stdout()).toContain("--diagnostics-port");
      expect(process.stdout()).not.toContain("--display");
      expect(process.stdout()).not.toContain("--automation");
    }),
  );

  it.live("a --port that is not an integer exits 1 with a usage error", () =>
    Effect.promise(async () => {
      const process = spawnReverseProxy(["--port", "forty"]);
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("forty");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("a missing OLIGARCHY_TOKEN exits 1 with OLIGARCHY_TOKEN is not set", () =>
    Effect.promise(async () => {
      const process = spawnReverseProxy([], { OLIGARCHY_TOKEN: "" });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("OLIGARCHY_TOKEN is not set");
      expect(process.stderr()).not.toContain("sentinel-pw");
    }),
  );

  it.live("an unreachable database exits 1 with the fatal line and never the password", () =>
    Effect.promise(async () => {
      const process = spawnReverseProxy([], { DATABASE_URL: UNREACHABLE });
      const { code } = await process.exited;
      expect(code).toBe(1);
      const fatal = lines(process.stdout()).find((line) =>
        line.startsWith("[global] fatal: reverse proxy: database unreachable:"),
      );
      expect(fatal, process.stdout()).toBeDefined();
      expect(fatal).toContain("ECONNREFUSED");
      expect(process.stdout()).not.toContain("sentinel-pw");
      expect(process.stderr()).not.toContain("sentinel-pw");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  // The other listener gets a free port, so only the occupied one can fail the bind.
  const occupied = (flag: "--port" | "--diagnostics-port") =>
    Effect.promise(async () => {
      const { port, release } = await occupy();
      const other = flag === "--port" ? "--diagnostics-port" : "--port";
      try {
        const process = spawnReverseProxy([flag, String(port), other, String(await freePort())]);
        const { code } = await process.exited;
        expect(code).toBe(1);
        const fatal = lines(process.stdout()).find((line) =>
          line.startsWith("[global] fatal: reverse proxy: "),
        );
        expect(fatal, process.stdout()).toBeDefined();
        expect(fatal).toContain("EADDRINUSE");
        expect(fatal).toContain(`127.0.0.1:${String(port)}`);
        expect(process.stdout()).not.toContain("listening");
      } finally {
        await release();
      }
    });

  it.live.skipIf(dbUrl === "")("an occupied port exits 1 with EADDRINUSE", () =>
    occupied("--port"),
  );

  it.live.skipIf(dbUrl === "")("an occupied diagnostics port exits 1 with EADDRINUSE too", () =>
    occupied("--diagnostics-port"),
  );
});

// The integration files share one database; the empty fleet this test expects is its own to
// arrange.
const forgetEveryServer = Effect.gen(function* () {
  const database = yield* Client.Database;
  yield* database.run("forgetEveryServer", (db) => db.delete(DbSchema.servers));
}).pipe(Effect.provide(Postgres.DatabaseLive(dbUrl)));

describe("reverse proxy serving", () => {
  const serving = (signal: "SIGINT" | "SIGTERM") =>
    forgetEveryServer.pipe(Effect.andThen(Effect.promise(() => served(signal))));

  const served = async (signal: "SIGINT" | "SIGTERM") => {
    const port = await freePort();
    const diagnosticsPort = await freePort();
    const process = spawnReverseProxy([
      "--port",
      String(port),
      "--diagnostics-port",
      String(diagnosticsPort),
    ]);
    try {
      await process.waitFor(/oligarchy reverse proxy listening/);
      expect(lines(process.stdout())).toContain(
        `[global] oligarchy reverse proxy listening on 127.0.0.1:${String(port)}; diagnostics on 127.0.0.1:${String(diagnosticsPort)}`,
      );

      // The diagnostics page: no token, the empty fleet, and a dead server refused on the page.
      const page = await request(diagnosticsPort, "GET", "/");
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      const html = await page.text();
      expect(html).toContain("<h1>oligarchy reverse proxy</h1>");
      expect(html).toContain("no servers registered");
      const dead = await request(
        diagnosticsPort,
        "POST",
        "/servers",
        { "content-type": "application/x-www-form-urlencoded" },
        "url=http%3A%2F%2F127.0.0.1%3A1",
      );
      expect(dead.status).toBe(502);
      expect(await dead.text()).toContain(
        "server http://127.0.0.1:1 unreachable: connect ECONNREFUSED",
      );
      const apiOnDiagnostics = await request(diagnosticsPort, "GET", "/servers");
      expect(apiOnDiagnostics.status).toBe(404);

      const servers = await request(port, "GET", "/servers", {
        authorization: `Bearer ${TOKEN}`,
      });
      expect(servers.status).toBe(200);
      expect(servers.headers.get("content-type")).toContain("application/json");
      expect(await servers.json()).toEqual({ servers: [] });

      const stats = await request(port, "GET", "/stats", { authorization: `Bearer ${TOKEN}` });
      expect(stats.status).toBe(404);
      expect(await stats.json()).toEqual({ error: "not found" });

      const image = await request(port, "GET", `/images/${crypto.randomUUID()}`);
      expect(image.status).toBe(404);

      const unauthorized = await request(port, "POST", "/send-keys");
      expect(unauthorized.status).toBe(401);
      expect(await unauthorized.json()).toEqual({ error: "unauthorized" });

      // Nothing is registered in the fresh database: a start has nowhere to go.
      const noServer = await request(
        port,
        "POST",
        "/start",
        { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        '{"iso":"omarchy.iso","agent":"OLI-1"}',
      );
      expect(noServer.status).toBe(503);
      expect(await noServer.json()).toEqual({ error: "no server registered" });
    } finally {
      // A failed expectation must not leave the process listening past the test.
      process.child.kill(signal);
    }
    const { code } = await process.exited;
    expect(code, process.stdout()).toBe(0);
    const output = lines(process.stdout());
    expect(output).toContain("[global] error: POST /send-keys failed: unauthorized");
    expect(output).toContain("[OLI-1] error: POST /start failed: no server registered");
    expect(
      output.some((line) =>
        line.startsWith(
          "[global] error: POST /servers failed: server http://127.0.0.1:1 unreachable:",
        ),
      ),
    ).toBe(true);
    expect(output.some((line) => line.includes("GET /stats"))).toBe(false);
    expect(output.some((line) => line.includes("/images/"))).toBe(false);
    expect(process.stderr()).toBe("");

    await expect(request(port, "GET", "/servers")).rejects.toThrow();
    await expect(request(diagnosticsPort, "GET", "/")).rejects.toThrow();
  };

  it.live.skipIf(dbUrl === "")(
    "listens, answers /servers, 401 and 404, and exits 0 on SIGINT",
    () => serving("SIGINT"),
    120_000,
  );

  it.live.skipIf(dbUrl === "")("exits 0 on SIGTERM", () => serving("SIGTERM"), 120_000);
});
