import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as StubProxy from "../support/stub-proxy.ts";

// The root wrapper.
const CLIENT = fileURLToPath(new URL("../../client", import.meta.url));
const EXIT_WITHIN_MS = 30_000;
const SESSION = "session-1";
const AGENT = "agent-1";
const TOKEN = "test-token";

type Run = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

// The wrapper as a process, with exactly the environment given.
const run = (args: ReadonlyArray<string>, env: NodeJS.ProcessEnv, cwd: string): Promise<Run> =>
  new Promise((resolve, reject) => {
    const child = spawn(CLIENT, args, { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      stdout += data;
    });
    child.stderr.on("data", (data: string) => {
      stderr += data;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), EXIT_WITHIN_MS);
    child.on("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

// Spawned from a scratch directory so no repo `.env` reaches the child and fills a variable a test
// blanked; every variable is explicit. A test about `.env` itself passes its own directory.
const runClient = (
  args: ReadonlyArray<string>,
  env: Record<string, string> = {},
  cwd: string = tmpdir(),
): Promise<Run> =>
  run(args, { ...process.env, OLIGARCHY_TOKEN: TOKEN, SERVER_URL: "", ...env }, cwd);

const open: Array<StubProxy.StubProxy> = [];

const proxy = async (script?: StubProxy.Script): Promise<StubProxy.StubProxy> => {
  const started = await StubProxy.startStubProxy(script);
  open.push(started);
  return started;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((stub) => stub.close()));
});

const firstLine = (text: string): string => text.split("\n")[0] ?? "";

describe("./client happy path", () => {
  it("send-keys posts the key string with the agent and the default encoding", async () => {
    const stub = await proxy();
    const result = await runClient([
      "send-keys",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--session-id",
      SESSION,
      "--keys",
      "hello",
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(stub.requests).toEqual([
      {
        method: "POST",
        url: "/send-keys",
        authorization: `Bearer ${TOKEN}`,
        body: { id: SESSION, keys: "hello", encoding: "oligarchy", agent: AGENT },
      },
    ]);
  });

  it("takes the server from SERVER_URL when --server-url is omitted", async () => {
    const stub = await proxy();
    const result = await runClient(
      ["send-keys", "--agent-id", AGENT, "--session-id", SESSION, "--keys", "hello"],
      { SERVER_URL: stub.url },
    );
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(stub.requests).toHaveLength(1);
  });

  it("start posts the ISO url and agent, omits a missing disk, and prints the id", async () => {
    const stub = await proxy();
    const result = await runClient([
      "start",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--iso",
      "https://example.com/omarchy.iso",
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${StubProxy.SESSION_ID}\n`);
    expect(stub.requests).toEqual([
      {
        method: "POST",
        url: "/start",
        authorization: `Bearer ${TOKEN}`,
        body: { iso: "https://example.com/omarchy.iso", agent: AGENT },
      },
    ]);
  });

  it("get-image writes the PNG bytes to --output", async () => {
    const stub = await proxy();
    const output = join(tmpdir(), `oligarchy-client-test-${String(process.pid)}.png`);
    try {
      const result = await runClient([
        "get-image",
        "--agent-id",
        AGENT,
        "--server-url",
        stub.url,
        "--session-id",
        SESSION,
        "-o",
        output,
      ]);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("");
      expect([...(await readFile(output))]).toEqual([...StubProxy.tinyPng()]);
      expect(stub.requests[0]?.method).toBe("GET");
      expect(stub.requests[0]?.url).toBe(`/image?id=${SESSION}&agent=${AGENT}`);
      expect(stub.requests[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    } finally {
      await rm(output, { force: true });
    }
  });

  it("get-serial writes the bytes to stdout without --output", async () => {
    const stub = await proxy();
    const result = await runClient([
      "get-serial",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--session-id",
      SESSION,
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("boot log\n");
    expect(stub.requests[0]?.url).toBe(`/serial?id=${SESSION}&agent=${AGENT}`);
  });

  it("send-mouse posts the point, button, and clicks, and omits button and clicks when not given", async () => {
    const stub = await proxy();
    const base = [
      "send-mouse",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--session-id",
      SESSION,
    ];
    const click = await runClient([
      ...base,
      "--x",
      "0.5",
      "--y",
      "0.25",
      "--button",
      "left",
      "--clicks",
      "2",
    ]);
    expect(click.stderr).toBe("");
    expect(click.code).toBe(0);
    expect(stub.requests[0]?.body).toEqual({
      id: SESSION,
      x: 0.5,
      y: 0.25,
      agent: AGENT,
      button: "left",
      clicks: 2,
    });
    const move = await runClient([...base, "--x", "0", "--y", "1"]);
    expect(move.stderr).toBe("");
    expect(move.code).toBe(0);
    expect(stub.requests[1]?.body).toEqual({ id: SESSION, x: 0, y: 1, agent: AGENT });
  });

  it("intent start and intent end take kebab-case flags", async () => {
    const stub = await proxy();
    const started = await runClient([
      "intent",
      "start",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--session-id",
      SESSION,
      "--test-result-id",
      "result-1",
      "--message",
      "wait for the boot menu",
    ]);
    expect(started.stderr).toBe("");
    expect(started.code).toBe(0);
    const ended = await runClient([
      "intent",
      "end",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--session-id",
      SESSION,
    ]);
    expect(ended.stderr).toBe("");
    expect(ended.code).toBe(0);
    expect(stub.requests.map((request) => [request.url, request.body])).toEqual([
      [
        "/intent/start",
        {
          id: SESSION,
          agent: AGENT,
          test_result_id: "result-1",
          message: "wait for the boot menu",
        },
      ],
      ["/intent/end", { id: SESSION, agent: AGENT }],
    ]);
  });

  it("relinquish posts the agent, prints nothing and exits 0", async () => {
    const stub = await proxy();
    const result = await runClient(["relinquish", "--agent-id", AGENT, "--server-url", stub.url]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(stub.requests).toEqual([
      {
        method: "POST",
        url: "/relinquish",
        authorization: `Bearer ${TOKEN}`,
        body: { agent: AGENT },
      },
    ]);
  });

  it("stop posts the verdict and reason, and a bare stop posts neither", async () => {
    const stub = await proxy();
    const base = ["stop", "--agent-id", AGENT, "--server-url", stub.url, "--session-id", SESSION];
    const verdict = await runClient([...base, "--status", "failed", "--reason", "installer hung"]);
    expect(verdict.stderr).toBe("");
    expect(verdict.code).toBe(0);
    expect(stub.requests[0]?.body).toEqual({
      id: SESSION,
      agent: AGENT,
      status: "failed",
      reason: "installer hung",
    });
    const abort = await runClient(base);
    expect(abort.stderr).toBe("");
    expect(abort.code).toBe(0);
    expect(stub.requests[1]?.body).toEqual({ id: SESSION, agent: AGENT });
  });

  it("start --resume posts mode resume and prints the id; with --disk it exits 1 before any request", async () => {
    const stub = await proxy();
    const iso = "https://example.com/omarchy.iso";
    const resumed = await runClient([
      "start",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--iso",
      iso,
      "--resume",
    ]);
    expect(resumed.stderr).toBe("");
    expect(resumed.code).toBe(0);
    expect(resumed.stdout).toBe(`${StubProxy.SESSION_ID}\n`);
    expect(stub.requests[0]).toMatchObject({
      method: "POST",
      url: "/start",
      body: { iso, agent: AGENT, mode: "resume" },
    });
    const both = await runClient([
      "start",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--iso",
      iso,
      "--resume",
      "--disk",
      "/mnt/custom.qcow2",
    ]);
    expect(both.code).toBe(1);
    // Effect's CLI renders a UserError as a blank line, ERROR, then the message.
    expect(both.stderr).toContain("start: --resume boots the minted disk; --disk cannot be given");
    expect(stub.requests).toHaveLength(1);
  });

  it("reserve posts the agent with the server pin, prints nothing and exits 0", async () => {
    const stub = await proxy();
    const result = await runClient([
      "reserve",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--server",
      "http://127.0.0.1:55331",
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(stub.requests[0]).toMatchObject({
      method: "POST",
      url: "/reserve",
      body: { agent: AGENT, server: "http://127.0.0.1:55331" },
    });
    const help = await runClient(["reserve", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/--server\b/);
  });

  it("save posts the session and the agent, prints saved and exits 0", async () => {
    const stub = await proxy();
    const result = await runClient([
      "save",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--session-id",
      SESSION,
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("saved\n");
    expect(stub.requests[0]).toMatchObject({
      method: "POST",
      url: "/save",
      body: { id: SESSION, agent: AGENT },
    });
    const help = await runClient(["save", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/--session-id/);
  });

  it("follow streams the proxy's event lines to stdout as they arrive and exits 0 when the stream ends", async () => {
    const stub = await proxy();
    const result = await runClient([
      "follow",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--session-id",
      SESSION,
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(StubProxy.FOLLOW_LINES.join(""));
    expect(stub.requests).toEqual([
      {
        method: "GET",
        url: `/follow?id=${SESSION}`,
        authorization: `Bearer ${TOKEN}`,
        body: undefined,
      },
    ]);
  });

  it("prints the actions for --help and exits 0", async () => {
    const result = await runClient(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/start/);
    expect(result.stdout).toMatch(/intent/);
    expect(result.stdout).toMatch(/follow/);
    const action = await runClient(["stop", "--help"]);
    expect(action.code).toBe(0);
    expect(action.stdout).toMatch(/--session-id/);
    expect(action.stdout).toMatch(/--status/);
  });

  it("a bare client prints help on stdout and exits 0", async () => {
    const result = await runClient([]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/send-keys/);
  });
});

describe("./client unhappy path", () => {
  it("rejects a QEMU action without --agent-id with Effect's usage text", async () => {
    const result = await runClient(["send-keys", "--session-id", SESSION, "--keys", "hello"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/--agent-id/);
  });

  it("rejects an underscore flag", async () => {
    const result = await runClient(["intent", "end", "--agent-id", AGENT, "--session_id", SESSION]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/--session_id/);
  });

  // The wrapper passes --no-env-file: Bun's own loader would read `.env.local` as well and expand
  // `$` inside values before the provider ran, and the environment would win with the wrong value.
  it("reads .env through the provider alone: a $ stays literal and .env.local is not read", async () => {
    const stub = await proxy();
    const dir = await mkdtemp(join(tmpdir(), "oligarchy-client-env-"));
    await writeFile(join(dir, ".env"), `OLIGARCHY_TOKEN=to$ken\nSERVER_URL=${stub.url}\n`);
    await writeFile(join(dir, ".env.local"), "OLIGARCHY_TOKEN=from-local\n");
    try {
      // PATH and HOME only: a variable the runtime's loader could fill must be absent, not blank.
      const result = await run(
        ["relinquish", "--agent-id", AGENT],
        { PATH: process.env.PATH, HOME: process.env.HOME },
        dir,
      );
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(stub.requests).toEqual([
        {
          method: "POST",
          url: "/relinquish",
          authorization: "Bearer to$ken",
          body: { agent: AGENT },
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prints the cause when the layers themselves fail: an unreadable .env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oligarchy-client-env-"));
    // A directory named .env exists, so the provider tries to read it and fails with EISDIR.
    await mkdir(join(dir, ".env"));
    try {
      const result = await runClient(
        ["start", "--agent-id", AGENT, "--server-url", "http://127.0.0.1:1"],
        {},
        dir,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/EISDIR|\.env/);
      expect(result.stderr).not.toContain("USAGE");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a missing OLIGARCHY_TOKEN before calling the proxy", async () => {
    const stub = await proxy();
    const result = await runClient(
      [
        "send-keys",
        "--agent-id",
        AGENT,
        "--server-url",
        stub.url,
        "--session-id",
        SESSION,
        "--keys",
        "hello",
      ],
      { OLIGARCHY_TOKEN: "" },
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(firstLine(result.stderr)).toBe("OLIGARCHY_TOKEN is not set");
    expect(stub.requests).toEqual([]);
  });

  it("rejects an unknown action with a usage error", async () => {
    const result = await runClient(["bogus", "--agent-id", AGENT]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/bogus/);
  });

  it("prints the server's error as a headline, then the cause, and exits 1", async () => {
    const stub = await proxy(() => StubProxy.refusal(404, "nope"));
    const result = await runClient([
      "send-keys",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--session-id",
      SESSION,
      "--keys",
      "hello",
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(firstLine(result.stderr)).toBe("nope");
    expect(result.stderr.split("\n").length).toBeGreaterThan(1);
    expect(result.stderr).not.toMatch(/at file:\/\/.*http\.ts/);
  });

  it("relinquish without a reservation prints `no reservation` as the headline and exits 1", async () => {
    const stub = await proxy(() => StubProxy.refusal(400, "no reservation"));
    const result = await runClient(["relinquish", "--agent-id", AGENT, "--server-url", stub.url]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(firstLine(result.stderr)).toBe("no reservation");
    expect(stub.requests.map((request) => request.url)).toEqual(["/relinquish"]);
  });

  it("prints a non-JSON error body raw and an empty one as `request failed`", async () => {
    const raw = await proxy(() => ({
      status: 502,
      headers: { "Content-Type": "text/html" },
      body: "<h1>Bad Gateway</h1>",
    }));
    const args = ["send-keys", "--agent-id", AGENT, "--session-id", SESSION, "--keys", "hello"];
    const html = await runClient([...args, "--server-url", raw.url]);
    expect(html.code).toBe(1);
    expect(firstLine(html.stderr)).toBe("<h1>Bad Gateway</h1>");

    const empty = await proxy(() => ({ status: 500, body: "" }));
    const nothing = await runClient([...args, "--server-url", empty.url]);
    expect(nothing.code).toBe(1);
    expect(firstLine(nothing.stderr)).toBe("request failed");
  });

  it("rejects a send-mouse coordinate outside 0..1 before calling the proxy", async () => {
    const stub = await proxy();
    const result = await runClient([
      "send-mouse",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--session-id",
      SESSION,
      "--x",
      "1.5",
      "--y",
      "0.5",
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/--x and --y must be in 0\.\.1/);
    expect(stub.requests).toEqual([]);
  });

  it("rejects send-mouse --clicks without --button before calling the proxy", async () => {
    const stub = await proxy();
    const result = await runClient([
      "send-mouse",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--session-id",
      SESSION,
      "--x",
      "0.5",
      "--y",
      "0.5",
      "--clicks",
      "2",
    ]);
    expect(result.code).toBe(1);
    expect(firstLine(result.stderr)).toBe("send-mouse: --clicks needs --button");
    expect(stub.requests).toEqual([]);
  });

  it("rejects send-mouse --to-x without --to-y before calling the proxy", async () => {
    const stub = await proxy();
    const result = await runClient([
      "send-mouse",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--session-id",
      SESSION,
      "--x",
      "0.5",
      "--y",
      "0.5",
      "--button",
      "left",
      "--to-x",
      "0.9",
    ]);
    expect(result.code).toBe(1);
    expect(firstLine(result.stderr)).toBe("send-mouse: --to-x and --to-y go together");
    expect(stub.requests).toEqual([]);
  });

  it("send-mouse posts a drag with its modifiers and a press as the wire's fields", async () => {
    const stub = await proxy();
    const base = [
      "send-mouse",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--session-id",
      SESSION,
    ];
    const drag = await runClient([
      ...base,
      "--x",
      "0.1",
      "--y",
      "0.2",
      "--button",
      "left",
      "--to-x",
      "0.9",
      "--to-y",
      "0.2",
      "--modifier",
      "super",
    ]);
    expect(drag.stderr).toBe("");
    expect(drag.code).toBe(0);
    expect(stub.requests[0]?.body).toEqual({
      id: SESSION,
      x: 0.1,
      y: 0.2,
      agent: AGENT,
      button: "left",
      to: { x: 0.9, y: 0.2 },
      modifiers: ["super"],
    });
    const held = await runClient([
      ...base,
      "--x",
      "0.5",
      "--y",
      "0.5",
      "--button",
      "left",
      "--press",
      "down",
    ]);
    expect(held.stderr).toBe("");
    expect(held.code).toBe(0);
    expect(stub.requests[1]?.body).toEqual({
      id: SESSION,
      x: 0.5,
      y: 0.5,
      agent: AGENT,
      button: "left",
      press: "down",
    });
  });

  it("rejects a start whose local ISO does not exist before calling the proxy", async () => {
    const stub = await proxy();
    const result = await runClient([
      "start",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--iso",
      "missing.iso",
    ]);
    expect(result.code).toBe(1);
    expect(firstLine(result.stderr)).toMatch(
      /^iso: ENOENT: no such file or directory, stat '\/.*\/missing\.iso'$/,
    );
    expect(stub.requests).toEqual([]);
  });

  it("rejects a positional session id and a missing --keys", async () => {
    const positional = await runClient([
      "send-keys",
      "--agent-id",
      AGENT,
      "--session-id",
      SESSION,
      "extra",
      "--keys",
      "hello",
    ]);
    expect(positional.code).toBe(1);
    expect(positional.stderr).toMatch(/extra/);

    const noFlag = await runClient(["send-keys", "--agent-id", AGENT, SESSION, "--keys", "hello"]);
    expect(noFlag.code).toBe(1);

    const missingKeys = await runClient([
      "send-keys",
      "--agent-id",
      AGENT,
      "--session-id",
      SESSION,
    ]);
    expect(missingKeys.code).toBe(1);
    expect(missingKeys.stderr).toMatch(/--keys/);

    const stopPositional = await runClient([
      "stop",
      "--agent-id",
      AGENT,
      "--session-id",
      SESSION,
      "failed",
    ]);
    expect(stopPositional.code).toBe(1);
    expect(stopPositional.stderr).toMatch(/failed/);
  });

  it("follow prints the proxy's refusal as a headline and exits 1 without printing a stream", async () => {
    const stub = await proxy();
    const result = await runClient([
      "follow",
      "--agent-id",
      AGENT,
      "--server-url",
      stub.url,
      "--session-id",
      StubProxy.ENDED_ID,
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(firstLine(result.stderr)).toBe(
      `session "${StubProxy.ENDED_ID}" has already completed (succeeded)`,
    );
    expect(result.stderr).not.toContain("\x1b[?1049h");
    expect(stub.requests[0]?.url).toBe(`/follow?id=${StubProxy.ENDED_ID}`);

    const missingId = await runClient(["follow", "--agent-id", AGENT]);
    expect(missingId.code).toBe(1);
    expect(missingId.stderr).toMatch(/--session-id/);
  });

  it("spells out a refused connection as `<METHOD> <url> failed: <cause>` and exits 1", async () => {
    const closed = await StubProxy.startStubProxy();
    await closed.close();
    const result = await runClient([
      "send-keys",
      "--agent-id",
      AGENT,
      "--server-url",
      closed.url,
      "--session-id",
      SESSION,
      "--keys",
      "hello",
    ]);
    expect(result.code).toBe(1);
    expect(firstLine(result.stderr)).toMatch(
      /^POST http:\/\/127\.0\.0\.1:\d+\/send-keys failed: connect ECONNREFUSED 127\.0\.0\.1:\d+$/,
    );
    expect(result.stderr).not.toMatch(/fetch failed/);
    expect(result.stderr).not.toMatch(/at file:\/\/.*http\.ts/);
  });
});

// The wrapper runs a bytecode bundle it builds under node_modules/.cache and rebuilds when a
// source is newer; when the build fails it says so and runs the sources as they are.
describe("./client bundle cache", () => {
  const CACHE = fileURLToPath(
    new URL("../../node_modules/.cache/oligarchy/client", import.meta.url),
  );
  const BUNDLE = join(CACHE, "main.js");
  const BYTECODE = join(CACHE, "main.js.jsc");
  const EPOCH = new Date(0);

  // A cache older than every source, so the next call must rebuild.
  const age = async (): Promise<void> => {
    await utimes(BUNDLE, EPOCH, EPOCH);
    await utimes(BYTECODE, EPOCH, EPOCH);
  };

  it("builds the bundle once and reuses it while no source is newer", async () => {
    const first = await runClient(["--help"]);
    expect(first.stderr).toBe("");
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("Drive a guest machine through the qemu server");
    const built = await stat(BYTECODE);
    expect((await stat(BUNDLE)).size).toBeGreaterThan(0);

    const second = await runClient(["--help"]);
    expect(second).toEqual(first);
    expect((await stat(BYTECODE)).mtimeMs).toBe(built.mtimeMs);
  });

  it("rebuilds a bundle older than the sources", async () => {
    await runClient(["--help"]);
    await age();
    const result = await runClient(["--help"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect((await stat(BYTECODE)).mtimeMs).toBeGreaterThan(0);
    expect((await stat(BUNDLE)).mtimeMs).toBeGreaterThan(0);
  });

  // Two builds landing at once can leave one file from each; either file older than a source, or
  // missing, is a rebuild, so the next call repairs it instead of running the stale half.
  it("rebuilds when only the bundle is older than the sources, or missing", async () => {
    await runClient(["--help"]);
    await utimes(BUNDLE, EPOCH, EPOCH);
    const aged = await runClient(["--help"]);
    expect(aged.stderr).toBe("");
    expect(aged.code).toBe(0);
    expect((await stat(BUNDLE)).mtimeMs).toBeGreaterThan(0);

    await rm(BUNDLE);
    const missing = await runClient(["--help"]);
    expect(missing.stderr).toBe("");
    expect(missing.code).toBe(0);
    expect(missing.stdout).toBe(aged.stdout);
    expect((await stat(BUNDLE)).size).toBeGreaterThan(0);
  });

  it("runs the sources, and says so, when the build fails", async () => {
    const fresh = await runClient(["--help"]);
    await age();
    // A `bun` ahead on PATH that refuses to build and hands every other call to the real one.
    const dir = await mkdtemp(join(tmpdir(), "oligarchy-client-bun-"));
    await writeFile(
      join(dir, "bun"),
      `#!/bin/sh\n[ "$1" = build ] && { echo "build refused" >&2; exit 1; }\nexec "${process.execPath}" "$@"\n`,
      { mode: 0o755 },
    );
    try {
      const result = await runClient(["--help"], { PATH: `${dir}:${process.env.PATH ?? ""}` });
      expect(result.code).toBe(0);
      expect(result.stdout).toBe(fresh.stdout);
      expect(result.stderr).toBe(
        "build refused\nclient: bundle build failed; running the sources\n",
      );
      expect((await stat(BYTECODE)).mtimeMs).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
