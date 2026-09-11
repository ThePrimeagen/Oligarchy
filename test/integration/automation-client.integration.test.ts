import { spawn, type ChildProcess } from "node:child_process";
import { env as processEnv } from "node:process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { describe, expect, inject } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Schedule } from "effect";
import * as DbClient from "../../src/db/client.ts";
import * as DbSchema from "../../src/db/schema.ts";
import * as Postgres from "../support/postgres.ts";

const AUTOMATION_CLIENT = fileURLToPath(new URL("../../automation-client", import.meta.url));
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

const environment = (
  home: string,
  path: string,
  overrides: Record<string, string>,
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: path,
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

const spawnAutomationClient = (
  args: ReadonlyArray<string>,
  overrides: Record<string, string> = {},
  path = process.env.PATH ?? "",
): Process => {
  const home = mkdtempSync(join(tmpdir(), "oligarchy-automation-client-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "oligarchy-automation-client-cwd-"));
  const child = spawn(AUTOMATION_CLIENT, args, {
    cwd,
    env: environment(home, path, overrides),
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
              `automation client exited ${String(child.exitCode)} before ${pattern.source}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
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

const installOpencode = (script: string): string => {
  const bin = mkdtempSync(join(tmpdir(), "oligarchy-opencode-"));
  const file = join(bin, "opencode");
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return bin;
};

const MODEL = "opencode/muse-spark-1.3-contributor-free";

const lines = (output: string): ReadonlyArray<string> =>
  output.split("\n").filter((line) => line !== "");

const request = (port: number, headers: Record<string, string>, body: string) =>
  fetch(`http://127.0.0.1:${String(port)}/run`, { method: "POST", headers, body });

const logsForClient = async () => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    return await db
      .select()
      .from(DbSchema.logs)
      .where(eq(DbSchema.logs.location, "automation-client"));
  } finally {
    await client.end();
  }
};

describe("automation client startup refusals", () => {
  it.live("--help exits 0 and lists --port and --url", () =>
    Effect.promise(async () => {
      const process = spawnAutomationClient(["--help"]);
      const { code } = await process.exited;
      expect(code).toBe(0);
      expect(process.stdout()).toContain("automation-client");
      expect(process.stdout()).toContain("--port");
      expect(process.stdout()).toContain("--url");
      expect(process.stdout()).not.toContain("--display");
    }),
  );

  it.live("a --port that is not an integer exits 1 with a usage error", () =>
    Effect.promise(async () => {
      const process = spawnAutomationClient(["--port", "forty"]);
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("forty");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("a --url that is not an http or https url exits 1 with the rule", () =>
    Effect.promise(async () => {
      const process = spawnAutomationClient(["--url", "ftp://qemu.example.com"]);
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("url must be an http or https url");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("a missing OLIGARCHY_TOKEN exits 1 with OLIGARCHY_TOKEN is not set", () =>
    Effect.promise(async () => {
      const process = spawnAutomationClient([], { OLIGARCHY_TOKEN: "" });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("OLIGARCHY_TOKEN is not set");
      expect(process.stderr()).not.toContain("sentinel-pw");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("a missing DATABASE_URL exits 1 with DATABASE_URL is not set", () =>
    Effect.promise(async () => {
      const process = spawnAutomationClient([], { DATABASE_URL: "" });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("DATABASE_URL is not set");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("an unreachable database exits 1 and never listens", () =>
    Effect.promise(async () => {
      const process = spawnAutomationClient([], { DATABASE_URL: UNREACHABLE });
      const { code } = await process.exited;
      expect(code).toBe(1);
      const fatal = lines(process.stdout()).find((line) =>
        line.startsWith("[automation-client] automation-client: fatal: automation client: "),
      );
      expect(fatal, process.stdout()).toBeDefined();
      expect(fatal).toContain("database unreachable");
      expect(process.stdout()).not.toContain("sentinel-pw");
      expect(process.stderr()).not.toContain("sentinel-pw");
      expect(process.stdout()).not.toContain("listening");
    }),
  );
});

const describeWithDatabase = dbUrl === "" ? describe.skip : describe;

describeWithDatabase("automation client startup refusals with a database", () => {
  it.live("an occupied port exits 1 with EADDRINUSE", () =>
    Effect.promise(async () => {
      const { port, release } = await occupy();
      try {
        const process = spawnAutomationClient(["--port", String(port)]);
        const { code } = await process.exited;
        expect(code).toBe(1);
        const fatal = lines(process.stdout()).find((line) =>
          line.startsWith("[automation-client] automation-client: fatal: automation client: "),
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

describeWithDatabase("automation client POST /run", () => {
  it.live(
    "answers 200 when opencode exits 0, having run it with --model and the prompt, its transcript on this stdout",
    () =>
      Effect.promise(async () => {
        const bin = installOpencode(
          'printf "%s\\n" "$@" > "$(dirname "$0")/argv"; printf "%s" "$OPENCODE_CONFIG_CONTENT" > "$(dirname "$0")/config"; echo "transcript-sentinel: the agent spoke"; exit 0',
        );
        const port = await freePort();
        const process = spawnAutomationClient(
          ["--port", String(port)],
          {},
          `${bin}:${processEnv.PATH ?? ""}`,
        );
        try {
          await process.waitFor(
            new RegExp(`automation client listening on 127.0.0.1:${String(port)}`),
          );
          const response = await request(
            port,
            { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
            JSON.stringify({ prompt: "do the work", model: MODEL }),
          );
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ ok: "true" });
          expect(readFileSync(join(bin, "argv"), "utf8")).toBe(
            ["run", "--auto", "--model", MODEL, "--", "do the work", ""].join("\n"),
          );
          expect(process.stdout()).toContain("transcript-sentinel: the agent spoke");
          expect(JSON.parse(readFileSync(join(bin, "config"), "utf8"))).toEqual({
            permission: { external_directory: "allow", doom_loop: "allow" },
            provider: {
              openrouter: { options: { headerTimeout: 180_000, chunkTimeout: 180_000 } },
            },
          });
        } finally {
          process.child.kill("SIGTERM");
          await process.exited;
          rmSync(bin, { recursive: true, force: true });
        }
      }),
  );

  it.live("answers 500 with opencode's error when it exits non-zero", () =>
    Effect.promise(async () => {
      const bin = installOpencode("echo out of token credits >&2; exit 1");
      const port = await freePort();
      const process = spawnAutomationClient(
        ["--port", String(port)],
        {},
        `${bin}:${processEnv.PATH ?? ""}`,
      );
      try {
        await process.waitFor(
          new RegExp(`automation client listening on 127.0.0.1:${String(port)}`),
        );
        const response = await request(
          port,
          { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          JSON.stringify({ prompt: "do the work", model: MODEL }),
        );
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "out of token credits" });
      } finally {
        process.child.kill("SIGTERM");
        await process.exited;
        rmSync(bin, { recursive: true, force: true });
      }
    }),
  );

  it.live("answers 401 without the bearer and persists the error in logs", () =>
    Effect.promise(async () => {
      const bin = installOpencode("exit 0");
      const port = await freePort();
      const process = spawnAutomationClient(
        ["--port", String(port)],
        {},
        `${bin}:${processEnv.PATH ?? ""}`,
      );
      try {
        await process.waitFor(
          new RegExp(`automation client listening on 127.0.0.1:${String(port)}`),
        );
        const response = await request(
          port,
          { "content-type": "application/json" },
          JSON.stringify({ prompt: "do the work", model: MODEL }),
        );
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "unauthorized" });
        const rows = await logsForClient();
        expect(rows.some((row) => row.text.includes("POST /run failed: unauthorized"))).toBe(true);
      } finally {
        process.child.kill("SIGTERM");
        await process.exited;
        rmSync(bin, { recursive: true, force: true });
      }
    }),
  );
});

// The row a client writes under --url, read through the Database service; undefined until the
// first heartbeat lands.
const announced = (url: string) =>
  Effect.gen(function* () {
    const database = yield* DbClient.Database;
    const rows = yield* database.run("announced", (db) =>
      db.select().from(DbSchema.servers).where(eq(DbSchema.servers.url, url)),
    );
    return rows[0];
  }).pipe(Effect.provide(Postgres.DatabaseLive(dbUrl)));

describe("automation client announce", () => {
  it.live.skipIf(dbUrl === "")(
    "--url names the url on the listen line, writes the automation-client row as its first heartbeat, and deletes it on SIGTERM",
    () =>
      Effect.gen(function* () {
        const port = yield* Effect.promise(freePort);
        const url = `http://automation-client.test:${String(port)}`;
        const process = spawnAutomationClient(["--url", url, "--port", String(port)], {
          DATABASE_URL: dbUrl,
        });
        const row = yield* Effect.gen(function* () {
          yield* Effect.promise(() => process.waitFor(/automation client listening/));
          expect(process.stdout()).toContain(
            `automation client listening on 127.0.0.1:${String(port)}; announcing ${url}`,
          );
          return yield* announced(url).pipe(
            Effect.repeat({
              until: (found) => found !== undefined,
              schedule: Schedule.spaced("200 millis"),
            }),
            Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => announced(url) }),
          );
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              process.child.kill("SIGTERM");
            }),
          ),
        );
        expect(row).toMatchObject({
          url,
          type: "automation-client",
          generation: 1,
          stats: { qemus: 0 },
        });
        expect(row?.heartbeatAt).toBeInstanceOf(Date);
        const { code } = yield* Effect.promise(() => process.exited);
        expect(code, process.stdout()).toBe(0);
        expect(process.stdout()).not.toContain("heartbeat failed");
        expect(process.stdout()).not.toContain("unannounce failed");
        expect(yield* announced(url)).toBeUndefined();
      }),
    120_000,
  );
});
