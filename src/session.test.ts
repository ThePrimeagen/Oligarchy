/* oxlint-disable no-control-regex -- the escape sequences under test */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { once } from "node:events";
import { createInterface, type AsyncCompleter, type CompleterResult } from "node:readline";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { deflateSync } from "node:zlib";
import { closeFollowPicker, pickFollowSession, type SessionListItem } from "./session/actions/follow.ts";

const SESSION = resolve(import.meta.dirname, "../session");
const SESSION_ID = "6f1c0000-0000-4000-8000-00000000e2a9";
const FOLLOWED_ID = "7a2d0000-0000-4000-8000-00000000f011";
const PENDING_ID = "ff88a0b1-0851-47a7-91d3-acbfb20b8673";
const ENDED_ID = "8b3e0000-0000-4000-8000-00000000a1c2";
const DROPPED_ID = "5d0a0000-0000-4000-8000-00000000c3e4";
const ENDLESS_ID = "4e1b0000-0000-4000-8000-00000000d4f5";
const IMAGE_ID = "9c4f0000-0000-4000-8000-00000000b2d3";
const KITTY_PLACE = /\x1b_Ga=T,f=100,i=1,q=2,C=1,c=\d+,r=\d+,m=0;([A-Za-z0-9+/=]+)\x1b\\/;
const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";

async function runSession(args: string[], lines: string[], env: NodeJS.ProcessEnv = {}): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(SESSION, args, {
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim(),
      OLIGARCHY_TOKEN: "test-token",
      SERVER_URL: "",
      TERM: "dumb",
      TERM_PROGRAM: "",
      ...env,
    },
  });
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
  child.stdin.end(lines.map((line) => `${line}\n`).join(""));
  const [code] = await once(child, "close");
  return { code: code as number | null, stdout, stderr };
}

async function runTtySession(input: string, afterInput: string, env: NodeJS.ProcessEnv = {}): Promise<{
  code: number | null;
  output: string;
}> {
  const child = spawn("script", ["-qfec", `${SESSION} --server-url http://127.0.0.1:1`, "/dev/null"], {
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim(),
      OLIGARCHY_TOKEN: "test-token",
      DATABASE_URL: "",
      SERVER_URL: "",
      TERM: "xterm-256color",
      ...env,
    },
  });
  let output = "";
  let inputSent = false;
  let afterInputSent = false;
  let failSafe: NodeJS.Timeout | undefined;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (data: string) => {
    output += data;
    if (!inputSent && output.includes("session> ")) {
      inputSent = true;
      child.stdin.write(input);
      failSafe = setTimeout(() => {
        if (!afterInputSent) {
          afterInputSent = true;
          child.stdin.end(afterInput);
        }
      }, 5000);
    }
    if (inputSent && !afterInputSent && output.includes("DATABASE_URL is not set")) {
      afterInputSent = true;
      clearTimeout(failSafe);
      setImmediate(() => child.stdin.end(afterInput));
    }
  });
  const [code] = await once(child, "close");
  clearTimeout(failSafe);
  return { code: code as number | null, output };
}

function pickerTerminal(columns = 100, rows = 24): {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  readOutput: () => string;
} {
  const inputStream = new PassThrough();
  const outputStream = new PassThrough();
  let written = "";
  outputStream.setEncoding("utf8");
  outputStream.on("data", (data: string) => {
    written += data;
  });
  const input = inputStream as unknown as NodeJS.ReadStream;
  const output = outputStream as unknown as NodeJS.WriteStream;
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: () => input });
  Object.assign(output, { isTTY: true, columns, rows });
  return { input, output, readOutput: () => written };
}

type Received = { method: string | undefined; url: string | undefined; authorization: string | undefined; body: unknown };

