import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { capture, flushSentry, initSentry } from "../sentry.ts";

initSentry();

const addr = process.env.OLIGARCHY_ADDR ?? "127.0.0.1:42069";
const [host, port] = addr.split(":");
const REPO = resolve(import.meta.dirname, "../..");
const PROXY = join(import.meta.dirname, "proxy.ts");
const PULL_INTERVAL_MS = 30 * 60 * 1000;
const PULL_TIMEOUT_MS = 5 * 60 * 1000;
const DRAIN_CHECK_MS = 10_000;
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 250;
const STATS_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 1024 * 1024;
// A roll swaps proxy processes and nothing else: a lockfile change needs npm ci, a migration
// needs db:migrate, and this file is loaded once. Any of them changing means restart the wrapper.
const RESTART_PATHS = ["package-lock.json", "drizzle", "src/qemu/wrapper.ts"];
const HOP_BY_HOP = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];

type Backend = {
  readonly port: number;
  readonly commit: string;
  readonly proc: ChildProcess;
  phase: "starting" | "current" | "draining" | "stopping" | "exited";
  exit: string;
  inflight: number;
};

type Stats = Record<string, unknown> & { qemus: number };

const backends = new Set<Backend>();
const sessions = new Map<string, Backend>();
let current: Backend | undefined;
let recovered = "";
let checking = false;
let checkAgain = false;
let draining = false;
let shuttingDown = false;
let shutdownFailed = false;
let external: ChildProcess | undefined;
let pullTimer: NodeJS.Timeout | undefined;
let drainTimer: NodeJS.Timeout | undefined;

function say(text: string): void {
  console.log(`wrapper: ${text}`);
}

function fail(text: string, cause?: unknown): void {
  console.error(`wrapper: error: ${text}`);
  capture({ text, level: "error", cause });
}

function message(err: unknown): string {
  return (err as Error).message;
}

