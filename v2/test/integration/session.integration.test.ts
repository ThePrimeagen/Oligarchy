import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as StubProxy from "../support/stub-proxy.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const SESSION = resolve(ROOT, "session");
const CLIENT_MAIN = resolve(ROOT, "v2/src/client/main.ts");
const CTRL_MAIN = resolve(ROOT, "v2/src/ctrl/main.ts");
const { SESSION_ID, FOLLOWED_ID, ENDED_ID, DROPPED_ID, ENDLESS_ID } = StubProxy;
const ESC = String.fromCharCode(27);
const ALT_SCREEN_ON = `${ESC}[?1049h`;
const ALT_SCREEN_OFF = `${ESC}[?1049l`;
const RESTORE = `${ESC}[?25h${ESC}[?1049l`;
const KITTY_PLACE = new RegExp(
  `${ESC}_Ga=T,f=100,i=1,q=2,C=1,c=\\d+,r=\\d+,m=0;([A-Za-z0-9+/=]+)${ESC}\\\\`,
);
const SPINNER = "[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]";
const view = (source: string): RegExp => new RegExp(source.replaceAll("ESC", ESC));

// Never from the repository root: a `.env` there would fill the variables these tests unset.
const CWD = tmpdir();

const baseEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim(),
  OLIGARCHY_TOKEN: "test-token",
  SERVER_URL: "",
  TERM: "dumb",
  TERM_PROGRAM: "",
  ...env,
});

type Run = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

const runSession = async (
  args: ReadonlyArray<string>,
  lines: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = {},
): Promise<Run> => {
  const child = spawn(SESSION, args, { cwd: CWD, env: baseEnv(env) });
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
  return { code: typeof code === "number" ? code : null, stdout, stderr };
};

// A real terminal through `script`: readline runs in terminal mode, so Tab reaches the completer.
const runTtySession = async (
  input: string,
  afterInput: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ readonly code: number | null; readonly output: string }> => {
  const child = spawn(
    "script",
    ["-qfec", `${SESSION} --server-url http://127.0.0.1:1`, "/dev/null"],
    { cwd: CWD, env: baseEnv({ DATABASE_URL: "", TERM: "xterm-256color", ...env }) },
  );
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
      }, 5_000);
    }
    if (inputSent && !afterInputSent && output.includes("DATABASE_URL is not set")) {
      afterInputSent = true;
      clearTimeout(failSafe);
      setImmediate(() => child.stdin.end(afterInput));
    }
  });
  const [code] = await once(child, "close");
  clearTimeout(failSafe);
  return { code: typeof code === "number" ? code : null, output };
};

// The stub's default answers, plus the refusal of a second intent the REPL test needs.
const script: StubProxy.Script = (received) =>
  received.url === "/intent/start" && JSON.stringify(received.body).includes("second")
    ? StubProxy.refusal(
        400,
        "Cannot start one intent when one's already running. Please end your previous intent.",
      )
    : StubProxy.defaultScript(received);

const withProxy = async (body: (proxy: StubProxy.StubProxy) => Promise<void>): Promise<void> => {
  const proxy = await StubProxy.startStubProxy(script);
  try {
    await body(proxy);
  } finally {
    await proxy.close();
  }
};

const agentOf = (requests: ReadonlyArray<StubProxy.Received>): string => {
  const body = requests[0]?.body;
  if (
    typeof body === "object" &&
    body !== null &&
    "agent" in body &&
    typeof body.agent === "string"
  ) {
    return body.agent;
  }
  throw new Error("the first request carried no agent");
};

const tinyPngBase64 = Buffer.from(StubProxy.tinyPng()).toString("base64");

// The REPL spawns WP-5's client and WP-6's ctrl; until they exist there is nothing to drive.
const ready = existsSync(CLIENT_MAIN) && existsSync(CTRL_MAIN);

