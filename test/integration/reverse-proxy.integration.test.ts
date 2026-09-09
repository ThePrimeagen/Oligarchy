import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
import * as StubCursor from "../support/stub-cursor.ts";

const REVERSE_PROXY = fileURLToPath(new URL("../../reverse-proxy", import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TOKEN = "t";
const CURSOR_TOKEN = "cursor-t";
const UNREACHABLE = "postgres://user:sentinel-pw@127.0.0.1:1/oligarchy";
const EXIT_WITHIN_MS = 60_000;

// The config file the reverse proxy looks for in its working directory, and what it says.
const CONFIG = ".reverse-proxy.oligarchy.json";
const CURSOR = '{ "agent-executable": "cursor" }\n';
const OPENCODE = '{ "agent-executable": "opencode" }\n';

const dbUrl = inject("dbUrl");

type Process = {
  readonly child: ChildProcess;
  readonly dir: string;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  readonly waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<void>;
};

// Sentry is initialised by the wrapper's --import; a proxy nobody listens on keeps the test
// run's fatal lines out of the real project without touching the code under test. The Cursor
// SDK is pointed at a stub the same way (CURSOR_BACKEND_URL), or at nothing.
const environment = (overrides: Record<string, string>): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OLIGARCHY_TOKEN: TOKEN,
    DATABASE_URL: dbUrl === "" ? UNREACHABLE : dbUrl,
    CURSOR_API_TOKEN: CURSOR_TOKEN,
    CURSOR_BACKEND_URL: "http://127.0.0.1:1",
    https_proxy: "http://127.0.0.1:1",
    http_proxy: "http://127.0.0.1:1",
    no_proxy: "",
    ...overrides,
  };
  delete env.FORCE_COLOR;
  return env;
};

