import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const CLIENT = fileURLToPath(new URL("../client/index.ts", import.meta.url));
const CTRL = fileURLToPath(new URL("../ctrl/index.ts", import.meta.url));

export type ClientChild = ChildProcessByStdio<null, Readable, Readable>;

export type ClientResult = {
  code: number;
  stdout: Buffer;
  stderr: string;
};

export type Session = {
  serverUrl: string;
  agentId: string;
  sessionId: string | undefined;
  intentOpen: boolean;
  startInFlight: Promise<ClientResult> | undefined;
  following: ClientChild | undefined;
};

export function createSession(serverUrl: string): Session {
  return { serverUrl, agentId: freshAgentId(), sessionId: undefined, intentOpen: false, startInFlight: undefined, following: undefined };
}

// The proxy keys one session per agent id (agent_runs primary key), so every start
// mints a fresh id; later commands and the stop must use the id that booted the session.
export function freshAgentId(): string {
  return `session-${randomUUID()}`;
}

// Own process group: a terminal hangup or Ctrl-C reaches the whole foreground group,
// and a start killed mid-boot still boots on the proxy. Detached, the child survives to
// hand back its session id so shutdown can stop it instead of orphaning the QEMU.
export function spawnClient(session: Session, args: string[]): ClientChild {
  return spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      CLIENT,
      ...args,
      "--agent-id",
      session.agentId,
      "--server-url",
      session.serverUrl,
    ],
    { stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
}

export function runClient(session: Session, args: string[]): Promise<ClientResult> {
  return new Promise((resolve, reject) => {
    const child = spawnClient(session, args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8").trim() });
    });
  });
}

export function runCtrl(session: Session, args: string[], signal: AbortSignal): Promise<ClientResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", CTRL, ...args, "--server-url", session.serverUrl],
      { stdio: ["ignore", "pipe", "pipe"], signal },
    );
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8").trim() });
    });
  });
}

export function requireSession(session: Session): string | undefined {
  if (session.sessionId === undefined) {
    console.log("no session. run start first.");
  }
  return session.sessionId;
}