describe.skipIf(!ready)("./session happy path", () => {
  it("drives one session through every command with the client's flags and one agent id", () =>
    withProxy(async (proxy) => {
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
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);

      const agent = agentOf(proxy.requests);
      expect(agent).toMatch(/^session-[0-9a-f-]{36}$/);
      for (const request of proxy.requests) {
        expect(request.authorization).toBe("Bearer test-token");
      }
      expect(proxy.requests.map((request) => [request.method, request.url, request.body])).toEqual([
        ["POST", "/start", { iso: "https://example.com/omarchy.iso", agent }],
        [
          "POST",
          "/intent/start",
          { id: SESSION_ID, agent, test_result_id: "manual", message: "wait for the boot menu" },
        ],
        [
          "POST",
          "/send-keys",
          { id: SESSION_ID, keys: "hello world<ENTER>", encoding: "oligarchy", agent },
        ],
        [
          "POST",
          "/send-mouse",
          { id: SESSION_ID, x: 0.5, y: 0.25, agent, button: "left", clicks: 2 },
        ],
        ["POST", "/send-mouse", { id: SESSION_ID, x: 0, y: 1, agent }],
        ["GET", `/image?id=${SESSION_ID}&agent=${agent}`, undefined],
        ["GET", `/serial?id=${SESSION_ID}&agent=${agent}`, undefined],
        ["POST", "/intent/end", { id: SESSION_ID, agent }],
        ["POST", "/stop", { id: SESSION_ID, agent, status: "succeeded", reason: "all good" }],
      ]);

      expect(result.stdout).toContain(`agent   ${agent}`);
      expect(result.stdout).toContain(`session ${SESSION_ID}`);
      expect(result.stdout).toContain("intent  open");
      expect(result.stdout).toContain("▀");
      expect(result.stdout).toContain("boot log");
      expect(result.stdout).toContain(`stopped ${SESSION_ID}`);
      expect(result.stdout.includes("stopping session")).toBe(false);
    }));

  it("stops a running session when stdin closes", () =>
    withProxy(async (proxy) => {
      const result = await runSession(
        ["--server-url", proxy.url],
        ["start https://example.com/omarchy.iso"],
      );
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`stopping session ${SESSION_ID}`);
      const agent = agentOf(proxy.requests);
      expect(proxy.requests[1]).toEqual({
        method: "POST",
        url: "/stop",
        authorization: "Bearer test-token",
        body: { id: SESSION_ID, agent },
      });
    }));

  it("follow draws intents and actions down the left, places each image on the right, and hands the REPL back when the session ends", () =>
    withProxy(async (proxy) => {
      const result = await runSession(
        ["--server-url", proxy.url],
        [`follow ${FOLLOWED_ID}`, "status", "exit"],
        { TERM_PROGRAM: "ghostty" },
      );
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(
        proxy.requests.map((request) => [request.method, request.url, request.authorization]),
      ).toEqual([["GET", `/follow?id=${FOLLOWED_ID}`, "Bearer test-token"]]);

      const out = result.stdout;
      const on = out.indexOf(ALT_SCREEN_ON);
      const off = out.indexOf(ALT_SCREEN_OFF);
      expect(
        on !== -1 && off !== -1 && on < off,
        "follow takes the alternate screen and gives it back",
      ).toBe(true);
      const drawn = out.slice(on, off);

      expect(drawn).toContain("following 7a2d0000");
      expect(drawn, "a running intent is gray with a spinner").toMatch(
        view(`ESC\\[90m${SPINNER} wait for the boot menu`),
      );
      expect(drawn, "a completed intent turns green").toContain(
        `${ESC}[32m✓ wait for the boot menu`,
      );
      expect(drawn, "a running action is gray with a spinner").toMatch(
        view(`ESC\\[90m${SPINNER} send-keys`),
      );
      expect(drawn, "a completed action turns green").toContain(`${ESC}[32m✓ send-keys`);
      expect(drawn).toContain(`${ESC}[32m✓ get-image`);
      expect(drawn, "a failed action turns red").toContain(`${ESC}[31m✗ send-mouse`);
      expect(drawn.indexOf("wait for the boot menu")).toBeLessThan(drawn.indexOf("send-keys"));
      expect(drawn, "intents start at the margin").toMatch(
        view("ESC\\[\\d+;2HESC\\[32m✓ wait for the boot menu"),
      );
      expect(drawn, "actions are indented under the intent").toMatch(
        view("ESC\\[\\d+;2H  ESC\\[32m✓ send-keys"),
      );
      expect(drawn, "an action outside any intent sits at the margin").toMatch(
        view("ESC\\[\\d+;2HESC\\[32m✓ get-serial"),
      );

      const placed = KITTY_PLACE.exec(drawn);
      expect(placed, "the image is placed with the kitty graphics protocol").not.toBeNull();
      expect(placed?.[1]).toBe(tinyPngBase64);
      expect(drawn, "the image sits to the right of the action column").toContain(
        `${ESC}[2;42H${ESC}_Ga=T`,
      );
      expect(drawn, "the previous image is deleted first").toContain(
        `${ESC}_Ga=d,d=I,i=1,q=2${ESC}\\`,
      );
      expect(out.slice(off - 40, off), "images are cleared on leave").toContain(
        `${ESC}_Ga=d,d=A,q=2${ESC}\\`,
      );
      expect(drawn, "the view never scrolls the screen").not.toContain("\n");

      const after = out.slice(off);
      expect(after).toContain(`session ${FOLLOWED_ID} succeeded`);
      expect(after, "the REPL is back and has no session of its own").toContain("session none");
    }));

  it("takes the server from SERVER_URL when --server-url is omitted", () =>
    withProxy(async (proxy) => {
      const result = await runSession(
        [],
        ["start https://example.com/omarchy.iso", "stop", "exit"],
        { SERVER_URL: proxy.url },
      );
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(proxy.requests).toHaveLength(2);
      expect(result.stdout).toContain(`server ${proxy.url}`);
    }));
});

