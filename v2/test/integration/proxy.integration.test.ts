import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";

const SERVER = fileURLToPath(new URL("../../../server", import.meta.url));
const TOKEN = "t";
const UNREACHABLE = "postgres://user:sentinel-pw@127.0.0.1:1/oligarchy";
const EXIT_WITHIN_MS = 60_000;

const dbUrl = inject("dbUrl");

const onPath = (binary: string): boolean =>
  (process.env.PATH ?? "").split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, binary), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

const readable = (path: string, mode = constants.R_OK): boolean => {
  try {
    accessSync(path, mode);
    return true;
  } catch {
    return false;
  }
};

const hasQemu =
  onPath("qemu-system-x86_64") &&
  onPath("qemu-img") &&
  readable("/dev/kvm", constants.R_OK | constants.W_OK) &&
  readable("/usr/share/edk2/x64/OVMF_CODE.4m.fd") &&
  readable("/usr/share/edk2/x64/OVMF_VARS.4m.fd");

type Proxy = {
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

// Each proxy runs in its own empty directory (no `.env` to read), removed once it has exited.
const spawnProxy = (
  args: ReadonlyArray<string>,
  overrides: Record<string, string> | ((dir: string) => Record<string, string>) = {},
): Proxy => {
  const dir = mkdtempSync(join(tmpdir(), "oligarchy-proxy-test-"));
  const child = spawn(SERVER, args, {
    cwd: dir,
    env: environment(typeof overrides === "function" ? overrides(dir) : overrides),
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
              `proxy exited ${String(child.exitCode)} before ${pattern.source}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
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

// A PATH holding only what the wrapper needs to start, so qemu is not on it.
const pathWithoutQemu = (parent: string): string => {
  const dir = join(parent, "bin");
  mkdirSync(dir);
  symlinkSync(process.execPath, join(dir, "node"));
  for (const binary of ["dirname", "sh", "which", "env"]) {
    const found = (process.env.PATH ?? "")
      .split(delimiter)
      .map((candidate) => join(candidate, binary))
      .find((candidate) => readable(candidate, constants.X_OK));
    if (found !== undefined) {
      symlinkSync(found, join(dir, binary));
    }
  }
  return dir;
};

const request = (
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
) => fetch(`http://127.0.0.1:${String(port)}${path}`, { method, headers });

describe("proxy startup refusals", () => {
  it.live("--automation --display none exits 1 with --automation is exclusive", () =>
    Effect.promise(async () => {
      const proxy = spawnProxy(["--automation", "--display", "none"]);
      const { code } = await proxy.exited;
      expect(code).toBe(1);
      expect(proxy.stderr()).toContain("--automation is exclusive");
      expect(proxy.stdout()).not.toContain("fatal");
      expect(proxy.stdout()).not.toContain("listening");
    }),
  );

  it.live("an unknown --display value exits 1 with a usage error", () =>
    Effect.promise(async () => {
      const proxy = spawnProxy(["--display", "curses"]);
      const { code } = await proxy.exited;
      expect(code).toBe(1);
      expect(proxy.stderr()).toContain("curses");
      expect(proxy.stdout()).not.toContain("listening");
    }),
  );

  it.live("--help exits 0 and lists the three flags", () =>
    Effect.promise(async () => {
      const proxy = spawnProxy(["--help"]);
      const { code } = await proxy.exited;
      expect(code).toBe(0);
      expect(proxy.stdout()).toContain("--display");
      expect(proxy.stdout()).toContain("--automation");
      expect(proxy.stdout()).toContain("--port");
    }),
  );

  it.live("a missing OLIGARCHY_TOKEN exits 1 with OLIGARCHY_TOKEN is not set", () =>
    Effect.promise(async () => {
      const proxy = spawnProxy([], { OLIGARCHY_TOKEN: "" });
      const { code } = await proxy.exited;
      expect(code).toBe(1);
      expect(proxy.stderr()).toContain("OLIGARCHY_TOKEN is not set");
      expect(proxy.stderr()).not.toContain("sentinel-pw");
    }),
  );

  it.live.skipIf(dbUrl === "")(
    "missing host requirements exit 1 with the fatal line last on stdout",
    () =>
      Effect.promise(async () => {
        const proxy = spawnProxy([], (dir) => ({ PATH: pathWithoutQemu(dir) }));
        const { code } = await proxy.exited;
        expect(code).toBe(1);
        const output = lines(proxy.stdout());
        const fatal = output.findIndex(
          (line) => line === "[global] fatal: proxy: missing host requirements:",
        );
        expect(fatal, proxy.stdout()).toBeGreaterThanOrEqual(0);
        expect(output.slice(fatal + 1).length).toBeGreaterThan(0);
        expect(output.slice(fatal + 1)).toContain("qemu-system-x86_64 not on PATH");
        expect(output.slice(fatal + 1).every((line) => !line.startsWith("["))).toBe(true);
        expect(proxy.stdout()).not.toContain("listening");
      }),
  );

  it.live.skipIf(!hasQemu)("an unreachable database exits 1 with database unreachable", () =>
    Effect.promise(async () => {
      const proxy = spawnProxy([], { DATABASE_URL: UNREACHABLE });
      const { code } = await proxy.exited;
      expect(code).toBe(1);
      const fatal = lines(proxy.stdout()).find((line) =>
        line.startsWith("[global] fatal: proxy: database unreachable:"),
      );
      expect(fatal, proxy.stdout()).toBeDefined();
      expect(fatal).toContain("ECONNREFUSED");
      expect(proxy.stdout()).not.toContain("sentinel-pw");
      expect(proxy.stderr()).not.toContain("sentinel-pw");
      expect(proxy.stdout()).not.toContain("listening");
    }),
  );

  it.live.skipIf(!hasQemu || dbUrl === "")("an occupied port exits 1 with EADDRINUSE", () =>
    Effect.promise(async () => {
      const { port, release } = await occupy();
      try {
        const proxy = spawnProxy(["--port", String(port)]);
        const { code } = await proxy.exited;
        expect(code).toBe(1);
        const fatal = lines(proxy.stdout()).find((line) =>
          line.startsWith("[global] fatal: proxy: "),
        );
        expect(fatal, proxy.stdout()).toBeDefined();
        expect(fatal).toContain("EADDRINUSE");
        expect(fatal).toContain(`127.0.0.1:${String(port)}`);
      } finally {
        await release();
      }
    }),
  );
});

describe("proxy serving", () => {
  const serving = (
    args: ReadonlyArray<string>,
    listenLine: (port: number) => string,
    signal: "SIGINT" | "SIGTERM",
  ) =>
    Effect.promise(async () => {
      const port = await freePort();
      const proxy = spawnProxy([...args, "--port", String(port)]);
      await proxy.waitFor(/oligarchy proxy listening/);
      expect(lines(proxy.stdout())).toContain(listenLine(port));

      const stats = await request(port, "GET", "/stats", { authorization: `Bearer ${TOKEN}` });
      expect(stats.status).toBe(200);
      expect(stats.headers.get("content-type")).toContain("application/json");
      const body: unknown = await stats.json();
      expect(body).toMatchObject({
        qemus: 0,
        memory: {
          totalBytes: expect.any(Number),
          usedBytes: expect.any(Number),
          freeBytes: expect.any(Number),
        },
        cpu: {
          cores: expect.any(Number),
          mean: expect.any(Number),
          p10: expect.any(Number),
          p25: expect.any(Number),
          p75: expect.any(Number),
          p90: expect.any(Number),
        },
      });

      const image = await request(port, "GET", `/images/${crypto.randomUUID()}`);
      expect(image.status).toBe(404);
      expect(await image.json()).toEqual({ error: "not found" });

      const nope = await request(port, "GET", "/nope");
      expect(nope.status).toBe(404);
      expect(await nope.json()).toEqual({ error: "not found" });

      const unauthorized = await request(port, "POST", "/send-keys");
      expect(unauthorized.status).toBe(401);
      expect(await unauthorized.json()).toEqual({ error: "unauthorized" });

      const wrong = await request(port, "GET", "/stats", { authorization: "Bearer nope" });
      expect(wrong.status).toBe(401);

      proxy.child.kill(signal);
      const { code } = await proxy.exited;
      expect(code, proxy.stdout()).toBe(0);
      const output = lines(proxy.stdout());
      expect(output).toContain("[global] proxy: shutting down; stopping 0 sessions");
      expect(output).toContain("[global] error: POST /send-keys failed: unauthorized");
      expect(output).toContain("[global] error: GET /stats failed: unauthorized");
      expect(output.some((line) => line.includes("GET /nope"))).toBe(false);
      expect(proxy.stderr()).toBe("");

      await expect(request(port, "GET", "/stats")).rejects.toThrow();
    });

  it.live.skipIf(!hasQemu || dbUrl === "")(
    "listens, answers /stats, 401 and 404, and exits 0 on SIGINT",
    () =>
      serving(
        [],
        (port) => `[global] oligarchy proxy listening on 127.0.0.1:${String(port)}; display none`,
        "SIGINT",
      ),
    120_000,
  );

  it.live.skipIf(!hasQemu || dbUrl === "")(
    "--automation announces itself on the listen line and exits 0 on SIGTERM",
    () =>
      serving(
        ["--automation"],
        (port) =>
          `[global] oligarchy proxy listening on 127.0.0.1:${String(port)}; display none; automation`,
        "SIGTERM",
      ),
    120_000,
  );
});
