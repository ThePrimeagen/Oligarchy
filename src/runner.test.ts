import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  createRunner,
  executeRunnerLine,
  formatTerminalImage,
  completeRunnerLine,
  stopRunnerSession,
  type RunnerState,
} from "./runner.ts";

describe("runner state and command execution happy path", () => {
  it("initializes runner with serverUrl and unique agentId", () => {
    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok" });
    assert.equal(runner.serverUrl, "http://127.0.0.1:42069");
    assert.ok(runner.agentId.length > 0);
    assert.equal(runner.sessionId, undefined);
  });

  it("executes start command, updates sessionId and returns it", async () => {
    let capturedBody: unknown;
    const postStart = async (serverUrl: string, body: unknown) => {
      capturedBody = body;
      return JSON.stringify({ id: "session-test-uuid" });
    };

    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok", postStart });
    const output = await executeRunnerLine(runner, "start --iso test.iso");

    assert.equal(runner.sessionId, "session-test-uuid");
    assert.match(output, /session-test-uuid/);
    assert.deepEqual(capturedBody, {
      iso: resolve("test.iso"),
      agent: runner.agentId,
    });
  });

  it("rotates agentId after stop so a new session can start", async () => {
    const fetchFn: typeof fetch = async (input, init) => {
      return new Response(JSON.stringify({ ok: "true" }), { status: 200 });
    };

    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok", fetch: fetchFn });
    const originalAgentId = runner.agentId;
    runner.sessionId = "session-123";

    await stopRunnerSession(runner);
    assert.notEqual(runner.agentId, originalAgentId);
    assert.equal(runner.sessionId, undefined);
  });

  it("executes send-keys with rest of line passed as string", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    const fetchFn: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ok: "true" }), { status: 200 });
    };

    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok", fetch: fetchFn });
    runner.sessionId = "session-123";

    const output = await executeRunnerLine(runner, "send-keys hello world<ENTER>");
    assert.equal(capturedUrl, "http://127.0.0.1:42069/send-keys");
    assert.deepEqual(capturedBody, {
      id: "session-123",
      keys: "hello world<ENTER>",
      encoding: "oligarchy",
      agent: runner.agentId,
    });
    assert.match(output, /ok/);
  });

  it("executes send-mouse with tracked session", async () => {
    let capturedBody: unknown;
    const fetchFn: typeof fetch = async (input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ok: "true" }), { status: 200 });
    };

    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok", fetch: fetchFn });
    runner.sessionId = "session-123";

    await executeRunnerLine(runner, "send-mouse 0.5 0.5 left 2");
    assert.deepEqual(capturedBody, {
      id: "session-123",
      x: 0.5,
      y: 0.5,
      button: "left",
      clicks: 2,
      agent: runner.agentId,
    });
  });

  it("executes intent start and intent end tracking active intent", async () => {
    const bodies: unknown[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      bodies.push(JSON.parse(init?.body as string));
      return new Response(JSON.stringify({ ok: "true" }), { status: 200 });
    };

    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok", fetch: fetchFn });
    runner.sessionId = "session-123";

    await executeRunnerLine(runner, "intent start --message \"test intent message\" --test_result_id res-1");
    assert.equal(runner.activeIntent, "test intent message");

    await executeRunnerLine(runner, "intent end");
    assert.equal(runner.activeIntent, undefined);
    assert.equal(bodies.length, 2);

    await executeRunnerLine(runner, "intent \"shorthand intent\"");
    assert.equal(runner.activeIntent, "shorthand intent");
    await executeRunnerLine(runner, "intent end");
  });
});