// A 2x2 8-bit RGB PNG, the shape QEMU's screendump writes: red, green / blue, white.
function tinyPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function stubProxy(): Promise<{ server: Server; url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((incoming, response) => {
    let body = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (data: string) => {
      body += data;
    });
    incoming.on("end", () => {
      received.push({
        method: incoming.method,
        url: incoming.url,
        authorization: incoming.headers.authorization,
        body: body === "" ? undefined : (JSON.parse(body) as unknown),
      });
      if (incoming.url === "/start") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ id: SESSION_ID }));
        return;
      }
      if (incoming.url?.startsWith("/image")) {
        response.writeHead(200, { "Content-Type": "image/png" });
        response.end(tinyPng());
        return;
      }
      if (incoming.url?.startsWith("/serial")) {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("boot log\n");
        return;
      }
      if (incoming.url === `/follow?id=${DROPPED_ID}`) {
        response.writeHead(200, { "Content-Type": "application/x-ndjson" });
        response.end('{"type":"session","status":"running"}\n');
        return;
      }
      if (incoming.url === `/follow?id=${ENDLESS_ID}`) {
        response.writeHead(200, { "Content-Type": "application/x-ndjson" });
        response.write('{"type":"session","status":"running"}\n{"type":"intent","state":"started","message":"still going"}\n');
        server.once("close", () => response.end());
        return;
      }
      if (incoming.url === `/follow?id=${ENDED_ID}`) {
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: `session "${ENDED_ID}" has already completed (succeeded)` }));
        return;
      }
      if (incoming.url === `/follow?id=${FOLLOWED_ID}`) {
        const events = [
          { type: "session", status: "pending" },
          { type: "session", status: "running" },
          { type: "intent", state: "started", message: "wait for the boot menu" },
          { type: "action", id: 1, name: "send-keys", state: "running" },
          { type: "action", id: 1, state: "completed" },
          { type: "action", id: 2, name: "get-image", state: "running" },
          { type: "image", id: IMAGE_ID, png: tinyPng().toString("base64") },
          { type: "action", id: 2, state: "completed" },
          { type: "action", id: 3, name: "send-mouse", state: "running" },
          { type: "action", id: 3, state: "failed" },
          { type: "intent", state: "completed" },
          { type: "action", id: 4, name: "get-serial", state: "running" },
          { type: "action", id: 4, state: "completed" },
          { type: "session", status: "succeeded" },
        ];
        response.writeHead(200, { "Content-Type": "application/x-ndjson" });
        let i = 0;
        const tick = setInterval(() => {
          response.write(`${JSON.stringify(events[i])}\n`);
          i++;
          if (i === events.length) {
            clearInterval(tick);
            response.end();
          }
        }, 60);
        return;
      }
      if (incoming.url === "/intent/start" && (body as string).includes("second")) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end('{"error":"Cannot start one intent when one\'s already running. Please end your previous intent."}');
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":"true"}');
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return { server, url: `http://127.0.0.1:${address.port}`, received };
}

function close(server: Server): Promise<void> {
  return new Promise<void>((done) => server.close(() => done()));
}

