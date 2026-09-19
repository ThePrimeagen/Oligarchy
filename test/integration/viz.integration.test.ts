import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stripAnsi } from "../support/fake-tty.ts";
import * as Postgres from "../support/postgres.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const VIZ = resolve(ROOT, "viz");
const ESC = String.fromCharCode(27);
const ALT_SCREEN_ON = `${ESC}[?1049h`;
const ALT_SCREEN_OFF = `${ESC}[?1049l`;
const TOO_SMALL = "viz needs a terminal of at least 135×37 (columns×rows); this one is 100×24";

// Never from the repository root: a `.env` there would fill the variables these tests unset.
const CWD = tmpdir();

// A url nothing listens on: every test here is refused before the first query, or reads the
// container database.
const UNREACHABLE = "postgres://oligarchy:secretpw@127.0.0.1:1/oligarchy";

const baseEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...process.env,
  DATABASE_URL: UNREACHABLE,
  TERM: "xterm-256color",
  ...env,
});

type Run = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

// stdout is a pipe here, as when the command is redirected: never a terminal.
const runViz = async (args: ReadonlyArray<string>, env: NodeJS.ProcessEnv = {}): Promise<Run> => {
  const child = spawn(VIZ, args, { cwd: CWD, env: baseEnv(env) });
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
  child.stdin.end();
  const [code] = await once(child, "close");
  return { code: typeof code === "number" ? code : null, stdout, stderr };
};

// A real terminal of the given size through `script`: stdout and stderr share the PTY, so
// `output` is both. `afterOutput` is typed once the output contains `waitFor`.
const runTtyViz = async (
  size: { readonly columns: number; readonly rows: number },
  env: NodeJS.ProcessEnv,
  waitFor: string,
  afterOutput: string,
): Promise<{ readonly code: number | null; readonly output: string }> => {
  const child = spawn(
    "script",
    [
      "-qfec",
      `stty cols ${String(size.columns)} rows ${String(size.rows)}; exec ${VIZ}`,
      "/dev/null",
    ],
    { cwd: CWD, env: baseEnv(env) },
  );
  let output = "";
  let sent = false;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (data: string) => {
    output += data;
    if (!sent && output.includes(waitFor)) {
      sent = true;
      child.stdin.write(afterOutput);
    }
  });
  const failSafe = setTimeout(() => {
    if (!sent) {
      sent = true;
      child.stdin.write(afterOutput);
    }
  }, 15_000);
  const [code] = await once(child, "close");
  clearTimeout(failSafe);
  return { code: typeof code === "number" ? code : null, output };
};

describe("./viz arguments", () => {
  it("--help exits 0 without a database and says what it shows", async () => {
    const result = await runViz(["--help"], { DATABASE_URL: "" });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("viz");
    expect(result.stdout).toContain("automation");
    expect(result.stdout.includes(ALT_SCREEN_ON)).toBe(false);
  });

  it("rejects a positional argument and an unknown flag, with the usage and no screen", async () => {
    const positional = await runViz(["servers"]);
    expect(positional.code).toBe(1);
    expect(positional.stderr).toMatch(/Unexpected positional argument: "servers"/);
    expect(positional.stdout.includes(ALT_SCREEN_ON)).toBe(false);
    const unknown = await runViz(["--refresh", "1"]);
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toMatch(/Unrecognized flag: --refresh/);
  });
});

describe("./viz unhappy path", () => {
  it("wants DATABASE_URL first, and prints nothing else", async () => {
    const result = await runViz([], { DATABASE_URL: "" });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.startsWith("DATABASE_URL is not set")).toBe(true);
  });

  it("refuses a stdout that is not a terminal, headline first, before any query", async () => {
    const result = await runViz([]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.split("\n")[0]).toBe("viz needs a terminal");
    expect(result.stderr).toMatch(/CommandError/);
    expect(result.stderr).not.toContain("secretpw");
  });

  it("refuses a 100×24 terminal naming the size it needs, without taking the screen", async () => {
    const result = await runTtyViz({ columns: 100, rows: 24 }, {}, TOO_SMALL, "");
    expect(result.code).toBe(1);
    expect(result.output).toContain(TOO_SMALL);
    expect(result.output.includes(ALT_SCREEN_ON)).toBe(false);
    expect(result.output).not.toContain("secretpw");
  });
});

Postgres.describeWithDatabase("./viz against the seeded database", () => {
  it("draws the page on a 135×37 terminal and gives the screen back on q, exit 0", async () => {
    const result = await runTtyViz(
      { columns: 135, rows: 37 },
      { DATABASE_URL: Postgres.getDbUrl() },
      "automation",
      "q",
    );
    expect(result.code).toBe(0);
    const on = result.output.indexOf(ALT_SCREEN_ON);
    const off = result.output.lastIndexOf(ALT_SCREEN_OFF);
    expect(on !== -1 && off !== -1 && on < off, "takes the screen and gives it back").toBe(true);
    const drawn = stripAnsi(result.output.slice(on, off));
    expect(drawn).toMatch(/─ read \d+ s ago ─╮/);
    expect(drawn).toMatch(/│ servers \d+\/\d+ │ driving \d+\/\d+ diagnosing \d+\/\d+ /);
    expect(drawn).toContain("▸ s  automation");
    expect(drawn).toContain("qemu servers");
    expect(drawn).toContain("t  tickets");
    expect(drawn).toContain(
      "j/k select   s automation   h/l tabs   t tickets   d definition   enter info   L linear   a abort   F follow   q quit",
    );
    expect(drawn).not.toContain("error:");
    expect(drawn).not.toContain("viz needs");
  });
});
