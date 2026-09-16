import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";

const DIG = fileURLToPath(new URL("../../dig", import.meta.url));
const EXIT_WITHIN_MS = 60_000;
const CWD = tmpdir();

type Process = {
  readonly child: ChildProcess;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  readonly waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<void>;
};

const spawnDig = (args: ReadonlyArray<string>): Process => {
  const dir = mkdtempSync(join(CWD, "oligarchy-dig-test-"));
  const child = spawn(DIG, args, {
    cwd: dir,
    env: process.env,
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
              `dig exited ${String(child.exitCode)} before ${pattern.source}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
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

describe("dig process happy path", () => {
  it.live("--help exits 0 and lists --port", () =>
    Effect.promise(async () => {
      const process = spawnDig(["--help"]);
      const { code } = await process.exited;
      expect(code).toBe(0);
      expect(process.stdout()).toContain("dig");
      expect(process.stdout()).toContain("--port");
    }),
  );

  it.live("listens and serves the cartoon lobby page", () =>
    Effect.promise(async () => {
      const port = await freePort();
      const process = spawnDig(["--port", String(port)]);
      await process.waitFor(/dig listening on 127\.0\.0\.1:/);
      const page = await fetch("http://127.0.0.1:" + String(port) + "/");
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Ready");
      expect(html).toContain("Start Game");
      const script = await fetch("http://127.0.0.1:" + String(port) + "/game.js");
      expect(script.status).toBe(200);
      expect(await script.text()).toContain("WASD");
      process.child.kill("SIGTERM");
      const { code } = await process.exited;
      expect(code).toBe(0);
    }),
  );
});

describe("dig process unhappy path", () => {
  it.live("a --port that is not an integer exits 1 and does not listen", () =>
    Effect.promise(async () => {
      const process = spawnDig(["--port", "nope"]);
      const { code } = await process.exited;
      expect(code).toBe(1);
      expect(process.stdout()).not.toContain("listening");
    }),
  );
});
