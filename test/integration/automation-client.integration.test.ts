import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { kill } from "node:process";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as OpenCode from "../../src/automation-client/opencode.ts";
import * as DbSchema from "../../src/db/schema.ts";
import * as Postgres from "../support/postgres.ts";

const AUTOMATION_CLIENT = fileURLToPath(new URL("../../automation-client", import.meta.url));
const TOKEN = "t";
const UNREACHABLE = "postgres://user:sentinel-pw@127.0.0.1:1/oligarchy";
const EXIT_WITHIN_MS = 60_000;
const KEY = "OLI-45";
const PROMPT = "drive the guest to the lock screen";
const TEXT_LINE = JSON.stringify({
  type: "text",
  sessionID: "ses_synthetic_run",
  part: { text: "done" },
});

const dbUrl = inject("dbUrl");

type Process = {
  readonly child: ChildProcess;
  readonly home: string;
  readonly cwd: string;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  readonly waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<void>;
};

const environment = (
  home: string,
  overrides: Record<string, string>,
  pathPrefix?: string,
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    OLIGARCHY_TOKEN: TOKEN,
    DATABASE_URL: dbUrl === "" ? UNREACHABLE : dbUrl,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim(),
    https_proxy: "http://127.0.0.1:1",
    http_proxy: "http://127.0.0.1:1",
    no_proxy: "",
    ...overrides,
  };
  if (pathPrefix !== undefined) {
    env.PATH = `${pathPrefix}${delimiter}${process.env.PATH ?? ""}`;
  }
  delete env.FORCE_COLOR;
  return env;
};