// Each process runs in its own directory holding only the files the test writes (a config by
// default, never a `.env`), removed once it has exited.
const spawnReverseProxy = (
  args: ReadonlyArray<string>,
  options: {
    readonly env?: Record<string, string>;
    readonly files?: Record<string, string>;
  } = {},
): Process => {
  const dir = mkdtempSync(join(tmpdir(), "oligarchy-reverse-proxy-test-"));
  for (const [name, contents] of Object.entries(options.files ?? { [CONFIG]: CURSOR })) {
    writeFileSync(join(dir, name), contents);
  }
  const child = spawn(REVERSE_PROXY, args, {
    cwd: dir,
    env: environment(options.env ?? {}),
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
  return { child, dir, stdout: () => stdout, stderr: () => stderr, exited, waitFor };
};

// A PATH of the system's own utilities (the wrapper and the stand-in are shell scripts), this
// node (the wrapper needs it; the real one may sit under nvm) and, when asked, a stand-in for
// opencode: it records its pid, its argv and the prompt it was fed on stdin, says one event, and
// works until killed. The reverse proxy inherits OPENCODE_STUB, so each run knows where to write.
const stubBin = (options: { readonly opencode: boolean }) => {
  const dir = mkdtempSync(join(tmpdir(), "oligarchy-stub-bin-"));
  symlinkSync(process.execPath, join(dir, "node"));
  if (options.opencode) {
    writeFileSync(
      join(dir, "opencode"),
      [
        "#!/bin/sh",
        'echo "$$" >> "$OPENCODE_STUB/pids"',
        'printf \'%s\\n\' "$@" > "$OPENCODE_STUB/argv.$$"',
        'cat > "$OPENCODE_STUB/stdin.$$"',
        'printf \'{"type":"step_start","timestamp":1,"sessionID":"ses_stub%s"}\\n\' "$(wc -l < "$OPENCODE_STUB/pids" | tr -d \' \')"',
        "exec sleep 600",
        "",
      ].join("\n"),
    );
    chmodSync(join(dir, "opencode"), 0o755);
  }
  const records = mkdtempSync(join(tmpdir(), "oligarchy-stub-opencode-"));
  return {
    env: { PATH: `${dir}:/usr/bin:/bin`, OPENCODE_STUB: records },
    records,
    remove: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(records, { recursive: true, force: true });
    },
  };
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

const agentHeaders = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

describe("reverse proxy startup refusals", () => {
  it.live("--help exits 0 and lists --port, --diagnostics-port and --config", () =>
    Effect.promise(async () => {
      const process = spawnReverseProxy(["--help"], { files: {} });
      const { code } = await process.exited;
      expect(code).toBe(0);
      expect(process.stdout()).toContain("--port");
      expect(process.stdout()).toContain("--diagnostics-port");
      expect(process.stdout()).toContain("--config");
      expect(process.stdout()).toContain(CONFIG);
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
      const process = spawnReverseProxy([], { env: { OLIGARCHY_TOKEN: "", CURSOR_API_TOKEN: "" } });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("OLIGARCHY_TOKEN is not set");
      expect(process.stderr()).not.toContain("CURSOR_API_TOKEN");
      expect(process.stderr()).not.toContain("sentinel-pw");
    }),
  );

  // The config is read after the flags and before the database: no file, no ping.
  it.live("no config file in the working directory exits 1 with the fatal line naming it", () =>
    Effect.promise(async () => {
      const process = spawnReverseProxy([], { files: {}, env: { DATABASE_URL: UNREACHABLE } });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(lines(process.stdout())).toContain(
        "[global] fatal: reverse proxy: config .reverse-proxy.oligarchy.json not found",
      );
      expect(process.stdout()).not.toContain("database unreachable");
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("--config names another file, whose refusal is reported by that path", () =>
    Effect.promise(async () => {
      const process = spawnReverseProxy(["--config", "rp.json"], {
        files: { "rp.json": '{ "agent-executable": "vim" }' },
      });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stdout()).toContain(
        '[global] fatal: reverse proxy: config rp.json: Expected "cursor" | "opencode"',
      );
      expect(process.stdout()).toContain('at ["agent-executable"]');
      expect(process.stdout()).not.toContain("listening");
    }),
  );

  it.live("an unreachable database exits 1 with the fatal line and never the password", () =>
    Effect.promise(async () => {
      const process = spawnReverseProxy([], { env: { DATABASE_URL: UNREACHABLE } });
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

  // The agent program's own requirement comes after the database: Cursor's key, or opencode.
  it.live.skipIf(dbUrl === "")(
    "a cursor config without CURSOR_API_TOKEN exits 1 with CURSOR_API_TOKEN is not set",
    () =>
      Effect.promise(async () => {
        const process = spawnReverseProxy([], { env: { CURSOR_API_TOKEN: "" } });
        const { code } = await process.exited;
        expect(code).toBe(1);
        expect(lines(process.stdout())).toContain(
          "[global] fatal: reverse proxy: CURSOR_API_TOKEN is not set",
        );
        expect(process.stdout()).not.toContain("listening");
      }),
  );

  it.live.skipIf(dbUrl === "")(
    "an opencode config without opencode on PATH exits 1 naming the missing program",
    () =>
      Effect.promise(async () => {
        const bin = stubBin({ opencode: false });
        try {
          const process = spawnReverseProxy([], {
            files: { [CONFIG]: OPENCODE },
            env: { ...bin.env, CURSOR_API_TOKEN: "" },
          });
          const { code } = await process.exited;
          expect(code).toBe(1);
          const output = lines(process.stdout());
          expect(output).toContain("[global] fatal: reverse proxy: missing host requirements:");
          expect(output).toContain("opencode not on PATH");
          expect(process.stdout()).not.toContain("CURSOR_API_TOKEN");
          expect(process.stdout()).not.toContain("listening");
        } finally {
          bin.remove();
        }
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

describe("reverse proxy serving cursor agents", () => {
  const serving = (signal: "SIGINT" | "SIGTERM") =>
    forgetEveryServer.pipe(Effect.andThen(Effect.promise(() => served(signal))));

  // SIGTERM's run names its config with --config; SIGINT's finds the default.
  const served = async (signal: "SIGINT" | "SIGTERM") => {
    const port = await freePort();
    const diagnosticsPort = await freePort();
    const stub = await StubCursor.startStubCursor();
    const process =
      signal === "SIGINT"
        ? spawnReverseProxy(
            ["--port", String(port), "--diagnostics-port", String(diagnosticsPort)],
            {
              env: { CURSOR_BACKEND_URL: stub.url },
            },
          )
        : spawnReverseProxy(
            [
              "--port",
              String(port),
              "--diagnostics-port",
              String(diagnosticsPort),
              "--config",
              "agents.json",
            ],
            { env: { CURSOR_BACKEND_URL: stub.url }, files: { "agents.json": CURSOR } },
          );
    let spawnedUrl = "";
    try {
      await process.waitFor(/oligarchy reverse proxy listening/);
      expect(lines(process.stdout())).toContain(
        `[global] oligarchy reverse proxy listening on 127.0.0.1:${String(port)}; diagnostics on 127.0.0.1:${String(diagnosticsPort)}; agents by cursor`,
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

      // An agent for a ticket, through the Cursor SDK to the stub: the default model, the
      // driving prompt, and the link back.
      const spawned = await request(
        port,
        "POST",
        "/agent",
        agentHeaders,
        '{"task":"OLI-2","type":"driving-agent"}',
      );
      expect(spawned.status).toBe(200);
      const started: { id: string; url: string; model: string } = JSON.parse(await spawned.text());
      expect(started.model).toBe("grok-4.6-high-fast");
      expect(started.url).toBe(`https://cursor.com/agents/${started.id}`);
      spawnedUrl = started.url;
      const created = StubCursor.createdAgents(stub);
      expect(created).toHaveLength(1);
      expect(created[0]?.authorization).toBe(`Bearer ${CURSOR_TOKEN}`);
      const body: { agentId: string; prompt: { text: string }; model: unknown } = JSON.parse(
        created[0]?.body ?? "{}",
      );
      expect(body.agentId).toBe(started.id);
      expect(body.prompt.text).toMatch(/Review Linear ticket\s+OLI-2/);
      expect(body.prompt.text).toContain("<model> grok-4.6-high-fast </model>");
      expect(body.model).toEqual({
        id: "grok-4.6",
        params: [
          { id: "effort", value: "high" },
          { id: "fast", value: "true" },
        ],
      });

      // A level the stub's grok-4.6 does not offer: the catalog refuses it, no agent is created.
      const refused = await request(
        port,
        "POST",
        "/agent",
        agentHeaders,
        '{"task":"OLI-3","type":"driving-agent","reasoning":"max"}',
      );
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({
        error: 'model "grok-4.6" has no reasoning level "max"; it has low, medium, high, xhigh',
      });
      expect(StubCursor.createdAgents(stub)).toHaveLength(1);
    } finally {
      // A failed expectation must not leave the process listening past the test.
      process.child.kill(signal);
      await stub.close();
    }
    const { code } = await process.exited;
    expect(code, process.stdout()).toBe(0);
    const output = lines(process.stdout());
    expect(output).toContain("[global] error: POST /send-keys failed: unauthorized");
    expect(output).toContain("[OLI-1] error: POST /start failed: no server registered");
    expect(output).toContain(
      `[OLI-2] agent spawned; driving-agent; OLI-2; grok-4.6-high-fast; ${spawnedUrl}`,
    );
    expect(output).toContain(
      '[global] error: POST /agent failed: model "grok-4.6" has no reasoning level "max"; it has low, medium, high, xhigh',
    );
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
    "listens, answers /servers, /agent, 401 and 404, and exits 0 on SIGINT",
    () => serving("SIGINT"),
    120_000,
  );

  it.live.skipIf(dbUrl === "")("exits 0 on SIGTERM", () => serving("SIGTERM"), 120_000);
});

describe("reverse proxy serving opencode agents", () => {
  // The default config says opencode: the program on PATH is run from the package root with the
  // prompt on stdin, its first event's session is the answer, and it dies with the reverse proxy.
  const served = async () => {
    const port = await freePort();
    const diagnosticsPort = await freePort();
    const bin = stubBin({ opencode: true });
    const process = spawnReverseProxy(
      ["--port", String(port), "--diagnostics-port", String(diagnosticsPort)],
      {
        files: { [CONFIG]: readFileSync(join(PACKAGE_ROOT, CONFIG), "utf8") },
        env: { ...bin.env, CURSOR_API_TOKEN: "" },
      },
    );
    const pids = (): ReadonlyArray<number> =>
      existsSync(join(bin.records, "pids"))
        ? lines(readFileSync(join(bin.records, "pids"), "utf8")).map(Number)
        : [];
    const recorded = (name: string, pid: number) =>
      readFileSync(join(bin.records, `${name}.${String(pid)}`), "utf8");
    try {
      await process.waitFor(/oligarchy reverse proxy listening/);
      expect(lines(process.stdout())).toContain(
        `[global] oligarchy reverse proxy listening on 127.0.0.1:${String(port)}; diagnostics on 127.0.0.1:${String(diagnosticsPort)}; agents by opencode`,
      );

      // The default model, the driving prompt on stdin, and the session as the answer.
      const spawned = await request(
        port,
        "POST",
        "/agent",
        agentHeaders,
        '{"task":"OLI-2","type":"driving-agent"}',
      );
      expect(spawned.status).toBe(200);
      expect(await spawned.json()).toEqual({ id: "ses_stub1", model: "opencode/grok-code" });
      const [first] = pids();
      expect(first).toBeDefined();
      expect(alive(first ?? 0)).toBe(true);
      expect(recorded("argv", first ?? 0)).toBe(
        "run\n--format\njson\n--model\nopencode/grok-code\n",
      );
      const prompt = recorded("stdin", first ?? 0);
      expect(prompt).toMatch(/Review Linear ticket\s+OLI-2/);
      expect(prompt).toContain("<model> opencode/grok-code </model>");
      expect(prompt).toContain("--model opencode/grok-code");

      // A named model and a reasoning level, as opencode takes them.
      const named = await request(
        port,
        "POST",
        "/agent",
        agentHeaders,
        '{"task":"OLI-3","type":"driving-agent","model":"anthropic/claude-opus-4","reasoning":"high"}',
      );
      expect(named.status).toBe(200);
      expect(await named.json()).toEqual({
        id: "ses_stub2",
        model: "anthropic/claude-opus-4-high",
      });
      const [, second] = pids();
      expect(recorded("argv", second ?? 0)).toBe(
        "run\n--format\njson\n--model\nanthropic/claude-opus-4\n--variant\nhigh\n",
      );

      // What opencode cannot do is refused before it runs: fast, and a model not provider/model.
      const fast = await request(
        port,
        "POST",
        "/agent",
        agentHeaders,
        '{"task":"OLI-4","type":"driving-agent","fast":true}',
      );
      expect(fast.status).toBe(400);
      expect(await fast.json()).toEqual({
        error: 'model "opencode/grok-code" has no fast mode',
      });
      const cursorId = await request(
        port,
        "POST",
        "/agent",
        agentHeaders,
        '{"task":"OLI-5","type":"driving-agent","model":"grok-4.6"}',
      );
      expect(cursorId.status).toBe(400);
      expect(await cursorId.json()).toEqual({ error: 'model "grok-4.6" must be provider/model' });
      expect(pids()).toHaveLength(2);
      expect(readdirSync(bin.records).filter((name) => name.startsWith("argv."))).toHaveLength(2);
    } finally {
      process.child.kill("SIGINT");
    }
    const { code } = await process.exited;
    expect(code, process.stdout()).toBe(0);
    const output = lines(process.stdout());
    expect(output).toContain(
      "[OLI-2] agent spawned; driving-agent; OLI-2; opencode/grok-code; ses_stub1",
    );
    expect(output).toContain(
      "[OLI-3] agent spawned; driving-agent; OLI-3; anthropic/claude-opus-4-high; ses_stub2",
    );
    expect(output).toContain(
      '[global] error: POST /agent failed: model "opencode/grok-code" has no fast mode',
    );
    expect(process.stderr()).toBe("");
    // The agents were the reverse proxy's to run, and went with it.
    for (const pid of pids()) {
      expect(alive(pid), `pid ${String(pid)} still alive`).toBe(false);
    }
    bin.remove();
  };

  it.live.skipIf(dbUrl === "")(
    "runs the program on PATH per /agent, answers its session, refuses what it cannot do, and takes its agents down with it",
    () => forgetEveryServer.pipe(Effect.andThen(Effect.promise(served))),
    120_000,
  );
});
