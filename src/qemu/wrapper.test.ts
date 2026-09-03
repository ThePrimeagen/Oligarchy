import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { connect, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";

const WORKSPACE = resolve(import.meta.dirname, "../..");
// The wrapper checks draining backends every 10s; give a drain-dependent wait one full tick of slack.
const DRAIN_WAIT_MS = 15_000;

type Fixture = { root: string; origin: string; work: string; checkout: string };

type Wrapper = {
  proc: ChildProcess;
  output: () => string;
  waitFor: (re: RegExp, ms?: number, from?: number) => Promise<RegExpMatchArray>;
  exited: Promise<number | null>;
  port: number;
};

const fixtures: Fixture[] = [];
const wrappers: Wrapper[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(check: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting until ${what}`);
    }
    await sleep(25);
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// The stand-in for src/qemu/proxy.ts inside a fixture repo: the parts of the proxy's
// contract the wrapper relies on, plus knobs a test can commit as a "version".
// mode is a comma list of: exit1 (refuse to start), gated (listen only once
// <repo>/gate exists), child (spawn a grandchild), crash (exit 1 a second after listening).
function stubProxy(version: string, mode: string): string {
  return `import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const VERSION = ${JSON.stringify(version)};
const MODE = ${JSON.stringify(mode)};
const GATE = join(import.meta.dirname, "../../gate");
const [host, port] = process.env.OLIGARCHY_ADDR!.split(":");
const sessions = new Set<string>();
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

if (MODE.includes("exit1")) {
  console.error(\`stub \${VERSION}: refusing to start\`);
  process.exit(1);
}

const server = createServer(async (req, res) => {
  res.setHeader("x-backend", VERSION);
  const url = new URL(req.url!, "http://stub");
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }
  console.log(\`stub \${VERSION}: \${req.method} \${url.pathname}\`);
  if (url.pathname === "/reset") {
    req.socket.destroy();
    return;
  }
  if (url.pathname === "/reset-mid") {
    res.writeHead(200, { "content-type": "image/png", "content-length": "100000" });
    res.write("partial", () => res.socket!.destroy());
    return;
  }
  if (url.pathname === "/stats") {
    res.end(JSON.stringify({
      qemus: sessions.size,
      memory: { totalBytes: 1, usedBytes: 1, freeBytes: 0 },
      cpu: { cores: 1, mean: 0, p10: 0, p25: 0, p75: 0, p90: 0 },
    }));
    return;
  }
  let body: { id?: string; gate?: boolean } = {};
  if (raw !== "") {
    try {
      body = JSON.parse(raw) as typeof body;
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: (err as Error).message }));
      return;
    }
  }
  if (url.pathname === "/start") {
    while (body.gate === true && !existsSync(GATE)) {
      await sleep(25);
    }
    const id = randomUUID();
    sessions.add(id);
    console.log(\`stub \${VERSION}: started \${id}\`);
    res.end(JSON.stringify({ id }));
    return;
  }
  const id = req.method === "GET" ? url.searchParams.get("id") : body.id;
  if (id === undefined || id === null || !sessions.has(id)) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: \`unknown session "\${id}"\` }));
    return;
  }
  if (url.pathname === "/stop" || url.pathname === "/timeout") {
    sessions.delete(id);
  }
  if (url.pathname === "/image") {
    const png = Buffer.alloc(300_000);
    for (let i = 0; i < png.length; i++) {
      png[i] = i % 251;
    }
    res.writeHead(200, { "content-type": "image/png" });
    res.end(png);
    return;
  }
  res.end(JSON.stringify({ ok: "true" }));
});

process.on("SIGTERM", () => {
  console.log(\`stub \${VERSION}: SIGTERM with \${sessions.size} sessions\`);
  process.exit(0);
});

async function main(): Promise<void> {
  while (MODE.includes("gated") && !existsSync(GATE)) {
    await sleep(25);
  }
  if (MODE.includes("child")) {
    const child = spawn("sleep", ["1000"], { stdio: "ignore" });
    console.log(\`stub \${VERSION}: child pid \${child.pid}\`);
  }
  server.listen(Number(port), host, () => {
    console.log(\`stub \${VERSION}: listening on \${port}\`);
    if (MODE.includes("crash")) {
      setTimeout(() => process.exit(1), 1_000);
    }
  });
}
void main();
`;
}

function makeFixture(version = "v1", mode = ""): Fixture {
  const root = mkdtempSync(join(tmpdir(), "wrapper-test-"));
  const fixture = { root, origin: join(root, "origin.git"), work: join(root, "work"), checkout: join(root, "checkout") };
  fixtures.push(fixture);
  git(root, "init", "-q", "--bare", fixture.origin);
  git(root, "init", "-q", "-b", "master", fixture.work);
  mkdirSync(join(fixture.work, "src/qemu"), { recursive: true });
  cpSync(join(WORKSPACE, "src/qemu/wrapper.ts"), join(fixture.work, "src/qemu/wrapper.ts"));
  cpSync(join(WORKSPACE, "src/sentry.ts"), join(fixture.work, "src/sentry.ts"));
  writeFileSync(join(fixture.work, "src/sentry-dsn.ts"), 'export const SENTRY_DSN = "";\n');
  writeFileSync(join(fixture.work, "src/qemu/proxy.ts"), stubProxy(version, mode));
  writeFileSync(join(fixture.work, ".gitignore"), "node_modules\ngate\n");
  git(fixture.work, "add", "-A");
  git(fixture.work, "commit", "-q", "-m", version);
  git(fixture.work, "remote", "add", "origin", fixture.origin);
  git(fixture.work, "push", "-q", "-u", "origin", "master");
  git(root, "clone", "-q", fixture.origin, fixture.checkout);
  symlinkSync(join(WORKSPACE, "node_modules"), join(fixture.checkout, "node_modules"));
  return fixture;
}

// Commits a new stub version in the work clone and pushes it; returns the short commit.
function push(fixture: Fixture, version: string, mode = "", extra: Record<string, string> = {}): string {
  writeFileSync(join(fixture.work, "src/qemu/proxy.ts"), stubProxy(version, mode));
  for (const [path, content] of Object.entries(extra)) {
    mkdirSync(dirname(join(fixture.work, path)), { recursive: true });
    writeFileSync(join(fixture.work, path), content);
  }
  git(fixture.work, "add", "-A");
  git(fixture.work, "commit", "-q", "-m", version);
  git(fixture.work, "push", "-q", "origin", "master");
  return git(fixture.work, "rev-parse", "HEAD").slice(0, 7);
}

function startWrapper(fixture: Fixture, addr = "127.0.0.1:0"): Wrapper {
  const proc = spawn(process.execPath, ["--experimental-strip-types", join(fixture.checkout, "src/qemu/wrapper.ts")], {
    cwd: fixture.checkout,
    env: { ...process.env, OLIGARCHY_ADDR: addr },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stdout!.setEncoding("utf8");
  proc.stderr!.setEncoding("utf8");
  proc.stdout!.on("data", (data: string) => {
    output += data;
  });
  proc.stderr!.on("data", (data: string) => {
    output += data;
  });
  // close, not exit: close fires once every stdio pipe is drained, so the output is complete.
  let closed = false;
  const exited = new Promise<number | null>((done) =>
    proc.once("close", (code) => {
      closed = true;
      done(code);
    })
  );
  const wrapper: Wrapper = {
    proc,
    output: () => output,
    exited,
    port: 0,
    waitFor: async (re, ms = 5_000, from = 0) => {
      const deadline = Date.now() + ms;
      for (;;) {
        const match = output.slice(from).match(re);
        if (match !== null) {
          return match;
        }
        if (closed) {
          throw new Error(`wrapper exited ${proc.exitCode} before ${re}\n--- output ---\n${output}`);
        }
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${re}\n--- output ---\n${output}`);
        }
        await sleep(25);
      }
    },
  };
  wrappers.push(wrapper);
  return wrapper;
}

async function listening(wrapper: Wrapper): Promise<void> {
  const match = await wrapper.waitFor(/wrapper: listening on 127\.0\.0\.1:(\d+)/);
  wrapper.port = Number(match[1]);
}

const BACKEND = String.raw`backend 127\.0\.0\.1:(\d+) \(pid (\d+), ([0-9a-f]{7})\)`;

function backendLine(event: string, commit = "[0-9a-f]{7}"): RegExp {
  return new RegExp(BACKEND.replace("([0-9a-f]{7})", `(${commit})`) + ` ${event}`);
}

async function call(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ status: number; backend: string | null; headers: Headers; bytes: Buffer; text: string; json: () => unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    signal,
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  const text = bytes.toString("utf8");
  return { status: res.status, backend: res.headers.get("x-backend"), headers: res.headers, bytes, text, json: () => JSON.parse(text) as unknown };
}

async function startSession(port: number): Promise<{ id: string; backend: string | null }> {
  const res = await call(port, "POST", "/start", { iso: "x.iso", agent: "agent-1" });
  assert.equal(res.status, 200, res.text);
  return { id: (res.json() as { id: string }).id, backend: res.backend };
}

function rollTo(wrapper: Wrapper, commit: string): Promise<RegExpMatchArray> {
  wrapper.proc.kill("SIGUSR2");
  return wrapper.waitFor(backendLine("ready", commit));
}

afterEach(async () => {
  for (const wrapper of wrappers.splice(0)) {
    for (const match of wrapper.output().matchAll(/pid (\d+)/g)) {
      try {
        process.kill(-Number(match[1]), "SIGKILL");
      } catch {
        // already gone
      }
    }
    wrapper.proc.kill("SIGKILL");
    await wrapper.exited;
  }
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

describe("./server wrapper happy path", () => {
  it("boots a backend from HEAD and routes session requests to the backend that owns them", async () => {
    const fixture = makeFixture();
    const head = git(fixture.checkout, "rev-parse", "HEAD").slice(0, 7);
    const wrapper = startWrapper(fixture);
    await wrapper.waitFor(backendLine("ready", head));
    await listening(wrapper);

    const session = await startSession(wrapper.port);
    assert.equal(session.backend, "v1");
    assert.match(session.id, /^[0-9a-f-]{36}$/);

    const keys = await call(wrapper.port, "POST", "/send-keys", { id: session.id, keys: "hi", agent: "agent-1" });
    assert.equal(keys.status, 200);
    assert.equal(keys.backend, "v1");
    assert.deepEqual(keys.json(), { ok: "true" });

    const image = await call(wrapper.port, "GET", `/image?id=${session.id}&agent=agent-1`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(image.bytes.length, 300_000);
    assert.ok(image.bytes.every((byte, i) => byte === i % 251));

    const malformed = await call(wrapper.port, "POST", "/send-keys", '{"id": ');
    assert.equal(malformed.status, 400);
    assert.equal(malformed.backend, "v1");
    assert.match((malformed.json() as { error: string }).error, /JSON/);

    const unknown = await call(wrapper.port, "POST", "/send-keys", { id: "nope", keys: "x", agent: "agent-1" });
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.json(), { error: 'unknown session "nope"' });

    const missing = await call(wrapper.port, "GET", "/serial?id=nope&agent=agent-1");
    assert.equal(missing.status, 404);
    assert.equal(missing.backend, "v1");

    const stop = await call(wrapper.port, "POST", "/stop", { id: session.id, agent: "agent-1" });
    assert.equal(stop.status, 200);
    const gone = await call(wrapper.port, "POST", "/send-keys", { id: session.id, keys: "x", agent: "agent-1" });
    assert.equal(gone.status, 404);
  });

  it("sums qemus over every live backend in /stats and fails the sum when one backend cannot be counted", async () => {
    const fixture = makeFixture();
    const wrapper = startWrapper(fixture);
    await wrapper.waitFor(backendLine("ready"));
    await listening(wrapper);
    await startSession(wrapper.port);
    await startSession(wrapper.port);

    const v2 = push(fixture, "v2");
    const v1 = await wrapper.waitFor(backendLine("starting"));
    await rollTo(wrapper, v2);
    await wrapper.waitFor(backendLine("draining; 2 sessions"));
    const onV2 = await startSession(wrapper.port);
    assert.equal(onV2.backend, "v2");

    const stats = await call(wrapper.port, "GET", "/stats");
    assert.equal(stats.status, 200);
    assert.equal(stats.headers.get("content-length"), String(stats.bytes.length));
    assert.deepEqual(stats.json(), {
      qemus: 3,
      memory: { totalBytes: 1, usedBytes: 1, freeBytes: 0 },
      cpu: { cores: 1, mean: 0, p10: 0, p25: 0, p75: 0, p90: 0 },
    });

    const v1Pid = Number(v1[2]);
    process.kill(v1Pid, "SIGSTOP");
    try {
      const failed = await call(wrapper.port, "GET", "/stats");
      assert.equal(failed.status, 502);
      assert.match((failed.json() as { error: string }).error, new RegExp(`backend 127\\.0\\.0\\.1:${v1[1]}`));
    } finally {
      process.kill(v1Pid, "SIGCONT");
    }
    const recovered = await call(wrapper.port, "GET", "/stats");
    assert.equal(recovered.status, 200);
    assert.equal((recovered.json() as { qemus: number }).qemus, 3);
  });

  it("rolls to a new commit on SIGUSR2, keeps old sessions on the old backend, and stops it once they are gone", async () => {
    const fixture = makeFixture();
    const wrapper = startWrapper(fixture);
    const v1 = await wrapper.waitFor(backendLine("ready"));
    await listening(wrapper);
    const a = await startSession(wrapper.port);
    const b = await startSession(wrapper.port);
    assert.equal(a.backend, "v1");

    const v2 = push(fixture, "v2");
    await rollTo(wrapper, v2);
    assert.match(wrapper.output(), new RegExp(`wrapper: rolling ${v1[3]} -> ${v2}`));
    await wrapper.waitFor(backendLine("draining; 2 sessions", v1[3]));

    const fresh = await startSession(wrapper.port);
    assert.equal(fresh.backend, "v2");
    const old = await call(wrapper.port, "POST", "/send-keys", { id: a.id, keys: "x", agent: "agent-1" });
    assert.equal(old.status, 200);
    assert.equal(old.backend, "v1");

    // The proxy drops a timed-out session on its own; the id keeps routing to its owner, which answers the real 404.
    const forgotten = await call(wrapper.port, "POST", "/timeout", { id: b.id, agent: "agent-1" });
    assert.equal(forgotten.backend, "v1");
    const timedOut = await call(wrapper.port, "POST", "/send-keys", { id: b.id, keys: "x", agent: "agent-1" });
    assert.equal(timedOut.status, 404);
    assert.equal(timedOut.backend, "v1");
    assert.deepEqual(timedOut.json(), { error: `unknown session "${b.id}"` });

    assert.equal(alive(Number(v1[2])), true);
    const stop = await call(wrapper.port, "POST", "/stop", { id: a.id, agent: "agent-1", status: "succeeded" });
    assert.equal(stop.status, 200);
    assert.equal(stop.backend, "v1");
    await wrapper.waitFor(backendLine("stopping; no sessions left", v1[3]), DRAIN_WAIT_MS);
    await wrapper.waitFor(backendLine("exited 0", v1[3]));
    assert.match(wrapper.output(), /stub v1: SIGTERM with 0 sessions/);
    await waitUntil(() => !alive(Number(v1[2])), 2_000, "v1 is gone");

    const after = await call(wrapper.port, "POST", "/send-keys", { id: a.id, keys: "x", agent: "agent-1" });
    assert.equal(after.status, 404);
    assert.equal(after.backend, "v2");
    const still = await call(wrapper.port, "POST", "/send-keys", { id: fresh.id, keys: "x", agent: "agent-1" });
    assert.equal(still.status, 200);
    assert.equal(still.backend, "v2");
  });

  it("keeps a draining backend alive while a /start is still booting on it, even if that client goes away", async () => {
    const fixture = makeFixture();
    const wrapper = startWrapper(fixture);
    const v1 = await wrapper.waitFor(backendLine("ready"));
    await listening(wrapper);

    const controller = new AbortController();
    const booting = call(wrapper.port, "POST", "/start", { iso: "x.iso", agent: "agent-1", gate: true }, controller.signal);
    booting.catch(() => {});
    await wrapper.waitFor(/stub v1: POST \/start/);

    const v2 = push(fixture, "v2");
    await rollTo(wrapper, v2);
    const draining = await wrapper.waitFor(backendLine("draining; 0 sessions", v1[3]));
    const drainedFrom = wrapper.output().indexOf(draining[0]);
    await wrapper.waitFor(/stub v1: GET \/stats/, DRAIN_WAIT_MS, drainedFrom);
    await sleep(200);
    assert.doesNotMatch(wrapper.output(), backendLine("stopping", v1[3]));
    assert.equal(alive(Number(v1[2])), true);

    controller.abort();
    await assert.rejects(booting);
    writeFileSync(join(fixture.checkout, "gate"), "");
    const started = await wrapper.waitFor(/stub v1: started ([0-9a-f-]{36})/);

    const keys = await call(wrapper.port, "POST", "/send-keys", { id: started[1], keys: "x", agent: "agent-1" });
    assert.equal(keys.status, 200);
    assert.equal(keys.backend, "v1");

    const stop = await call(wrapper.port, "POST", "/stop", { id: started[1], agent: "agent-1" });
    assert.equal(stop.status, 200);
    await wrapper.waitFor(backendLine("exited 0", v1[3]), DRAIN_WAIT_MS);
  });
});

describe("./server wrapper unhappy path", () => {
  it("keeps the old backend when the new commit cannot start, then rolls once a fix lands", async () => {
    const fixture = makeFixture();
    const wrapper = startWrapper(fixture);
    const v1 = await wrapper.waitFor(backendLine("ready"));
    await listening(wrapper);

    const broken = push(fixture, "v2", "exit1");
    wrapper.proc.kill("SIGUSR2");
    await wrapper.waitFor(new RegExp(`wrapper: error: roll to ${broken} failed: .*exited 1`));
    assert.match(wrapper.output(), /stub v2: refusing to start/);
    const still = await startSession(wrapper.port);
    assert.equal(still.backend, "v1");
    assert.equal(alive(Number(v1[2])), true);

    const fixed = push(fixture, "v3");
    await rollTo(wrapper, fixed);
    const session = await startSession(wrapper.port);
    assert.equal(session.backend, "v3");
  });

  it("reports a failed pull and keeps serving, and still rolls when HEAD moved by hand", async () => {
    const fixture = makeFixture();
    const wrapper = startWrapper(fixture);
    await wrapper.waitFor(backendLine("ready"));
    await listening(wrapper);

    rmSync(fixture.origin, { recursive: true, force: true });
    wrapper.proc.kill("SIGUSR2");
    await wrapper.waitFor(/wrapper: error: pull failed: /);
    await wrapper.waitFor(/wrapper: up to date at [0-9a-f]{7}/);
    const still = await startSession(wrapper.port);
    assert.equal(still.backend, "v1");

    writeFileSync(join(fixture.checkout, "src/qemu/proxy.ts"), stubProxy("v2", ""));
    git(fixture.checkout, "commit", "-q", "-am", "v2 by hand");
    const local = git(fixture.checkout, "rev-parse", "HEAD").slice(0, 7);
    const failures = wrapper.output().match(/pull failed/g)!.length;
    await rollTo(wrapper, local);
    assert.equal(wrapper.output().match(/pull failed/g)!.length, failures + 1);
    const session = await startSession(wrapper.port);
    assert.equal(session.backend, "v2");
  });

  it("survives the current backend dying: kills its process group, answers 503 until a replacement is ready, and keeps routing draining sessions", async () => {
    const fixture = makeFixture();
    const wrapper = startWrapper(fixture);
    await wrapper.waitFor(backendLine("ready"));
    await listening(wrapper);
    const onV1 = await startSession(wrapper.port);

    writeFileSync(join(fixture.checkout, "gate"), "");
    const v2 = push(fixture, "v2", "gated,child");
    const v2Line = await rollTo(wrapper, v2);
    const v2Pid = Number(v2Line[2]);
    const grandchild = Number((await wrapper.waitFor(/stub v2: child pid (\d+)/))[1]);
    const onV2 = await startSession(wrapper.port);
    assert.equal(onV2.backend, "v2");

    rmSync(join(fixture.checkout, "gate"));
    process.kill(v2Pid, "SIGKILL");
    const crashed = await wrapper.waitFor(backendLine("exited SIGKILL unexpectedly; 1 sessions lost", v2));
    const afterCrash = wrapper.output().indexOf(crashed[0]);
    await wrapper.waitFor(/wrapper: no backend is running/);
    await waitUntil(() => !alive(grandchild), 2_000, "the grandchild is gone");
    const respawn = await wrapper.waitFor(backendLine("starting", v2), 5_000, afterCrash);
    assert.notEqual(Number(respawn[2]), v2Pid);

    const refused = await call(wrapper.port, "POST", "/start", { iso: "x.iso", agent: "agent-1" });
    assert.equal(refused.status, 503);
    assert.deepEqual(refused.json(), { error: "no backend is running" });
    const dead = await call(wrapper.port, "POST", "/send-keys", { id: onV2.id, keys: "x", agent: "agent-1" });
    assert.equal(dead.status, 503);
    const draining = await call(wrapper.port, "POST", "/send-keys", { id: onV1.id, keys: "x", agent: "agent-1" });
    assert.equal(draining.status, 200);
    assert.equal(draining.backend, "v1");

    writeFileSync(join(fixture.checkout, "gate"), "");
    await wrapper.waitFor(backendLine("ready", v2), 5_000, afterCrash);
    const fresh = await startSession(wrapper.port);
    assert.equal(fresh.backend, "v2");
    const lost = await call(wrapper.port, "POST", "/send-keys", { id: onV2.id, keys: "x", agent: "agent-1" });
    assert.equal(lost.status, 404);
    assert.equal(lost.backend, "v2");
  });

  it("restarts a crashing backend once per commit and then waits for the next update check", async () => {
    const fixture = makeFixture("v1", "crash");
    const wrapper = startWrapper(fixture);
    await wrapper.waitFor(backendLine("ready"));
    await listening(wrapper);

    await wrapper.waitFor(backendLine("exited 1 unexpectedly"));
    await wrapper.waitFor(backendLine("ready"), 5_000, wrapper.output().length);
    await wrapper.waitFor(/wrapper: backend at [0-9a-f]{7} already restarted once; waiting for the next update check/);
    await sleep(1_500);
    assert.equal(wrapper.output().match(/exited 1 unexpectedly/g)!.length, 2);
    assert.equal(wrapper.output().match(/\) starting/g)!.length, 2);
    const stats = await call(wrapper.port, "GET", "/stats");
    assert.equal(stats.status, 503);

    wrapper.proc.kill("SIGTERM");
    assert.equal(await wrapper.exited, 0);
  });

  it("refuses to roll past a change to dependencies, migrations, or the wrapper itself", async () => {
    const fixture = makeFixture();
    const wrapper = startWrapper(fixture);
    const v1 = await wrapper.waitFor(backendLine("ready"));
    await listening(wrapper);

    const v2 = push(fixture, "v2", "", {
      "drizzle/0011_new.sql": "select 1;\n",
      "package-lock.json": "{}\n",
      "src/qemu/wrapper.ts": `${readFileSync(join(WORKSPACE, "src/qemu/wrapper.ts"), "utf8")}\n`,
    });
    wrapper.proc.kill("SIGUSR2");
    await wrapper.waitFor(
      new RegExp(
        `wrapper: error: cannot roll ${v1[3]} -> ${v2}: drizzle/0011_new.sql, package-lock.json, src/qemu/wrapper.ts changed; run npm ci and npm run db:migrate, then restart the wrapper`,
      ),
    );
    await sleep(300);
    assert.doesNotMatch(wrapper.output(), backendLine("starting", v2));
    const still = await startSession(wrapper.port);
    assert.equal(still.backend, "v1");
  });

  it("turns a backend that resets the connection into a 502, or a broken response when headers were already out", async () => {
    const fixture = makeFixture();
    const wrapper = startWrapper(fixture);
    const v1 = await wrapper.waitFor(backendLine("ready"));
    await listening(wrapper);

    const reset = await call(wrapper.port, "GET", "/reset");
    assert.equal(reset.status, 502);
    assert.match((reset.json() as { error: string }).error, new RegExp(`^backend 127\\.0\\.0\\.1:${v1[1]} \\(pid ${v1[2]}, ${v1[3]}\\): `));

    await assert.rejects(call(wrapper.port, "GET", "/reset-mid"));

    const stats = await call(wrapper.port, "GET", "/stats");
    assert.equal(stats.status, 200);
    assert.equal((stats.json() as { qemus: number }).qemus, 0);
    assert.equal(wrapper.proc.exitCode, null);
  });

  it("forwards nothing when the client aborts mid-body or sends more than a megabyte", async () => {
    const fixture = makeFixture();
    const wrapper = startWrapper(fixture);
    await wrapper.waitFor(backendLine("ready"));
    await listening(wrapper);

    const huge = await call(wrapper.port, "POST", "/send-keys", `{"id": "x", "keys": "${"k".repeat(2 * 1024 * 1024)}"}`);
    assert.equal(huge.status, 413);
    assert.deepEqual(huge.json(), { error: "request body too large" });

    const socket = connect(wrapper.port, "127.0.0.1");
    await once(socket, "connect");
    socket.write('POST /send-keys HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 60\r\n\r\n{"id": "half');
    await sleep(100);
    socket.destroy();
    await sleep(300);

    assert.doesNotMatch(wrapper.output(), /stub v1: POST \/send-keys/);
    const stats = await call(wrapper.port, "GET", "/stats");
    assert.equal(stats.status, 200);
    assert.equal(wrapper.proc.exitCode, null);
  });

  it("exits 1 when the first backend cannot start or the public port is taken", async () => {
    const broken = startWrapper(makeFixture("v1", "exit1"));
    assert.equal(await broken.exited, 1);
    assert.match(broken.output(), /wrapper: fatal: backend at [0-9a-f]{7} failed to start: .*exited 1/);
    assert.doesNotMatch(broken.output(), /wrapper: listening/);

    const taken = createNetServer();
    taken.listen(0, "127.0.0.1");
    await once(taken, "listening");
    const address = taken.address();
    assert.ok(address !== null && typeof address !== "string");
    try {
      const wrapper = startWrapper(makeFixture(), `127.0.0.1:${address.port}`);
      const v1 = await wrapper.waitFor(backendLine("ready"));
      assert.equal(await wrapper.exited, 1);
      assert.match(wrapper.output(), new RegExp(`wrapper: fatal: listen 127\\.0\\.0\\.1:${address.port}: .*EADDRINUSE`));
      assert.match(wrapper.output(), /stub v1: SIGTERM with 0 sessions/);
      await waitUntil(() => !alive(Number(v1[2])), 2_000, "the backend is gone");
    } finally {
      await new Promise<void>((done) => taken.close(() => done()));
    }
  });

  it("stops every backend on SIGTERM and exits 0 with nothing left behind", async () => {
    const fixture = makeFixture();
    const wrapper = startWrapper(fixture);
    const v1 = await wrapper.waitFor(backendLine("ready"));
    await listening(wrapper);
    await startSession(wrapper.port);
    const v2 = await rollTo(wrapper, push(fixture, "v2"));
    await startSession(wrapper.port);

    wrapper.proc.kill("SIGTERM");
    assert.equal(await wrapper.exited, 0);
    assert.match(wrapper.output(), /wrapper: shutting down \(SIGTERM\); stopping 2 backends/);
    assert.match(wrapper.output(), /stub v1: SIGTERM with 1 sessions/);
    assert.match(wrapper.output(), /stub v2: SIGTERM with 1 sessions/);
    assert.match(wrapper.output(), backendLine("exited 0", v1[3]));
    assert.match(wrapper.output(), backendLine("exited 0", v2[3]));
    assert.equal(alive(Number(v1[2])), false);
    assert.equal(alive(Number(v2[2])), false);
  });
});