const spawnAutomationClient = (
  args: ReadonlyArray<string>,
  overrides: Record<string, string> = {},
  pathPrefix?: string,
): Process => {
  const home = mkdtempSync(join(tmpdir(), "oligarchy-automation-client-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "oligarchy-automation-client-cwd-"));
  const child = spawn(AUTOMATION_CLIENT, args, {
    cwd,
    env: environment(home, overrides, pathPrefix),
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
  return { child, home, cwd, stdout: () => stdout, stderr: () => stderr, exited, waitFor };
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

const writeFakeOpencode = (script: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "oligarchy-fake-opencode-"));
  writeFileSync(join(dir, "opencode"), script, { mode: 0o755 });
  return dir;
};

const SUCCESS_OPENCODE = `#!/bin/sh
cat >/dev/null
sleep 3
printf '%s\\n' '${TEXT_LINE}'
`;

const FAIL_OPENCODE = `#!/bin/sh
cat >/dev/null
printf '%s\\n' '${JSON.stringify({
  type: "error",
  sessionID: "ses_fail",
  error: { name: "APIError", data: { message: "boom" } },
})}'
exit 1
`;

describe("automation client startup refusals", () => {
  it.live("--help exits 0", () =>
    Effect.promise(async () => {
      const process = spawnAutomationClient(["--help"]);
      const { code } = await process.exited;
      expect(code).toBe(0);
      expect(process.stdout()).toContain("automation-client");
      expect(process.stdout()).toContain("--port");
      expect(process.stdout()).toContain("--url");
    }),
  );

  it.live("--port forty exits 1", () =>
    Effect.promise(async () => {
      const process = spawnAutomationClient(["--port", "forty"]);
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("forty");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("an empty OLIGARCHY_TOKEN exits 1 with OLIGARCHY_TOKEN is not set", () =>
    Effect.promise(async () => {
      const process = spawnAutomationClient([], { OLIGARCHY_TOKEN: "" });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("OLIGARCHY_TOKEN is not set");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("an empty DATABASE_URL exits 1 with DATABASE_URL is not set", () =>
    Effect.promise(async () => {
      const process = spawnAutomationClient([], { DATABASE_URL: "" });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("DATABASE_URL is not set");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("no opencode on PATH exits 1 with the fatal line", () =>
    Effect.promise(async () => {
      const empty = mkdtempSync(join(tmpdir(), "oligarchy-empty-path-"));
      mkdirSync(empty, { recursive: true });
      const process = spawnAutomationClient([], {}, empty);
      const { code } = await process.exited;
      rmSync(empty, { recursive: true, force: true });
      expect(code).toBe(1);
      expect(process.stdout()).toContain(
        "automation-client: missing host requirements:\nopencode not on PATH",
      );
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("an unreachable database exits 1 and never listens", () =>
    Effect.promise(async () => {
      const bin = writeFakeOpencode("#!/bin/sh\nexit 0\n");
      const process = spawnAutomationClient([], { DATABASE_URL: UNREACHABLE }, bin);
      const { code } = await process.exited;
      rmSync(bin, { recursive: true, force: true });
      expect(code).toBe(1);
      const fatal = lines(process.stdout()).find((line) =>
        line.startsWith("[automation-client] automation-client: fatal: automation-client: "),
      );
      expect(fatal, process.stdout()).toBeDefined();
      expect(fatal).toContain("database unreachable");
      expect(process.stdout()).not.toContain("listening");
    }),
  );
});

const describeWithDatabase = dbUrl === "" ? describe.skip : describe;

const serverRow = async (url: string) => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    const [row] = await db.select().from(DbSchema.servers).where(eq(DbSchema.servers.url, url));
    return row;
  } finally {
    await client.end();
  }
};

const logsFor = async (location: string) => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    return await db.select().from(DbSchema.logs).where(eq(DbSchema.logs.location, location));
  } finally {
    await client.end();
  }
};

const jobCount = async () => {
  const client = new Client({ connectionString: Postgres.getDbUrl() });
  await client.connect();
  try {
    const db = drizzle({ client, schema: DbSchema });
    return (await db.select().from(DbSchema.automationJobs)).length;
  } finally {
    await client.end();
  }
};

describeWithDatabase("automation client startup refusals with a database", () => {
  it.live("an occupied port exits 1 with EADDRINUSE", () =>
    Effect.promise(async () => {
      const bin = writeFakeOpencode("#!/bin/sh\nexit 0\n");
      const { port, release } = await occupy();
      try {
        const process = spawnAutomationClient(["--port", String(port)], {}, bin);
        const { code } = await process.exited;
        expect(code).toBe(1);
        const fatal = lines(process.stdout()).find((line) =>
          line.startsWith("[automation-client] automation-client: fatal: automation-client: "),
        );
        expect(fatal, process.stdout()).toBeDefined();
        expect(fatal).toContain("EADDRINUSE");
        expect(process.stdout()).not.toContain("listening");
      } finally {
        await release();
        rmSync(bin, { recursive: true, force: true });
      }
    }),
  );
});

describeWithDatabase("automation client serving", () => {
  it.live("listens, runs a fake opencode, heartbeats, and refuses a missing bearer", () =>
    Effect.promise(async () => {
      const bin = writeFakeOpencode(SUCCESS_OPENCODE);
      const port = await freePort();
      const url = `http://127.0.0.1:${String(port)}`;
      const jobsBefore = await jobCount();
      const process = spawnAutomationClient(["--port", String(port), "--url", url], {}, bin);
      try {
        await process.waitFor(/oligarchy automation client listening/);
        expect(lines(process.stdout())).toContain(
          `[automation-client] automation-client: oligarchy automation client listening on 127.0.0.1:${String(port)}; model ${OpenCode.MODEL}; announcing ${url}`,
        );

        const unauthorized = await request(
          port,
          "POST",
          "/run",
          { "content-type": "application/json" },
          JSON.stringify({ key: KEY, prompt: PROMPT }),
        );
        expect(unauthorized.status).toBe(401);
        expect(await unauthorized.json()).toEqual({ error: "unauthorized" });

        const started = Date.now();
        const pending = request(
          port,
          "POST",
          "/run",
          { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          JSON.stringify({ key: KEY, prompt: PROMPT }),
        );
        await process.waitFor(/run started;/);
        let during = await serverRow(url);
        const deadline = Date.now() + 2_000;
        while (
          (during?.stats === null ||
            during?.stats === undefined ||
            !("agents" in during.stats) ||
            during.stats.agents !== 1) &&
          Date.now() < deadline
        ) {
          await new Promise((wake) => setTimeout(wake, 50));
          during = await serverRow(url);
        }
        expect(during?.type).toBe("automation");
        expect(during?.stats && "agents" in during.stats ? during.stats.agents : undefined).toBe(1);

        const response = await pending;
        const elapsed = Date.now() - started;
        expect(elapsed).toBeGreaterThanOrEqual(2_500);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toEqual(
          expect.objectContaining({
            model: OpenCode.MODEL,
            session: "ses_synthetic_run",
            text: "done",
            elapsedMs: expect.any(Number),
          }),
        );
        if (
          typeof body === "object" &&
          body !== null &&
          "elapsedMs" in body &&
          typeof body.elapsedMs === "number"
        ) {
          expect(body.elapsedMs).toBeGreaterThanOrEqual(2_500);
        }

        expect(process.stdout()).toContain(`[OLI-45] automation-OLI-45: run started;`);
        const logRows = await logsFor("automation-OLI-45");
        expect(logRows.some((row) => row.text.startsWith("run started;"))).toBe(true);

        const after = await serverRow(url);
        expect(after?.type).toBe("automation");
        expect(after?.stats && "agents" in after.stats ? after.stats.agents : undefined).toBe(0);
        expect(after?.generation ?? 0).toBeGreaterThan(during?.generation ?? 0);
        expect(await jobCount()).toBe(jobsBefore);

        process.child.kill("SIGINT");
        const { code } = await process.exited;
        expect(code).toBe(0);
        await expect(request(port, "POST", "/run")).rejects.toThrow();
      } finally {
        if (process.child.exitCode === null && process.child.signalCode === null) {
          process.child.kill("SIGKILL");
          await process.exited;
        }
        rmSync(bin, { recursive: true, force: true });
      }
    }),
  );

  it.live("a fake that exits 1 is 502", () =>
    Effect.promise(async () => {
      const bin = writeFakeOpencode(FAIL_OPENCODE);
      const port = await freePort();
      const process = spawnAutomationClient(["--port", String(port)], {}, bin);
      try {
        await process.waitFor(/oligarchy automation client listening/);
        const response = await request(
          port,
          "POST",
          "/run",
          { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          JSON.stringify({ key: KEY, prompt: PROMPT }),
        );
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({
          error: "opencode: exited 1: boom",
        });
        process.child.kill("SIGINT");
        expect((await process.exited).code).toBe(0);
      } finally {
        if (process.child.exitCode === null && process.child.signalCode === null) {
          process.child.kill("SIGKILL");
          await process.exited;
        }
        rmSync(bin, { recursive: true, force: true });
      }
    }),
  );

  it.live("SIGTERM mid-run leaves no child, exits 0 and deletes the row", () =>
    Effect.promise(async () => {
      const pidFile = join(tmpdir(), `oligarchy-opencode-pid-${String(Date.now())}`);
      const bin = writeFakeOpencode(`#!/bin/sh
echo $$ > "$OPENCODE_PID_FILE"
cat >/dev/null
sleep 60
`);
      const port = await freePort();
      const url = `http://127.0.0.1:${String(port)}`;
      const process = spawnAutomationClient(
        ["--port", String(port), "--url", url],
        { OPENCODE_PID_FILE: pidFile },
        bin,
      );
      try {
        await process.waitFor(/oligarchy automation client listening/);
        const pending = request(
          port,
          "POST",
          "/run",
          { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          JSON.stringify({ key: KEY, prompt: PROMPT }),
        );
        await process.waitFor(/run started;/);
        const deadline = Date.now() + 5_000;
        while (!existsSync(pidFile) && Date.now() < deadline) {
          await new Promise((wake) => setTimeout(wake, 50));
        }
        expect(existsSync(pidFile)).toBe(true);
        const pid = Number(readFileSync(pidFile, "utf8"));
        process.child.kill("SIGTERM");
        const { code } = await process.exited;
        expect(code).toBe(0);
        await pending.catch(() => undefined);
        expect(() => kill(pid, 0)).toThrow();
        expect(await serverRow(url)).toBeUndefined();
      } finally {
        if (process.child.exitCode === null && process.child.signalCode === null) {
          process.child.kill("SIGKILL");
          await process.exited;
        }
        rmSync(bin, { recursive: true, force: true });
        rmSync(pidFile, { force: true });
      }
    }),
  );

  it.live("keeps serving when stdout and stderr cannot be written", () =>
    Effect.promise(async () => {
      const bin = writeFakeOpencode(SUCCESS_OPENCODE);
      const port = await freePort();
      const full = openSync("/dev/full", "w");
      const home = mkdtempSync(join(tmpdir(), "oligarchy-automation-client-full-home-"));
      const cwd = mkdtempSync(join(tmpdir(), "oligarchy-automation-client-full-cwd-"));
      const child = spawn(AUTOMATION_CLIENT, ["--port", String(port)], {
        cwd,
        env: environment(home, {}, bin),
        stdio: ["ignore", full, full],
      });
      const exited = new Promise<number | null>((resolve) => {
        child.on("close", (code) => {
          rmSync(cwd, { recursive: true, force: true });
          rmSync(home, { recursive: true, force: true });
          resolve(code);
        });
      });
      try {
        const deadline = Date.now() + 30_000;
        let up = false;
        while (!up && Date.now() < deadline) {
          up = await request(port, "POST", "/run", { authorization: `Bearer ${TOKEN}` })
            .then((response) => response.status === 400 || response.status === 401)
            .catch(() => false);
          if (!up) await new Promise((wake) => setTimeout(wake, 200));
        }
        expect(up).toBe(true);
        for (let i = 0; i < 20; i++) {
          expect((await request(port, "POST", "/run")).status).toBe(401);
        }
        await new Promise((wake) => setTimeout(wake, 500));
        expect(child.exitCode).toBeNull();
        child.kill("SIGTERM");
        expect(await exited).toBe(0);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await exited;
        }
        rmSync(bin, { recursive: true, force: true });
      }
    }),
  );
});