describe.skipIf(!ready)("./session unhappy path", () => {
  it("enters follow completion when Tab and Enter arrive in one PTY write", async () => {
    const result = await runTtySession("follow \t\r", "\x15exit\r");
    expect(result.code).toBe(0);
    expect(result.output).toContain("DATABASE_URL is not set");
    expect(result.output).not.toContain("usage: follow <session-id>");
  });

  it("reports a failed ctrl session list and keeps the prompt usable", async () => {
    const result = await runTtySession("follow \t", "\x15exit\r");
    expect(result.code).toBe(0);
    expect(result.output).toContain("DATABASE_URL is not set");
    expect((result.output.match(/session> /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("refuses commands before start, unknown commands, and a malformed send-mouse without calling the proxy", () =>
    withProxy(async (proxy) => {
      const result = await runSession(
        ["--server-url", proxy.url],
        [
          "send-keys hello",
          "reboot",
          "start https://example.com/omarchy.iso",
          "send-mouse 0.5",
          "stop",
          "exit",
        ],
      );
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("no session. run start first.");
      expect(result.stdout).toContain("unknown command: reboot");
      expect(result.stdout).toContain("usage: send-mouse <x> <y> [button] [clicks]");
      expect(proxy.requests.map((request) => request.url)).toEqual(["/start", "/stop"]);
    }));

  it("prints the proxy's error, headline first, and keeps the session", () =>
    withProxy(async (proxy) => {
      const result = await runSession(
        ["--server-url", proxy.url],
        [
          "start https://example.com/omarchy.iso",
          "intent start first",
          "intent start second",
          "status",
          "stop",
          "exit",
        ],
      );
      expect(result.code).toBe(0);
      const headline =
        "Cannot start one intent when one's already running. Please end your previous intent.";
      expect(result.stdout).toContain(headline);
      // The client renders the headline, then the pretty cause; the session survives it.
      expect(result.stdout.indexOf(headline)).toBeLessThan(
        result.stdout.lastIndexOf(`session ${SESSION_ID}`),
      );
      expect(proxy.requests.filter((request) => request.url === "/intent/start")).toHaveLength(2);
    }));

  it("follow refuses a missing or extra id, and a terminal without the kitty graphics protocol, without calling the proxy", () =>
    withProxy(async (proxy) => {
      const result = await runSession(
        ["--server-url", proxy.url],
        ["follow", `follow ${FOLLOWED_ID} extra`, `follow ${FOLLOWED_ID}`, "exit"],
      );
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout.match(/usage: follow <session-id>/g)).toHaveLength(2);
      expect(result.stdout).toContain(
        "follow needs the kitty graphics protocol (ghostty or kitty)",
      );
      expect(result.stdout.includes(ALT_SCREEN_ON)).toBe(false);
      expect(proxy.requests).toEqual([]);
    }));

  it("follow says so when the proxy ends the stream before the session did, and restores the screen on a signal", () =>
    withProxy(async (proxy) => {
      const dropped = await runSession(
        ["--server-url", proxy.url],
        [`follow ${DROPPED_ID}`, "status", "exit"],
        { TERM_PROGRAM: "ghostty" },
      );
      expect(dropped.stderr).toBe("");
      expect(dropped.code).toBe(0);
      expect(dropped.stdout).toContain(ALT_SCREEN_OFF);
      expect(dropped.stdout).toContain(`dropped from ${DROPPED_ID}: this follower fell behind`);
      expect(dropped.stdout).toContain("session none");

      const child = spawn(SESSION, ["--server-url", proxy.url], {
        cwd: CWD,
        env: baseEnv({ TERM_PROGRAM: "ghostty" }),
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
      expect(code).toBe(0);
      expect(stdout).toContain(ALT_SCREEN_ON);
      expect(stdout, "the cursor and main screen come back before the REPL exits").toContain(
        RESTORE,
      );
      expect(stdout.indexOf(ALT_SCREEN_ON)).toBeLessThan(stdout.indexOf(ALT_SCREEN_OFF));
    }));

  it("follow prints the proxy's refusal for a finished session and keeps the REPL", () =>
    withProxy(async (proxy) => {
      const result = await runSession(
        ["--server-url", proxy.url],
        [`follow ${ENDED_ID}`, "status", "exit"],
        { TERM_PROGRAM: "ghostty" },
      );
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`session "${ENDED_ID}" has already completed (succeeded)`);
      expect(result.stdout.includes(ALT_SCREEN_ON), "a refused follow never takes the screen").toBe(
        false,
      );
      expect(result.stdout).toContain("session none");
      expect(proxy.requests.map((request) => request.url)).toEqual([`/follow?id=${ENDED_ID}`]);
    }));
});

// The parser and the token check run before any child is needed.
describe("./session arguments", () => {
  it("rejects a positional server url and an unknown flag", async () => {
    const positional = await runSession(["http://127.0.0.1:1"], []);
    expect(positional.code).not.toBe(0);
    expect(positional.stderr).toMatch(/Unexpected positional argument: "http:\/\/127\.0\.0\.1:1"/);

    const underscore = await runSession(["--server_url", "http://127.0.0.1:1"], []);
    expect(underscore.code).not.toBe(0);
    expect(underscore.stderr).toMatch(/Unrecognized flag: --server_url/);
  });

  it("rejects a missing OLIGARCHY_TOKEN before reading a command", async () => {
    const result = await runSession(["--server-url", "http://127.0.0.1:1"], ["status"], {
      OLIGARCHY_TOKEN: "",
    });
    expect(result.code).toBe(1);
    expect(result.stderr.startsWith("OLIGARCHY_TOKEN is not set")).toBe(true);
    expect(result.stdout.includes("agent")).toBe(false);
  });

  it("--help exits 0 without prompting", async () => {
    const result = await runSession(["--help"], ["status"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--server-url");
    expect(result.stdout.includes("session> ")).toBe(false);
  });
});