describe("./session follow completion", () => {
  it("owns input while the session list is loading so a fast Enter cannot submit follow", async () => {
    const term = pickerTerminal();
    let provideRows: (rows: SessionListItem[]) => void = () => undefined;
    const rows = new Promise<SessionListItem[]>((resolve) => {
      provideRows = resolve;
    });
    const selection = pickFollowSession(rows, term.input, term.output, 16);
    term.input.emit("keypress", "\r", { name: "return" });
    provideRows([{ id: FOLLOWED_ID, status: "running", startedAt: "2026-09-04T11:59:55.000Z" }]);
    await new Promise((resolve) => setImmediate(resolve));
    let resolved = false;
    void selection.then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(resolved, false);
    term.input.emit("keypress", "\r", { name: "return" });
    assert.equal(await selection, FOLLOWED_ID);
  });

  it("cancels with Escape or Ctrl-C while the session list is loading", async () => {
    for (const [text, key] of [
      ["\x1b", { name: "escape" }],
      ["\x03", { name: "c", ctrl: true }],
    ] as const) {
      const term = pickerTerminal();
      let provideRows: (rows: SessionListItem[]) => void = () => undefined;
      const rows = new Promise<SessionListItem[]>((resolve) => {
        provideRows = resolve;
      });
      const selection = pickFollowSession(rows, term.input, term.output, 16);
      term.input.emit("keypress", text, key);

      assert.equal(await selection, undefined);
      provideRows([{ id: FOLLOWED_ID, status: "running", startedAt: "2026-09-04T11:59:55.000Z" }]);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(term.readOutput().includes(FOLLOWED_ID), false);
    }
  });

  it("restores the terminal when shutdown closes a loading picker", async () => {
    const term = pickerTerminal();
    let provideRows: (rows: SessionListItem[]) => void = () => undefined;
    const rows = new Promise<SessionListItem[]>((resolve) => {
      provideRows = resolve;
    });
    const selection = pickFollowSession(rows, term.input, term.output, 16);
    closeFollowPicker();

    assert.equal(await selection, undefined);
    provideRows([{ id: FOLLOWED_ID, status: "running", startedAt: "2026-09-04T11:59:55.000Z" }]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(term.readOutput(), /\x1b\[\?25l.*\x1b\[\?25h/s);
    assert.equal(term.readOutput().includes(FOLLOWED_ID), false);
  });

  it("bounds and truncates the picker on a narrow, short terminal", async () => {
    const term = pickerTerminal(30, 6);
    const rows: SessionListItem[] = Array.from({ length: 10 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      status: "running",
      startedAt: "2026-09-04T11:59:55.000Z",
    }));
    const selection = pickFollowSession(Promise.resolve(rows), term.input, term.output, 16);
    await new Promise((resolve) => setImmediate(resolve));
    term.input.emit("keypress", "", { name: "up" });
    term.input.emit("keypress", "\r", { name: "return" });

    assert.equal(await selection, rows[9].id);
    const output = term.readOutput();
    const finalDraw = output.slice(output.lastIndexOf("active sessions"));
    const plain = finalDraw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    const lines = plain.split("\r\n");
    assert.equal(lines.length, 5);
    for (const line of lines) {
      assert.ok(line.replaceAll("\r", "").length <= 30);
    }
  });

  it("shows running sessions first, colors statuses, and selects with the keyboard", async () => {
    const term = pickerTerminal();
    const selection = pickFollowSession(
      Promise.resolve([
        { id: PENDING_ID, status: "downloading", startedAt: "2026-09-04T11:58:30.000Z" },
        { id: "00000000-0000-4000-8000-000000000001", status: "succeeded", startedAt: "2026-09-04T11:58:00.000Z" },
        { id: FOLLOWED_ID, status: "running", startedAt: "2026-09-04T11:59:55.000Z" },
      ]),
      term.input,
      term.output,
      16,
    );
    await new Promise((resolve) => setImmediate(resolve));
    term.input.emit("keypress", "\t", { name: "tab", shift: false });
    term.input.emit("keypress", "\r", { name: "return" });

    assert.equal(await selection, PENDING_ID);
    const output = term.readOutput();
    assert.ok(output.indexOf(FOLLOWED_ID) < output.indexOf(PENDING_ID));
    assert.match(output, new RegExp(`\\x1b\\[33mrunning\\s*\\x1b\\[0m\\s+${FOLLOWED_ID}`));
    assert.match(output, new RegExp(`\\x1b\\[90mpending\\s*\\x1b\\[0m\\s+${PENDING_ID}`));
    assert.equal(output.includes("00000000-0000-4000-8000-000000000001"), false);
  });

  it("leaves the selected UUID editable when LF arrives after the selected CR", async () => {
    const term = pickerTerminal();
    const complete = async (line: string): Promise<CompleterResult> => {
      const followArg = /^follow\s+(\S*)$/.exec(line);
      assert.ok(followArg !== null);
      const sessionId = await pickFollowSession(
        Promise.resolve([{ id: FOLLOWED_ID, status: "running", startedAt: "2026-09-04T11:59:55.000Z" }]),
        term.input,
        term.output,
        16,
      );
      return [sessionId === undefined ? [] : [sessionId], followArg[1]];
    };
    const completer: AsyncCompleter = (line, callback) => {
      void complete(line).then(
        (result) => callback(null, result),
        (err) => callback(err as Error),
      );
    };
    const termName = process.env.TERM;
    process.env.TERM = "xterm-256color";
    const readline = createInterface({ input: term.input, output: term.output, completer, terminal: true });
    if (termName === undefined) {
      delete process.env.TERM;
    } else {
      process.env.TERM = termName;
    }
    const submitted: string[] = [];
    readline.on("line", (line) => submitted.push(line));
    readline.write("follow ");
    term.input.emit("keypress", "\t", { name: "tab" });
    await new Promise((resolve) => setImmediate(resolve));
    term.input.emit("keypress", "\r", { name: "return" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    term.input.emit("keypress", "\n", { name: "enter" });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(submitted, []);
    assert.equal(readline.line, `follow ${FOLLOWED_ID}`);
    readline.close();
  });

  it("reports that there is nothing to follow when no active sessions exist", async () => {
    const term = pickerTerminal();
    await assert.rejects(
      pickFollowSession(
        Promise.resolve([{ id: ENDED_ID, status: "failed", startedAt: "2026-09-04T11:58:00.000Z" }]),
        term.input,
        term.output,
        16,
      ),
      /no running or pending sessions/,
    );

    assert.doesNotMatch(term.readOutput(), /no running or pending sessions/);
  });

  it("cancels without selecting when escape is pressed", async () => {
    const term = pickerTerminal();
    const selection = pickFollowSession(
      Promise.resolve([{ id: FOLLOWED_ID, status: "running", startedAt: "2026-09-04T11:59:55.000Z" }]),
      term.input,
      term.output,
      16,
    );
    await new Promise((resolve) => setImmediate(resolve));
    term.input.emit("keypress", "\x1b", { name: "escape" });

    assert.equal(await selection, undefined);
    assert.match(term.readOutput(), /\x1b\[\?25l.*\x1b\[\?25h/s);
  });
});

describe("./session happy path", () => {
  it("drives one session through every command with the client's flags and one agent id", async () => {
    const proxy = await stubProxy();
    try {
      const result = await runSession(
        ["--server-url", proxy.url],
        [
          "start https://example.com/omarchy.iso",
          "intent start wait for the boot menu",
          "status",
          "send-keys hello world<ENTER>",
          "send-mouse 0.5 0.25 left 2",
          "send-mouse 0 1",
          "get-image",
          "get-serial",
          "intent end",
          "stop succeeded all good",
          "exit",
        ],
      );
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);

      const agent = (proxy.received[0].body as { agent: string }).agent;
      assert.match(agent, /^session-[0-9a-f-]{36}$/);
      for (const request of proxy.received) {
        assert.equal(request.authorization, "Bearer test-token");
      }
      assert.deepEqual(
        proxy.received.map((request) => [request.method, request.url, request.body]),
        [
          ["POST", "/start", { iso: "https://example.com/omarchy.iso", agent }],
          ["POST", "/intent/start", { id: SESSION_ID, agent, test_result_id: "manual", message: "wait for the boot menu" }],
          ["POST", "/send-keys", { id: SESSION_ID, keys: "hello world<ENTER>", encoding: "oligarchy", agent }],
          ["POST", "/send-mouse", { id: SESSION_ID, x: 0.5, y: 0.25, agent, button: "left", clicks: 2 }],
          ["POST", "/send-mouse", { id: SESSION_ID, x: 0, y: 1, agent }],
          ["GET", `/image?id=${SESSION_ID}&agent=${agent}`, undefined],
          ["GET", `/serial?id=${SESSION_ID}&agent=${agent}`, undefined],
          ["POST", "/intent/end", { id: SESSION_ID, agent }],
          ["POST", "/stop", { id: SESSION_ID, agent, status: "succeeded", reason: "all good" }],
        ],
      );

      assert.ok(result.stdout.includes(`agent   ${agent}`));
      assert.ok(result.stdout.includes(`session ${SESSION_ID}`));
      assert.ok(result.stdout.includes("intent  open"));
      assert.ok(result.stdout.includes("▀"));
      assert.ok(result.stdout.includes("boot log"));
      assert.ok(result.stdout.includes(`stopped ${SESSION_ID}`));
      assert.equal(result.stdout.includes("stopping session"), false);
    } finally {
      await close(proxy.server);
    }
  });

  it("stops a running session when stdin closes", async () => {
    const proxy = await stubProxy();
    try {
      const result = await runSession(["--server-url", proxy.url], ["start https://example.com/omarchy.iso"]);
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.ok(result.stdout.includes(`stopping session ${SESSION_ID}`));
      const agent = (proxy.received[0].body as { agent: string }).agent;
      assert.deepEqual(proxy.received[1], {
        method: "POST",
        url: "/stop",
        authorization: "Bearer test-token",
        body: { id: SESSION_ID, agent },
      });
    } finally {
      await close(proxy.server);
    }
  });

  it("follow draws intents and actions down the left, places each image on the right, and hands the REPL back when the session ends", async () => {
    const proxy = await stubProxy();
    try {
      const result = await runSession(["--server-url", proxy.url], [`follow ${FOLLOWED_ID}`, "status", "exit"], { TERM_PROGRAM: "ghostty" });
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.deepEqual(
        proxy.received.map((request) => [request.method, request.url, request.authorization]),
        [["GET", `/follow?id=${FOLLOWED_ID}`, "Bearer test-token"]],
      );

      const out = result.stdout;
      const on = out.indexOf(ALT_SCREEN_ON);
      const off = out.indexOf(ALT_SCREEN_OFF);
      assert.ok(on !== -1 && off !== -1 && on < off, "follow takes the alternate screen and gives it back");
      const view = out.slice(on, off);

      assert.match(view, /following 7a2d0000/);
      assert.match(view, /\x1b\[90m[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] wait for the boot menu/, "a running intent is gray with a spinner");
      assert.match(view, /\x1b\[32m✓ wait for the boot menu/, "a completed intent turns green");
      assert.match(view, /\x1b\[90m[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] send-keys/, "a running action is gray with a spinner");
      assert.match(view, /\x1b\[32m✓ send-keys/, "a completed action turns green");
      assert.match(view, /\x1b\[32m✓ get-image/);
      assert.match(view, /\x1b\[31m✗ send-mouse/, "a failed action turns red");
      assert.ok(view.indexOf("wait for the boot menu") < view.indexOf("send-keys"), "the intent is drawn above its actions");
      assert.match(view, /\x1b\[\d+;2H\x1b\[32m✓ wait for the boot menu/, "intents start at the margin");
      assert.match(view, /\x1b\[\d+;2H  \x1b\[32m✓ send-keys/, "actions are indented under the intent");
      assert.match(view, /\x1b\[\d+;2H\x1b\[32m✓ get-serial/, "an action outside any intent sits at the margin");

      const placed = KITTY_PLACE.exec(view);
      assert.ok(placed !== null, "the image is placed with the kitty graphics protocol");
      assert.equal(placed[1], tinyPng().toString("base64"));
      assert.match(view, /\x1b\[2;42H\x1b_Ga=T/, "the image sits to the right of the action column");
      assert.ok(view.includes("\x1b_Ga=d,d=I,i=1,q=2\x1b\\"), "the previous image is deleted before the next is placed");
      assert.ok(out.slice(off - 40, off).includes("\x1b_Ga=d,d=A,q=2\x1b\\"), "images are cleared when follow leaves the screen");
      assert.doesNotMatch(view, /\n/, "the view never scrolls the screen");

      const after = out.slice(off);
      assert.ok(after.includes(`session ${FOLLOWED_ID} succeeded`));
      assert.ok(after.includes("session none"), "the REPL is back and has no session of its own");
    } finally {
      await close(proxy.server);
    }
  });

  it("takes the server from SERVER_URL when --server-url is omitted", async () => {
    const proxy = await stubProxy();
    try {
      const result = await runSession([], ["start https://example.com/omarchy.iso", "stop", "exit"], { SERVER_URL: proxy.url });
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.equal(proxy.received.length, 2);
      assert.ok(result.stdout.includes(`server ${proxy.url}`));
    } finally {
      await close(proxy.server);
    }
  });
});

describe("./session unhappy path", () => {
  it("enters follow completion when Tab and Enter arrive in one PTY write", async () => {
    const result = await runTtySession("follow \t\r", "\x15exit\r");
    assert.equal(result.code, 0);
    assert.match(result.output, /DATABASE_URL is not set/);
    assert.doesNotMatch(result.output, /usage: follow <session-id>/);
  });

  it("reports a failed ctrl session list and keeps the prompt usable", async () => {
    const result = await runTtySession("follow \t", "\x15exit\r");
    assert.equal(result.code, 0);
    assert.match(result.output, /DATABASE_URL is not set/);
    assert.ok((result.output.match(/session> /g) ?? []).length >= 2);
  });

  it("refuses commands before start, unknown commands, and a malformed send-mouse without calling the proxy", async () => {
    const proxy = await stubProxy();
    try {
      const result = await runSession(
        ["--server-url", proxy.url],
        ["send-keys hello", "reboot", "start https://example.com/omarchy.iso", "send-mouse 0.5", "stop", "exit"],
      );
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.ok(result.stdout.includes("no session. run start first."));
      assert.ok(result.stdout.includes("unknown command: reboot"));
      assert.ok(result.stdout.includes("usage: send-mouse <x> <y> [button] [clicks]"));
      assert.deepEqual(
        proxy.received.map((request) => request.url),
        ["/start", "/stop"],
      );
    } finally {
      await close(proxy.server);
    }
  });

  it("prints the proxy's error, headline first, and keeps the session", async () => {
    const proxy = await stubProxy();
    try {
      const result = await runSession(
        ["--server-url", proxy.url],
        ["start https://example.com/omarchy.iso", "intent start first", "intent start second", "status", "stop", "exit"],
      );
      assert.equal(result.code, 0);
      assert.ok(result.stdout.includes("Cannot start one intent when one's already running. Please end your previous intent."));
      assert.match(result.stdout, /Error: Cannot start one intent[^\n]*\n\s+at /);
      assert.ok(result.stdout.includes(`session ${SESSION_ID}`));
      assert.equal(proxy.received.filter((request) => request.url === "/intent/start").length, 2);
    } finally {
      await close(proxy.server);
    }
  });

  it("follow refuses a missing or extra id, and a terminal without the kitty graphics protocol, without calling the proxy", async () => {
    const proxy = await stubProxy();
    try {
      const result = await runSession(["--server-url", proxy.url], ["follow", `follow ${FOLLOWED_ID} extra`, `follow ${FOLLOWED_ID}`, "exit"]);
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.equal(result.stdout.match(/usage: follow <session-id>/g)?.length, 2);
      assert.ok(result.stdout.includes("follow needs the kitty graphics protocol (ghostty or kitty)"));
      assert.equal(result.stdout.includes(ALT_SCREEN_ON), false);
      assert.deepEqual(proxy.received, []);
    } finally {
      await close(proxy.server);
    }
  });

  it("follow says so when the proxy ends the stream before the session did, and restores the screen on a signal", async () => {
    const proxy = await stubProxy();
    try {
      const dropped = await runSession(["--server-url", proxy.url], [`follow ${DROPPED_ID}`, "status", "exit"], { TERM_PROGRAM: "ghostty" });
      assert.equal(dropped.stderr, "");
      assert.equal(dropped.code, 0);
      assert.ok(dropped.stdout.includes(ALT_SCREEN_OFF));
      assert.ok(dropped.stdout.includes(`dropped from ${DROPPED_ID}: this follower fell behind`));
      assert.ok(dropped.stdout.includes("session none"));

      const child = spawn(SESSION, ["--server-url", proxy.url], {
        env: {
          ...process.env,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim(),
          OLIGARCHY_TOKEN: "test-token",
          SERVER_URL: "",
          TERM: "dumb",
          TERM_PROGRAM: "ghostty",
        },
      });
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data: string) => {
        stdout += data;
        if (stdout.includes("still going") && !child.killed) {
          child.kill("SIGTERM");
        }
      });
      child.stdin.write(`follow ${ENDLESS_ID}\n`);
      const [code] = await once(child, "close");
      assert.equal(code, 0);
      assert.ok(stdout.includes(ALT_SCREEN_ON));
      assert.ok(stdout.includes("\x1b[?25h\x1b[?1049l"), "the cursor and main screen come back before the REPL exits");
      assert.ok(stdout.indexOf(ALT_SCREEN_ON) < stdout.indexOf(ALT_SCREEN_OFF));
    } finally {
      await close(proxy.server);
    }
  });

  it("follow prints the proxy's refusal for a finished session and keeps the REPL", async () => {
    const proxy = await stubProxy();
    try {
      const result = await runSession(["--server-url", proxy.url], [`follow ${ENDED_ID}`, "status", "exit"], { TERM_PROGRAM: "ghostty" });
      assert.equal(result.stderr, "");
      assert.equal(result.code, 0);
      assert.ok(result.stdout.includes(`session "${ENDED_ID}" has already completed (succeeded)`));
      assert.equal(result.stdout.includes(ALT_SCREEN_ON), false, "a refused follow never takes the screen");
      assert.ok(result.stdout.includes("session none"));
      assert.deepEqual(
        proxy.received.map((request) => request.url),
        [`/follow?id=${ENDED_ID}`],
      );
    } finally {
      await close(proxy.server);
    }
  });

  it("rejects a positional server url and an unknown flag", async () => {
    const positional = await runSession(["http://127.0.0.1:1"], []);
    assert.notEqual(positional.code, 0);
    assert.match(positional.stderr, /Unexpected positional argument: "http:\/\/127\.0\.0\.1:1"/);

    const underscore = await runSession(["--server_url", "http://127.0.0.1:1"], []);
    assert.notEqual(underscore.code, 0);
    assert.match(underscore.stderr, /Unrecognized flag: --server_url/);
  });

  it("rejects a missing OLIGARCHY_TOKEN before reading a command", async () => {
    const result = await runSession(["--server-url", "http://127.0.0.1:1"], ["status"], { OLIGARCHY_TOKEN: "" });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /OLIGARCHY_TOKEN is not set/);
    assert.equal(result.stdout.includes("agent"), false);
  });
});
