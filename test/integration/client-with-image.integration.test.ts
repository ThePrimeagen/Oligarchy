import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as StubProxy from "../support/stub-proxy.ts";

const WRAPPER = join(import.meta.dirname, "../../client-with-image");
const EXIT_WITHIN_MS = 30_000;
const SESSION = "session-1";
const AGENT = "agent-1";
const TOKEN = "test-token";

type Run = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

const runWrapper = (
  args: ReadonlyArray<string>,
  env: Record<string, string> = {},
  cwd: string = process.cwd(),
): Promise<Run> =>
  new Promise((resolve, reject) => {
    const child = spawn(WRAPPER, args, {
      cwd,
      env: {
        ...process.env,
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim(),
        OLIGARCHY_TOKEN: TOKEN,
        SERVER_URL: "",
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

describe("./client-with-image happy path", () => {
  it("forwards send-keys then writes the PNG to CLIENT_IMAGE", async () => {
    const stub = await proxy();
    const dir = await mkdtemp(join(tmpdir(), "oligarchy-client-with-image-"));
    const output = join(dir, "guest screen.png");
    try {
      const result = await runWrapper(
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
        { CLIENT_IMAGE: output },
      );
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("");
      expect([...(await readFile(output))]).toEqual([...StubProxy.tinyPng()]);
      expect(stub.requests).toEqual([
        {
          method: "POST",
          url: "/send-keys",
          authorization: `Bearer ${TOKEN}`,
          body: { id: SESSION, keys: "hello", encoding: "oligarchy", agent: AGENT },
        },
        {
          method: "GET",
          url: `/image?id=${SESSION}&agent=${AGENT}`,
          authorization: `Bearer ${TOKEN}`,
          body: undefined,
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("start prints the session id and get-image uses it", async () => {
    const stub = await proxy();
    const dir = await mkdtemp(join(tmpdir(), "oligarchy-client-with-image-"));
    const output = join(dir, "screen.png");
    try {
      const result = await runWrapper(
        [
          "start",
          "--agent-id",
          AGENT,
          "--server-url",
          stub.url,
          "--iso",
          "https://example.com/omarchy.iso",
        ],
        { CLIENT_IMAGE: output },
      );
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toBe(`${StubProxy.SESSION_ID}\n`);
      expect([...(await readFile(output))]).toEqual([...StubProxy.tinyPng()]);
      expect(stub.requests).toEqual([
        {
          method: "POST",
          url: "/start",
          authorization: `Bearer ${TOKEN}`,
          body: { iso: "https://example.com/omarchy.iso", agent: AGENT },
        },
        {
          method: "GET",
          url: `/image?id=${StubProxy.SESSION_ID}&agent=${AGENT}`,
          authorization: `Bearer ${TOKEN}`,
          body: undefined,
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts --flag=value for the forwarded action and the screenshot", async () => {
    const stub = await proxy();
    const dir = await mkdtemp(join(tmpdir(), "oligarchy-client-with-image-"));
    const output = join(dir, "screen.png");
    try {
      const result = await runWrapper(
        [
          "send-keys",
          `--agent-id=${AGENT}`,
          `--server-url=${stub.url}`,
          `--session-id=${SESSION}`,
          "--keys=hello",
        ],
        { CLIENT_IMAGE: output },
      );
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(stub.requests).toEqual([
        {
          method: "POST",
          url: "/send-keys",
          authorization: `Bearer ${TOKEN}`,
          body: { id: SESSION, keys: "hello", encoding: "oligarchy", agent: AGENT },
        },
        {
          method: "GET",
          url: `/image?id=${SESSION}&agent=${AGENT}`,
          authorization: `Bearer ${TOKEN}`,
          body: undefined,
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("takes the server from SERVER_URL when --server-url is omitted", async () => {
    const stub = await proxy();
    const dir = await mkdtemp(join(tmpdir(), "oligarchy-client-with-image-"));
    const output = join(dir, "screen.png");
    try {
      const result = await runWrapper(
        ["send-keys", "--agent-id", AGENT, "--session-id", SESSION, "--keys", "hello"],
        { SERVER_URL: stub.url, CLIENT_IMAGE: output },
      );
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(stub.requests).toHaveLength(2);
      expect(stub.requests[0]?.url).toBe("/send-keys");
      expect(stub.requests[1]?.url).toBe(`/image?id=${SESSION}&agent=${AGENT}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("./client-with-image unhappy path", () => {
  it("rejects a missing CLIENT_IMAGE before calling the client", async () => {
    const stub = await proxy();
    const result = await runWrapper(
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
      { CLIENT_IMAGE: "" },
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(firstLine(result.stderr)).toBe("CLIENT_IMAGE is not set");
    expect(stub.requests).toEqual([]);
  });

  it("does not screenshot when the forwarded action fails", async () => {
    const stub = await proxy(() => StubProxy.refusal(404, "nope"));
    const dir = await mkdtemp(join(tmpdir(), "oligarchy-client-with-image-"));
    const output = join(dir, "screen.png");
    try {
      const result = await runWrapper(
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
        { CLIENT_IMAGE: output },
      );
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(firstLine(result.stderr)).toBe("nope");
      expect(stub.requests).toEqual([
        {
          method: "POST",
          url: "/send-keys",
          authorization: `Bearer ${TOKEN}`,
          body: { id: SESSION, keys: "hello", encoding: "oligarchy", agent: AGENT },
        },
      ]);
      await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 when get-image fails after a successful action", async () => {
    const stub = await proxy((received) =>
      received.url.startsWith("/image") ? StubProxy.refusal(404, "no image") : StubProxy.OK,
    );
    const dir = await mkdtemp(join(tmpdir(), "oligarchy-client-with-image-"));
    const output = join(dir, "screen.png");
    try {
      const result = await runWrapper(
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
        { CLIENT_IMAGE: output },
      );
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(firstLine(result.stderr)).toBe("no image");
      expect(stub.requests).toHaveLength(2);
      expect(stub.requests[0]?.url).toBe("/send-keys");
      expect(stub.requests[1]?.url).toBe(`/image?id=${SESSION}&agent=${AGENT}`);
      await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
