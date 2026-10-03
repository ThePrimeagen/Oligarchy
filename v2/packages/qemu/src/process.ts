import * as jarl from "jarl";
import type { Os } from "./io.ts";
import { type Answer, failed, QemuFailed } from "./errors.ts";
export type Exit = {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stderr: string;
};
export type Options = {
  readonly killGrace: number;
  readonly stderrGrace: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly stderrLimit: number;
};
export type Handle = {
  readonly exited: Promise<Exit>;
  readonly stop: () => Promise<Exit>;
  readonly stderr: () => string;
};
export const start = (os: Os, command: string, args: string[], options: Options): Answer<Handle> =>
  jarl.exec(async () => {
    const child = os.spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    let tail = "";
    let code: number | null = null;
    let signal: string | null = null;
    let done = false;
    let stopping = false;
    let force: ReturnType<typeof setTimeout> | undefined;
    let drain: ReturnType<typeof setTimeout> | undefined;
    let finish!: () => void;
    const exited = new Promise<Exit>((resolve) => {
      finish = () => {
        done = true;
        clearTimeout(force);
        clearTimeout(drain);
        resolve({ code, signal, stderr: tail });
      };
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (text: string) => {
      tail = (tail + text.replaceAll("\0", "")).slice(-options.stderrLimit);
    });
    child.once("exit", (value, killed) => {
      code = value;
      signal = killed;
      done = true;
      clearTimeout(force);
      drain = setTimeout(finish, options.stderrGrace);
    });
    child.once("close", finish);
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", (error) => {
        finish();
        reject(error);
      });
    });
    return {
      exited,
      stderr: () => tail,
      stop: () => {
        if (!done && !stopping) {
          stopping = true;
          force = setTimeout(() => {
            if (!done) child.kill("SIGKILL");
          }, options.killGrace);
          force.unref();
          child.kill("SIGTERM");
        }
        return exited;
      },
    };
  }, failed);
export const run = (
  os: Os,
  command: string,
  args: string[],
  signal: AbortSignal,
  options: Options,
): Answer<void> =>
  jarl.exec(async () => {
    if (signal.aborted) throw signal.reason;
    const process = jarl.unwrap(await start(os, command, args, options));
    const abort = () => {
      void process.stop();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    try {
      const exit = await process.exited;
      if (signal.aborted) throw signal.reason;
      if (exit.code !== 0)
        throw new QemuFailed(
          `${command} exited ${String(exit.code ?? exit.signal)}: ${exit.stderr}`,
        );
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }, failed);
