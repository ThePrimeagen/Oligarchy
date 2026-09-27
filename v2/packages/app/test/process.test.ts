import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type * as App from "../src/main.ts";

const fixture = join(import.meta.dirname, "fixtures/waits.ts");

// Runs the fixture as its own process: `waitFor` settles once stdout has shown the line, `exited`
// with the exit code, and `lines` is everything it printed.
const start = (args: ReadonlyArray<string> = []) => {
  const child = spawn(process.execPath, [fixture, ...args], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  let out = "";
  const waiting: Array<{ readonly line: string; readonly resolve: () => void }> = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    out += chunk;
    for (const each of waiting) {
      if (out.split("\n").includes(each.line)) {
        each.resolve();
      }
    }
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
  });
  const waitFor = (line: string) =>
    new Promise<void>((resolve) => {
      waiting.push({ line, resolve });
      if (out.split("\n").includes(line)) {
        resolve();
      }
    });
  const send = (signal: App.Signal) => {
    child.kill(signal);
  };
  return { waitFor, exited, send, lines: () => out.trim().split("\n") };
};

describe("App on the real process", () => {
  it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
    "ends on %s: main returns, the handler runs, and it exits 0 (happy)",
    async (signal) => {
      const program = start();
      await program.waitFor("ready");
      program.send(signal);
      expect(await program.exited).toBe(0);
      expect(program.lines()).toEqual(["ready", `handler ${signal}`]);
    },
  );

  it("exits 1 on a second SIGHUP while a handler still runs (unhappy)", async () => {
    const program = start(["--hang"]);
    await program.waitFor("ready");
    program.send("SIGHUP");
    await program.waitFor("handler SIGHUP");
    program.send("SIGHUP");
    expect(await program.exited).toBe(1);
  });
});