function label(backend: Backend): string {
  return `backend 127.0.0.1:${backend.port} (pid ${backend.proc.pid}, ${backend.commit.slice(0, 7)})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function git(args: string[], timeoutMs = 0): Promise<string> {
  return new Promise((done, failWith) => {
    const child = spawn("git", args, {
      cwd: REPO,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    external = child;
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      out += data;
    });
    child.stderr.on("data", (data: string) => {
      err += data;
    });
    const timer = timeoutMs === 0 ? undefined : setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (e) => {
      clearTimeout(timer);
      external = undefined;
      failWith(e);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      external = undefined;
      if (code === 0) {
        done(out.trim());
      } else {
        failWith(new Error(`git ${args[0]} exited ${code ?? signal}: ${err.trim() || out.trim()}`));
      }
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((done, failWith) => {
    const probe = createNetServer();
    probe.once("error", failWith);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((err) => (err === undefined ? done(port) : failWith(err)));
    });
  });
}

function getStats(backend: Backend): Promise<Stats> {
  return new Promise((done, failWith) => {
    const req = request({ host: "127.0.0.1", port: backend.port, path: "/stats", agent: false, timeout: STATS_TIMEOUT_MS }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (data: string) => {
        body += data;
      });
      res.on("error", failWith);
      res.on("end", () => {
        if (res.statusCode !== 200) {
          failWith(new Error(`/stats answered ${res.statusCode}`));
          return;
        }
        try {
          done(JSON.parse(body) as Stats);
        } catch (err) {
          failWith(err);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`/stats did not answer within ${STATS_TIMEOUT_MS}ms`)));
    req.on("error", failWith);
    req.end();
  });
}

function spawnBackend(commit: string, port: number): Backend {
  // Detached: the wrapper is the only thing that signals a proxy. In the terminal's process
  // group a closing terminal would SIGHUP the proxies, which have no handler and would die
  // without stopping their QEMUs.
  const proc = spawn(process.execPath, ["--experimental-strip-types", PROXY, ...process.argv.slice(2)], {
    env: { ...process.env, OLIGARCHY_ADDR: `127.0.0.1:${port}` },
    stdio: "inherit",
    detached: true,
  });
  const backend: Backend = { port, commit, proc, phase: "starting", exit: "", inflight: 0 };
  backends.add(backend);
  say(`${label(backend)} starting`);
  proc.once("error", (err) => exited(backend, `spawn failed: ${err.message}`));
  proc.once("exit", (code, signal) => exited(backend, String(code ?? signal)));
  return backend;
}

function exited(backend: Backend, exit: string): void {
  // A spawn failure emits error and may or may not emit exit after it.
  if (backend.phase === "exited") {
    return;
  }
  const was = backend.phase;
  backend.phase = "exited";
  backend.exit = exit;
  backends.delete(backend);
  let lost = 0;
  for (const [id, owner] of sessions) {
    if (owner === backend) {
      sessions.delete(id);
      lost++;
    }
  }
  if (was === "current" || was === "draining") {
    fail(`${label(backend)} exited ${exit} unexpectedly; ${lost} sessions lost`);
    // Its QEMUs share its process group; a proxy that died hard never stopped them.
    try {
      process.kill(-backend.proc.pid!, "SIGKILL");
    } catch {
      // nothing left in the group
    }
    if (was === "current") {
      current = undefined;
      say("no backend is running; requests get 503 until one starts");
      if (recovered === backend.commit) {
        say(`backend at ${backend.commit.slice(0, 7)} already restarted once; waiting for the next update check`);
      } else {
        recovered = backend.commit;
        void check();
      }
    }
  } else if (exit === "0" || was === "starting") {
    say(`${label(backend)} exited ${exit}`);
  } else {
    fail(`${label(backend)} exited ${exit}`);
    if (shuttingDown) {
      shutdownFailed = true;
    }
  }
  if (shuttingDown && backends.size === 0) {
    finish();
  }
}

async function waitReady(backend: Backend): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (backend.phase === "starting") {
    try {
      await getStats(backend);
      return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      try {
        process.kill(-backend.proc.pid!, "SIGKILL");
      } catch {
        // already gone
      }
      throw new Error(`not ready within ${READY_TIMEOUT_MS / 1000}s`);
    }
    await sleep(READY_POLL_MS);
  }
  throw new Error(backend.phase === "exited" ? `exited ${backend.exit}` : "shutting down");
}

async function start(commit: string): Promise<Backend> {
  const backend = spawnBackend(commit, await freePort());
  await waitReady(backend);
  return backend;
}

async function check(): Promise<void> {
  if (checking) {
    checkAgain = true;
    return;
  }
  checking = true;
  try {
    do {
      checkAgain = false;
      if (shuttingDown) {
        return;
      }
      try {
        say(`pull: ${(await git(["pull", "--ff-only"], PULL_TIMEOUT_MS)).split("\n")[0]}`);
      } catch (err) {
        fail(`pull failed: ${message(err)}`, err);
      }
      if (shuttingDown) {
        return;
      }
      const head = await git(["rev-parse", "HEAD"]);
      if (current !== undefined && current.commit === head) {
        say(`up to date at ${head.slice(0, 7)}`);
        continue;
      }
      if (current === undefined) {
        say(`starting a backend at ${head.slice(0, 7)}`);
      } else {
        const changed = await git(["diff", "--name-only", current.commit, head, "--", ...RESTART_PATHS]);
        if (changed !== "") {
          fail(
            `cannot roll ${current.commit.slice(0, 7)} -> ${head.slice(0, 7)}: ${changed.split("\n").join(", ")} changed; run npm ci and npm run db:migrate, then restart the wrapper`,
          );
          continue;
        }
        say(`rolling ${current.commit.slice(0, 7)} -> ${head.slice(0, 7)}`);
      }
      let fresh: Backend;
      try {
        fresh = await start(head);
      } catch (err) {
        if (!shuttingDown) {
          fail(`roll to ${head.slice(0, 7)} failed: ${message(err)}`, err);
        }
        continue;
      }
      if (shuttingDown) {
        return;
      }
      const old = current;
      fresh.phase = "current";
      current = fresh;
      say(`${label(fresh)} ready; new sessions route here`);
      if (old !== undefined) {
        old.phase = "draining";
        say(`${label(old)} draining; ${[...sessions.values()].filter((owner) => owner === old).length} sessions`);
      }
    } while (checkAgain);
  } catch (err) {
    fail(`update check failed: ${message(err)}`, err);
  } finally {
    checking = false;
  }
}

async function drain(): Promise<void> {
  for (const backend of backends) {
    if (backend.phase !== "draining") {
      continue;
    }
    let qemus: number;
    try {
      qemus = (await getStats(backend)).qemus;
    } catch (err) {
      fail(`${label(backend)}: ${message(err)}`, err);
      continue;
    }
    // qemus counts booted machines only: a /start still booting there is inflight, not a qemu.
    if (backend.phase === "draining" && qemus === 0 && backend.inflight === 0) {
      backend.phase = "stopping";
      say(`${label(backend)} stopping; no sessions left`);
      backend.proc.kill("SIGTERM");
    }
  }
}

function reply(res: ServerResponse, status: number, error: string): void {
  const body = JSON.stringify({ error });
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function forward(
  backend: Backend,
  req: IncomingMessage,
  res: ServerResponse,
  body: Buffer,
  buffered: boolean,
): Promise<{ status: number; body: Buffer }> {
  backend.inflight++;
  return new Promise((done, failWith) => {
    const headers: OutgoingHttpHeaders = { ...req.headers, host: `127.0.0.1:${backend.port}`, "content-length": body.length };
    for (const name of HOP_BY_HOP) {
      delete headers[name];
    }
    const upstream = request({ host: "127.0.0.1", port: backend.port, method: req.method, path: req.url, headers, agent: false }, (up) => {
      const status = up.statusCode!;
      const head = { ...up.headers };
      for (const name of HOP_BY_HOP) {
        delete head[name];
      }
      up.on("error", failWith);
      if (buffered) {
        const chunks: Buffer[] = [];
        up.on("data", (chunk: Buffer) => chunks.push(chunk));
        up.on("end", () => {
          const answer = Buffer.concat(chunks);
          if (!res.destroyed) {
            res.writeHead(status, { ...head, "content-length": answer.length });
            res.end(answer);
          }
          done({ status, body: answer });
        });
        return;
      }
      if (res.destroyed) {
        up.resume();
      } else {
        res.writeHead(status, head);
        up.pipe(res);
        // A client that leaves mid-response must not stall the backend: keep draining its reply.
        res.on("close", () => {
          up.unpipe(res);
          up.resume();
        });
      }
      up.on("end", () => done({ status, body: Buffer.alloc(0) }));
    });
    upstream.on("error", failWith);
    upstream.on("close", () => {
      backend.inflight--;
    });
    upstream.end(body);
  });
}

async function stats(res: ServerResponse): Promise<void> {
  const live = [...backends].filter((backend) => backend.phase === "current" || backend.phase === "draining");
  if (live.length === 0) {
    reply(res, 503, "no backend is running");
    return;
  }
  let all: Stats[];
  try {
    all = await Promise.all(
      live.map(async (backend) => {
        try {
          return await getStats(backend);
        } catch (err) {
          throw new Error(`${label(backend)}: ${message(err)}`, { cause: err });
        }
      }),
    );
  } catch (err) {
    fail(`GET /stats: ${message(err)}`, err);
    reply(res, 502, message(err));
    return;
  }
  // Memory and cpu are the host's, the same from every backend; only the machine count adds up.
  const body = JSON.stringify({ ...all[0], qemus: all.reduce((sum, one) => sum + one.qemus, 0) });
  res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url!, "http://wrapper");
    if (req.method === "GET" && url.pathname === "/stats") {
      await stats(res);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      // Past the cap the body is still read and dropped: answering with unread bytes on
      // the socket resets the connection before the client sees the 413.
      for await (const chunk of req as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size <= MAX_BODY_BYTES) {
          chunks.push(chunk);
        }
      }
    } catch {
      // the client went away mid-body; there is nobody to answer
      return;
    }
    if (size > MAX_BODY_BYTES) {
      reply(res, 413, "request body too large");
      return;
    }
    const body = Buffer.concat(chunks);
    let id: string | undefined;
    if (req.method === "GET") {
      id = url.searchParams.get("id") ?? undefined;
    } else {
      try {
        const parsed = JSON.parse(body.toString()) as { id?: unknown };
        if (typeof parsed.id === "string") {
          id = parsed.id;
        }
      } catch {
        // not JSON: the proxy answers that with its own 400
      }
    }
    const isStart = req.method === "POST" && url.pathname === "/start";
    const owner = id === undefined ? undefined : sessions.get(id);
    const backend = isStart ? current : owner ?? current;
    if (backend === undefined) {
      reply(res, 503, "no backend is running");
      return;
    }
    let answer: { status: number; body: Buffer };
    try {
      answer = await forward(backend, req, res, body, isStart);
    } catch (err) {
      fail(`${req.method} ${url.pathname}: ${label(backend)}: ${message(err)}`, err);
      if (res.headersSent) {
        res.destroy();
      } else {
        reply(res, 502, `${label(backend)}: ${message(err)}`);
      }
      return;
    }
    if (isStart) {
      // The backend can exit between answering and this line; never map a session to a dead one.
      if (answer.status === 200 && backends.has(backend)) {
        sessions.set((JSON.parse(answer.body.toString()) as { id: string }).id, backend);
      }
    } else if (url.pathname === "/stop" && answer.status === 200 && id !== undefined) {
      sessions.delete(id);
    }
  } catch (err) {
    fail(`${req.method} ${req.url} failed: ${message(err)}`, err);
    if (res.headersSent) {
      res.destroy();
    } else {
      reply(res, 500, "internal error");
    }
  }
}

const server = createServer((req, res) => {
  void handle(req, res);
});
server.on("error", (err) => fatal(`listen ${addr}: ${err.message}`, err));
server.on("listening", () => {
  say(`listening on ${host}:${(server.address() as AddressInfo).port}`);
  pullTimer = setInterval(() => {
    void check();
  }, PULL_INTERVAL_MS);
  pullTimer.unref();
  drainTimer = setInterval(() => {
    if (draining) {
      return;
    }
    draining = true;
    drain()
      .catch((err: unknown) => fail(`drain check failed: ${message(err)}`, err))
      .finally(() => {
        draining = false;
      });
  }, DRAIN_CHECK_MS);
  drainTimer.unref();
});

function finish(): void {
  void flushSentry().then(() => process.exit(shutdownFailed ? 1 : 0));
}

function shutdown(signal: string): void {
  if (shuttingDown) {
    say(`${signal} again; killing ${backends.size} backends`);
    for (const backend of backends) {
      try {
        process.kill(-backend.proc.pid!, "SIGKILL");
      } catch {
        // already gone
      }
    }
    process.exit(1);
  }
  shuttingDown = true;
  clearInterval(pullTimer);
  clearInterval(drainTimer);
  external?.kill("SIGKILL");
  server.close();
  say(`shutting down (${signal}); stopping ${backends.size} backends`);
  for (const backend of backends) {
    backend.phase = "stopping";
    backend.proc.kill("SIGTERM");
  }
  if (backends.size === 0) {
    finish();
  }
}

function fatal(text: string, cause: unknown): void {
  console.error(`wrapper: fatal: ${text}`);
  capture({ text, level: "fatal", cause });
  shutdownFailed = true;
  shutdown("fatal");
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGHUP", () => shutdown("SIGHUP"));
process.on("SIGUSR2", () => {
  say("SIGUSR2; checking for updates now");
  void check();
});

async function main(): Promise<void> {
  let head: string;
  try {
    head = await git(["rev-parse", "HEAD"]);
  } catch (err) {
    fatal(`${REPO} is not a git checkout: ${message(err)}`, err);
    return;
  }
  say(`repo ${REPO} at ${head.slice(0, 7)}`);
  let first: Backend;
  try {
    first = await start(head);
  } catch (err) {
    if (!shuttingDown) {
      fatal(`backend at ${head.slice(0, 7)} failed to start: ${message(err)}`, err);
    }
    return;
  }
  if (shuttingDown) {
    return;
  }
  first.phase = "current";
  current = first;
  say(`${label(first)} ready; new sessions route here`);
  server.listen(Number(port), host);
}

void main().catch((err: unknown) => fatal(`startup failed: ${message(err)}`, err));
