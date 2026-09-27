import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type * as App from "../src/main.ts";

const fixture = join(import.meta.dirname, "fixtures/waits.ts");

// A child a failed test left running would keep ticking; each test's children end with it.
const children = new Set<ChildProcess>();
afterEach(() => {
  for (const child of children) {
    child.kill("SIGKILL");
  }
  children.clear();
});

// Runs the fixture as its own process. `waitFor` settles once stdout has shown the line, and fails
// if the process ends first; `closed` is the exit code once stdout and stderr have been read to
// the end; `lines` is everything it printed and `errors` everything on stderr.
const start = (args: ReadonlyArray<string> = []) => {
  const child = spawn(process.execPath, [fixture, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let out = "";
  let err = "";
  let ended = false;
  const waiting: Array<{ readonly line: string; readonly done: (seen: boolean) => void }> = [];
  const shown = (line: string) => out.split("\n").includes(line);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    err += chunk;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    out += chunk;
    for (const each of waiting) {
      if (shown(each.line)) {
        each.done(true);
      }
    }
  });
  const closed = new Promise<number | null>((resolve) => {
    child.on("close", (code) => {
      ended = true;
      for (const each of waiting) {
        each.done(shown(each.line));
      }
      resolve(code);
    });
  });
  const waitFor = (line: string) =>
    new Promise<void>((resolve, reject) => {
      const done = (seen: boolean) =>
        seen ? resolve() : reject(new Error(`ended without printing ${line}`));
      if (shown(line) || ended) {
        done(shown(line));
        return;
      }
      waiting.push({ line, done });
    });
  const send = (signal: App.Signal) => {
    child.kill(signal);
  };
  return { waitFor, closed, send, lines: () => out.trim().split("\n"), errors: () => err };
};

describe("App on the real process", () => {
  it.each([
    ["SIGINT", "press again to kill the application right away\n"],
    ["SIGTERM", ""],
    ["SIGHUP", ""],
  ] as const)(
    "ends on %s: main returns, the handler runs, and it exits 0 (happy)",
    async (signal, stderr) => {
      const program = start();
      await program.waitFor("ready");
      program.send(signal);
      expect(await program.closed).toBe(0);
      expect(program.lines()).toEqual(["ready", `handler ${signal}`]);
      expect(program.errors()).toBe(stderr);
    },
  );

  it("exits 1 on a second SIGHUP while a handler still runs (unhappy)", async () => {
    const program = start(["--hang"]);
    await program.waitFor("ready");
    program.send("SIGHUP");
    await program.waitFor("handler SIGHUP");
    program.send("SIGHUP");
    expect(await program.closed).toBe(1);
  });
});
