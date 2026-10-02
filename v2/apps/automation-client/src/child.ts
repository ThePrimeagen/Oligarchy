import * as jarl from "jarl";

// A child could not be started; the message is the platform's reason.
export const SpawnFailed = jarl.error.define("SpawnFailed");
export type SpawnFailed = InstanceType<typeof SpawnFailed>;

// The end of stderr says why a child failed. It lands in a job's reason and a logs row, and
// Postgres text refuses NUL, so a binary blob a tool dumped there must not cost the run its verdict.
const STDERR_TAIL = 4_096;
const KILL_GRACE_MS = 5_000;
// stderr is a pipe the child shares with everything it started (a tool the agent ran, an MCP
// server), and it closes only once the last of them has; the exit is the end of the run. After it
// the pipe gets this long to deliver what the child itself wrote, so a straggler cannot hold the
// run to its ceiling.
const STDERR_GRACE_MS = 2_000;

export type Spawn = (
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly stdio: ["ignore", "inherit", "pipe"];
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly cwd?: string;
  },
) => {
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  readonly kill: (signal: "SIGTERM" | "SIGKILL") => void;
  readonly on: {
    (event: "error", handler: (error: Error) => void): void;
    (event: "exit" | "close", handler: () => void): void;
  };
  readonly stderr: {
    readonly setEncoding: (encoding: "utf8") => void;
    readonly on: (event: "data", handler: (chunk: string) => void) => void;
  };
};

// How a child ended: its exit code, or the signal that ended it, and its stderr's tail, trimmed.
export type Exit = {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stderr: string;
};

export type Child = {
  // Settles once the child has exited and its stderr is drained, or it could not be started.
  readonly ended: Promise<jarl.Result<Exit, SpawnFailed>>;
  // SIGTERM, and SIGKILL after the grace if it has not exited. Whether the kill reached a child
  // still running; one that already exited is sent nothing.
  readonly kill: () => boolean;
};

// stdout is the child's own story and passes through to whoever watches this process.
export const start = (
  spawn: Spawn,
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly cwd?: string;
  },
): Child => {
  let child: ReturnType<Spawn>;
  // An argument node will not pass, a NUL in a prompt among them, throws here rather than erroring.
  try {
    child = spawn(command, args, { stdio: ["ignore", "inherit", "pipe"], ...options });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ended: Promise.resolve(jarl.err(new SpawnFailed(message))), kill: () => false };
  }
  let stderr = "";
  let exited = false;
  let killing = false;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  let drained: ReturnType<typeof setTimeout> | undefined;

  const ended = new Promise<jarl.Result<Exit, SpawnFailed>>((resolve) => {
    let settled = false;
    const settle = (result: jarl.Result<Exit, SpawnFailed>) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(forceKill);
      clearTimeout(drained);
      resolve(result);
    };
    const exit = () =>
      settle(jarl.ok({ code: child.exitCode, signal: child.signalCode, stderr: stderr.trim() }));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.replaceAll("\u0000", "")}`.slice(-STDERR_TAIL);
    });
    // One that started and then errors is a kill that failed: its exit still comes.
    child.on("error", (error) => {
      if (!exited && child.pid === undefined) {
        exited = true;
        settle(jarl.err(new SpawnFailed(error.message)));
      }
    });
    child.on("exit", () => {
      exited = true;
      clearTimeout(forceKill);
      drained = setTimeout(exit, STDERR_GRACE_MS);
    });
    child.on("close", () => {
      if (exited) {
        exit();
      }
    });
  });

  return {
    ended,
    kill: () => {
      if (exited) {
        return false;
      }
      if (!killing) {
        killing = true;
        child.kill("SIGTERM");
        forceKill = setTimeout(() => {
          child.kill("SIGKILL");
        }, KILL_GRACE_MS);
      }
      return true;
    },
  };
};
