import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";
export type Files = {
  readFile: {
    (path: string): Promise<Uint8Array>;
    (path: string, encoding: "utf8"): Promise<string>;
  };
  writeFile: (path: string, data: string | Uint8Array) => Promise<unknown>;
  mkdir: (path: string, options?: { recursive?: boolean; mode?: number }) => Promise<unknown>;
  rename: (from: string, to: string) => Promise<unknown>;
  rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<unknown>;
  stat: (path: string) => Promise<{ isFile(): boolean; mtimeMs: number }>;
  access: (path: string, mode?: number) => Promise<unknown>;
  copyFile: (from: string, to: string) => Promise<unknown>;
  readdir: (path: string) => Promise<string[]>;
  open: (
    path: string,
    flags: string,
  ) => Promise<{
    writeFile(data: Uint8Array): Promise<unknown>;
    sync(): Promise<unknown>;
    close(): Promise<unknown>;
  }>;
};
export type Child = {
  stderr: {
    setEncoding(encoding: "utf8"): unknown;
    on(event: "data", callback: (text: string) => void): unknown;
  } | null;
  once: {
    (event: "spawn" | "close", callback: () => void): unknown;
    (event: "error", callback: (error: Error) => void): unknown;
    (event: "exit", callback: (code: number | null, signal: string | null) => void): unknown;
  };
  kill(signal: "SIGTERM" | "SIGKILL"): unknown;
};
export type Spawn = (
  command: string,
  args: string[],
  options: { stdio: ["ignore", "ignore", "pipe"]; env?: NodeJS.ProcessEnv },
) => Child;
export type Os = {
  fs: Files;
  spawn: Spawn;
  kill(pid: number, signal: 0 | "SIGTERM" | "SIGKILL"): unknown;
};
export const node: Os = { fs, spawn, kill: (pid, signal) => process.kill(pid, signal) };
