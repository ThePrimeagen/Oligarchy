import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";

const AUTOMATION_CLIENT = fileURLToPath(new URL("../../automation-client", import.meta.url));
const TOKEN = "t";
const EXIT_WITHIN_MS = 60_000;

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

const request = (port: number, headers: Record<string, string>, body: string) =>
  fetch(`http://127.0.0.1:${String(port)}/run`, { method: "POST", headers, body });

describe("automation client startup refusals", () => {
  it.live("--help exits 0 and lists --port alone", () =>
    Effect.promise(async () => {
      const process = spawnAutomationClient(["--help"]);
      const { code } = await process.exited;
      expect(code).toBe(0);
      expect(process.stdout()).toContain("automation-client");
      expect(process.stdout()).toContain("--port");
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

  it.live("a missing OLIGARCHY_TOKEN exits 1 with OLIGARCHY_TOKEN is not set", () =>
    Effect.promise(async () => {
      const process = spawnAutomationClient([], { OLIGARCHY_TOKEN: "" });
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stderr()).toContain("OLIGARCHY_TOKEN is not set");
      expect(process.stdout()).not.toContain("listening");
    }),
  );
});

describe("automation client POST /run", () => {
  it.live("answers 200 when opencode exits 0", () =>
    Effect.promise(async () => {
      const bin = installOpencode("exit 0");
      const port = await freePort();
      const process = spawnAutomationClient(
        ["--port", String(port)],
        {},
        `${bin}:${process.env.PATH ?? ""}`,
      );
      try {
        await process.waitFor(new RegExp(`automation client listening on 127.0.0.1:${String(port)}`));
        const response = await request(
          port,
          { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          JSON.stringify({ prompt: "do the work" }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: "true" });
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
        `${bin}:${process.env.PATH ?? ""}`,
      );
      try {
        await process.waitFor(new RegExp(`automation client listening on 127.0.0.1:${String(port)}`));
        const response = await request(
          port,
          { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          JSON.stringify({ prompt: "do the work" }),
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

  it.live("answers 401 without the bearer", () =>
    Effect.promise(async () => {
      const bin = installOpencode("exit 0");
      const port = await freePort();
      const process = spawnAutomationClient(
        ["--port", String(port)],
        {},
        `${bin}:${process.env.PATH ?? ""}`,
      );
      try {
        await process.waitFor(new RegExp(`automation client listening on 127.0.0.1:${String(port)}`));
        const response = await request(
          port,
          { "content-type": "application/json" },
          JSON.stringify({ prompt: "do the work" }),
        );
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "unauthorized" });
      } finally {
        process.child.kill("SIGTERM");
        await process.exited;
        rmSync(bin, { recursive: true, force: true });
      }
    }),
  );
});