describe("runner state and command execution unhappy path", () => {
  it("rejects commands requiring session when no session is active", async () => {
    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok" });
    await assert.rejects(
      () => executeRunnerLine(runner, "send-keys hello"),
      { message: "No active session. Run 'start' first." },
    );
    await assert.rejects(
      () => executeRunnerLine(runner, "get-image"),
      { message: "No active session. Run 'start' first." },
    );
    await assert.rejects(
      () => executeRunnerLine(runner, "send-mouse 0.5 0.5"),
      { message: "No active session. Run 'start' first." },
    );
  });

  it("rejects start when session is already running", async () => {
    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok" });
    runner.sessionId = "existing-session";
    await assert.rejects(
      () => executeRunnerLine(runner, "start"),
      { message: "A session is already running (existing-session). Stop it before starting a new one." },
    );
  });

  it("rejects start with invalid arguments", async () => {
    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok" });
    await assert.rejects(() => executeRunnerLine(runner, "start --iso"), {
      message: "Missing value for --iso",
    });
    await assert.rejects(() => executeRunnerLine(runner, "start --iso="), {
      message: "Missing value for --iso",
    });
    await assert.rejects(() => executeRunnerLine(runner, "start --disk"), {
      message: "Missing value for --disk",
    });
    await assert.rejects(() => executeRunnerLine(runner, "start --unknown"), {
      message: "Unknown option for start: --unknown",
    });
  });

  it("rejects when OLIGARCHY_TOKEN is missing", () => {
    const prev = process.env.OLIGARCHY_TOKEN;
    delete process.env.OLIGARCHY_TOKEN;
    try {
      assert.throws(() => createRunner({ token: "" }), {
        message: "OLIGARCHY_TOKEN is not set",
      });
    } finally {
      if (prev !== undefined) {
        process.env.OLIGARCHY_TOKEN = prev;
      }
    }
  });

  it("handles server error responses gracefully", async () => {
    const fetchFn = async () => {
      return new Response(JSON.stringify({ error: "Session crashed" }), { status: 500 });
    };

    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok", fetch: fetchFn });
    runner.sessionId = "session-123";

    await assert.rejects(
      () => executeRunnerLine(runner, "send-keys hello"),
      { message: "Session crashed" },
    );
  });

  it("rejects unknown commands", async () => {
    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok" });
    await assert.rejects(
      () => executeRunnerLine(runner, "unknown-command foo"),
      { message: "Unknown command: unknown-command" },
    );
  });
});

describe("tab completion happy path", () => {
  it("completes top-level actions when line is empty or prefix matches", () => {
    const runner = createRunner({ token: "tok" });
    const [completions, match] = completeRunnerLine(runner, "");
    assert.ok(completions.includes("start"));
    assert.ok(completions.includes("send-keys"));
    assert.ok(completions.includes("get-image"));
    assert.ok(completions.includes("send-mouse"));
    assert.ok(completions.includes("intent"));
    assert.ok(completions.includes("stop"));
    assert.equal(match, "");

    const [sCompletions, sMatch] = completeRunnerLine(runner, "se");
    assert.deepEqual(sCompletions, ["send-keys", "send-mouse"]);
    assert.equal(sMatch, "se");
  });

  it("completes intent subcommands", () => {
    const runner = createRunner({ token: "tok" });
    const [completions, match] = completeRunnerLine(runner, "intent ");
    assert.deepEqual(completions, ["start", "end"]);
    assert.equal(match, "");
  });
});

describe("tab completion unhappy path", () => {
  it("returns empty completions for non-matching input", () => {
    const runner = createRunner({ token: "tok" });
    const [completions, match] = completeRunnerLine(runner, "xyz");
    assert.deepEqual(completions, []);
    assert.equal(match, "xyz");
  });
});

describe("terminal image rendering happy path", () => {
  it("generates simple inline image escape sequence", () => {
    const png = Buffer.from("fake-png-bytes");
    const output = formatTerminalImage(png);
    assert.ok(output.startsWith("\x1b]1337;File="));
    assert.ok(output.includes(png.toString("base64")));
    assert.ok(output.endsWith("\x07\n"));
  });
});

describe("terminal image rendering unhappy path", () => {
  it("handles empty or invalid image buffer", () => {
    assert.throws(
      () => formatTerminalImage(Buffer.alloc(0)),
      { message: "Cannot display empty image" },
    );
  });
});

describe("cleanup on exit / kill happy path", () => {
  it("calls stop on proxy when session is active and clears session", async () => {
    let stoppedBody: unknown;
    const fetchFn: typeof fetch = async (input, init) => {
      stoppedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ok: "true" }), { status: 200 });
    };

    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok", fetch: fetchFn });
    const originalAgent = runner.agentId;
    runner.sessionId = "session-123";

    await stopRunnerSession(runner, "aborted", "runner exited");
    assert.deepEqual(stoppedBody, {
      id: "session-123",
      agent: originalAgent,
      status: "aborted",
      reason: "runner exited",
    });
    assert.equal(runner.sessionId, undefined);
  });
});

describe("cleanup on exit / kill unhappy path", () => {
  it("leaves sessionId set if stop fails during cleanup so it can be retried", async () => {
    const fetchFn: typeof fetch = async () => {
      throw new Error("Network offline");
    };

    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok", fetch: fetchFn });
    runner.sessionId = "session-123";

    await assert.rejects(() => stopRunnerSession(runner));
    assert.equal(runner.sessionId, "session-123");
  });

  it("does nothing if no active session", async () => {
    let called = false;
    const fetchFn: typeof fetch = async () => {
      called = true;
      return new Response("{}");
    };

    const runner = createRunner({ serverUrl: "http://127.0.0.1:42069", token: "tok", fetch: fetchFn });
    const output = await stopRunnerSession(runner);
    assert.equal(output, "No active session.");
    assert.equal(called, false);
  });
});
