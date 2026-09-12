import { spawn, type ChildProcess } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { describe, expect, inject } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Schedule } from "effect";
import * as Client from "../../src/db/client.ts";
import * as DbSchema from "../../src/db/schema.ts";
import * as Postgres from "../support/postgres.ts";

const QEMU_SERVER = fileURLToPath(new URL("../../qemu-server", import.meta.url));
const TOKEN = "t";
const UNREACHABLE = "postgres://user:sentinel-pw@127.0.0.1:1/oligarchy";
const EXIT_WITHIN_MS = 60_000;
// --max-jobs and --name have no default, so every server that should get past parsing carries both.
const MAX_JOBS: ReadonlyArray<string> = ["--max-jobs", "1"];
const NAME: ReadonlyArray<string> = ["--name", "garage"];
const REQUIRED: ReadonlyArray<string> = [...MAX_JOBS, ...NAME];

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

type QemuServer = {
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

// Each qemu server runs in its own empty directory (no `.env` to read), removed once it has exited.
const spawnQemuServer = (
  args: ReadonlyArray<string>,
  overrides: Record<string, string> | ((dir: string) => Record<string, string>) = {},
): QemuServer => {
  const dir = mkdtempSync(join(tmpdir(), "oligarchy-qemu-server-test-"));
  const child = spawn(QEMU_SERVER, args, {
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
              `qemu server exited ${String(child.exitCode)} before ${pattern.source}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
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

describe("qemu server startup refusals", () => {
  it.live("--automation --display none exits 1 with --automation is exclusive", () =>
    Effect.promise(async () => {
      const server = spawnQemuServer([...REQUIRED, "--automation", "--display", "none"]);
      const { code } = await server.exited;
      expect(code).toBe(1);
      expect(server.stderr()).toContain("--automation is exclusive");
      expect(server.stdout()).not.toContain("fatal");
      expect(server.stdout()).not.toContain("listening");
    }),
  );

  it.live("an unknown --display value exits 1 with a usage error", () =>
    Effect.promise(async () => {
      const server = spawnQemuServer([...REQUIRED, "--display", "curses"]);
      const { code } = await server.exited;
      expect(code).toBe(1);
      expect(server.stderr()).toContain("curses");
      expect(server.stdout()).not.toContain("listening");
    }),
  );

  it.live("a missing --max-jobs exits 1 with the usage error and never listens", () =>
    Effect.promise(async () => {
      const server = spawnQemuServer([...NAME, "--automation"]);
      const { code } = await server.exited;
      expect(code).toBe(1);
      expect(server.stderr()).toContain("Missing required flag: --max-jobs");
      expect(server.stdout()).not.toContain("listening");
    }),
  );

  it.live("a missing --name exits 1 with the usage error and never listens", () =>
    Effect.promise(async () => {
      const server = spawnQemuServer([...MAX_JOBS, "--automation"]);
      const { code } = await server.exited;
      expect(code).toBe(1);
      expect(server.stderr()).toContain("Missing required flag: --name");
      expect(server.stdout()).not.toContain("listening");
    }),
  );

  it.live("--max-jobs 0 exits 1 with the rule", () =>
    Effect.promise(async () => {
      const server = spawnQemuServer([...NAME, "--max-jobs", "0"]);
      const { code } = await server.exited;
      expect(code).toBe(1);
      expect(server.stderr()).toContain("max-jobs must be at least 1");
      expect(server.stdout()).not.toContain("listening");
    }),
  );

  it.live("--help exits 0 and lists the six flags", () =>
    Effect.promise(async () => {
      const server = spawnQemuServer(["--help"]);
      const { code } = await server.exited;
      expect(code).toBe(0);
      expect(server.stdout()).toContain("qemu-server");
      expect(server.stdout()).toContain("--display");
      expect(server.stdout()).toContain("--automation");
      expect(server.stdout()).toContain("--max-jobs");
      expect(server.stdout()).toContain("--name");
      expect(server.stdout()).toContain("--port");
      expect(server.stdout()).toContain("--url");
    }),
  );

  it.live("a --url that is not an http or https url exits 1 with the rule", () =>
    Effect.promise(async () => {
      const server = spawnQemuServer([...REQUIRED, "--url", "ftp://qemu.example.com"]);
      const { code } = await server.exited;
      expect(code).toBe(1);
      expect(server.stderr()).toContain("url must be an http or https url");
      expect(server.stdout()).not.toContain("listening");
    }),
  );

  it.live("a missing OLIGARCHY_TOKEN exits 1 with OLIGARCHY_TOKEN is not set", () =>
    Effect.promise(async () => {
      const server = spawnQemuServer([...REQUIRED], { OLIGARCHY_TOKEN: "" });
      const { code } = await server.exited;
      expect(code).toBe(1);
      expect(server.stderr()).toContain("OLIGARCHY_TOKEN is not set");
      expect(server.stderr()).not.toContain("sentinel-pw");
    }),
  );

  it.live.skipIf(dbUrl === "")(
    "missing host requirements exit 1 with the fatal line last on stdout",
    () =>
      Effect.promise(async () => {
        const server = spawnQemuServer([...REQUIRED], (dir) => ({ PATH: pathWithoutQemu(dir) }));
        const { code } = await server.exited;
        expect(code).toBe(1);
        const output = lines(server.stdout());
        const fatal = output.findIndex(
          (line) => line === "[global] server: fatal: qemu server: missing host requirements:",
        );
        expect(fatal, server.stdout()).toBeGreaterThanOrEqual(0);
        expect(output.slice(fatal + 1).length).toBeGreaterThan(0);
        expect(output.slice(fatal + 1)).toContain("qemu-system-x86_64 not on PATH");
        expect(output.slice(fatal + 1).every((line) => !line.startsWith("["))).toBe(true);
        expect(server.stdout()).not.toContain("listening");
      }),
  );

  it.live.skipIf(!hasQemu)("an unreachable database exits 1 with database unreachable", () =>
    Effect.promise(async () => {
      const server = spawnQemuServer([...REQUIRED], { DATABASE_URL: UNREACHABLE });
      const { code } = await server.exited;
      expect(code).toBe(1);
      const fatal = lines(server.stdout()).find((line) =>
        line.startsWith("[global] server: fatal: qemu server: database unreachable:"),
      );
      expect(fatal, server.stdout()).toBeDefined();
      expect(fatal).toContain("ECONNREFUSED");
      expect(server.stdout()).not.toContain("sentinel-pw");
      expect(server.stderr()).not.toContain("sentinel-pw");
      expect(server.stdout()).not.toContain("listening");
    }),
  );

  it.live.skipIf(!hasQemu || dbUrl === "")("an occupied port exits 1 with EADDRINUSE", () =>
    Effect.promise(async () => {
      const { port, release } = await occupy();
      try {
        const server = spawnQemuServer([...REQUIRED, "--port", String(port)]);
        const { code } = await server.exited;
        expect(code).toBe(1);
        const fatal = lines(server.stdout()).find((line) =>
          line.startsWith("[global] server: fatal: qemu server: "),
        );
        expect(fatal, server.stdout()).toBeDefined();
        expect(fatal).toContain("EADDRINUSE");
        expect(fatal).toContain(`127.0.0.1:${String(port)}`);
      } finally {
        await release();
      }
    }),
  );
});

describe("qemu server serving", () => {
  const serving = (
    args: ReadonlyArray<string>,
    listenLine: (port: number) => string,
    signal: "SIGINT" | "SIGTERM",
  ) =>
    Effect.promise(async () => {
      const port = await freePort();
      const server = spawnQemuServer([...REQUIRED, ...args, "--port", String(port)]);
      await server.waitFor(/qemu server listening/);
      expect(lines(server.stdout())).toContain(listenLine(port));

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
          mean1m: expect.any(Number),
          mean2m: expect.any(Number),
          mean3m: expect.any(Number),
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

      server.child.kill(signal);
      const { code } = await server.exited;
      expect(code, server.stdout()).toBe(0);
      const output = lines(server.stdout());
      expect(output).toContain("[global] server: qemu server: shutting down; stopping 0 sessions");
      expect(output).toContain("[global] server: error: POST /send-keys failed: unauthorized");
      expect(output).toContain("[global] server: error: GET /stats failed: unauthorized");
      expect(output.some((line) => line.includes("GET /nope"))).toBe(false);
      expect(server.stderr()).toBe("");

      await expect(request(port, "GET", "/stats")).rejects.toThrow();
    });

  // A qemu server whose stdout is a file on a full disk: Node reports each failed log write as a stream
  // 'error' that, unhandled, is an uncaught exception per line and took a qemu server down under six
  // installs filling a tmpfs. The rows and Sentry are the record; the lines are dropped.
  it.live.skipIf(!hasQemu || dbUrl === "")(
    "keeps serving when stdout and stderr cannot be written",
    () =>
      Effect.promise(async () => {
        const port = await freePort();
        const full = openSync("/dev/full", "w");
        const dir = mkdtempSync(join(tmpdir(), "oligarchy-qemu-server-test-"));
        const child = spawn(QEMU_SERVER, [...REQUIRED, "--port", String(port)], {
          cwd: dir,
          env: environment({}),
          stdio: ["ignore", full, full],
        });
        const exited = new Promise<number | null>((resolve) => {
          child.on("close", (code) => {
            rmSync(dir, { recursive: true, force: true });
            resolve(code);
          });
        });
        try {
          const deadline = Date.now() + 30_000;
          let up = false;
          while (!up && Date.now() < deadline) {
            up = await request(port, "GET", "/stats", { authorization: `Bearer ${TOKEN}` })
              .then((response) => response.status === 200)
              .catch(() => false);
            if (!up) await new Promise((wake) => setTimeout(wake, 200));
          }
          expect(up).toBe(true);
          // Every refusal writes an error line to the dead stdout.
          for (let i = 0; i < 20; i++) {
            expect((await request(port, "POST", "/send-keys")).status).toBe(401);
          }
          await new Promise((wake) => setTimeout(wake, 500));
          expect(child.exitCode).toBeNull();
          expect(
            (await request(port, "GET", "/stats", { authorization: `Bearer ${TOKEN}` })).status,
          ).toBe(200);
          child.kill("SIGTERM");
          expect(await exited).toBe(0);
        } finally {
          closeSync(full);
          if (child.exitCode === null) child.kill("SIGKILL");
        }
      }),
    120_000,
  );

  it.live.skipIf(!hasQemu || dbUrl === "")(
    "listens, answers /stats, 401 and 404, and exits 0 on SIGINT",
    () =>
      serving(
        [],
        (port) =>
          `[global] server: qemu server listening on 127.0.0.1:${String(port)}; name garage; display none; max jobs 1`,
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
          `[global] server: qemu server listening on 127.0.0.1:${String(port)}; name garage; display none; automation; max jobs 1`,
        "SIGTERM",
      ),
    120_000,
  );

  // The row a server writes under --url, read through the Database service; undefined until the
  // first heartbeat lands.
  const announced = (url: string) =>
    Effect.gen(function* () {
      const database = yield* Client.Database;
      const rows = yield* database.run("announced", (db) =>
        db.select().from(DbSchema.servers).where(eq(DbSchema.servers.url, url)),
      );
      return rows[0];
    }).pipe(Effect.provide(Postgres.DatabaseLive(dbUrl)));

  const announcedProcess = (name: string) =>
    Effect.gen(function* () {
      const database = yield* Client.Database;
      const rows = yield* database.run("announcedProcess", (db) =>
        db.select().from(DbSchema.processStats).where(eq(DbSchema.processStats.name, name)),
      );
      return rows[0];
    }).pipe(Effect.provide(Postgres.DatabaseLive(dbUrl)));

  it.live.skipIf(!hasQemu || dbUrl === "")(
    "--url names the url on the listen line, writes the server's row as its first heartbeat, and deletes it on SIGTERM",
    () =>
      Effect.gen(function* () {
        const port = yield* Effect.promise(freePort);
        const url = `http://qemu-a.test:${String(port)}`;
        const name = `qemu-a-${String(port)}`;
        const server = spawnQemuServer([
          ...MAX_JOBS,
          "--name",
          name,
          "--automation",
          "--url",
          url,
          "--port",
          String(port),
        ]);
        const { row, reading } = yield* Effect.gen(function* () {
          yield* Effect.promise(() => server.waitFor(/qemu server listening/));
          expect(lines(server.stdout())).toContain(
            `[global] server: qemu server listening on 127.0.0.1:${String(port)}; name ${name}; display none; automation; max jobs 1; announcing ${url}`,
          );
          // The first heartbeat is written right after the listen line; the insert takes a moment.
          // process_stats is the second write, so waiting for it means the servers row is there.
          return {
            reading: yield* announcedProcess(name).pipe(
              Effect.repeat({
                until: (found) => found !== undefined,
                schedule: Schedule.spaced("200 millis"),
              }),
              Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => announcedProcess(name) }),
            ),
            row: yield* announced(url),
          };
        }).pipe(
          // A failed expectation must not leave the process listening past the test.
          Effect.ensuring(
            Effect.sync(() => {
              server.child.kill("SIGTERM");
            }),
          ),
        );
        expect(row).toMatchObject({
          url,
          name,
          type: "qemu",
          generation: 1,
          stats: { qemus: 0 },
        });
        expect(row?.heartbeatAt).toBeInstanceOf(Date);
        expect(reading).toMatchObject({ name, type: "qemu", jobs: 0, cpuPercent: 0 });
        expect(reading?.memoryBytes).toBeGreaterThan(0);
        expect(reading?.reportedAt).toBeInstanceOf(Date);
        const { code } = yield* Effect.promise(() => server.exited);
        expect(code, server.stdout()).toBe(0);
        expect(server.stdout()).not.toContain("heartbeat failed");
        expect(server.stdout()).not.toContain("process stats failed");
        expect(server.stdout()).not.toContain("unannounce failed");
        expect(yield* announced(url)).toBeUndefined();
        expect(yield* announcedProcess(name)).toMatchObject({
          name,
          type: "qemu",
          jobs: 0,
          cpuPercent: 0,
        });
      }),
    120_000,
  );
});
