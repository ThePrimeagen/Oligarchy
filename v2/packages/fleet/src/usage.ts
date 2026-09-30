import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import * as App from "@oligarchy/app";
import * as jarl from "jarl";

// /proc could not be read as this process, or ps could not be run, did not answer, or did not
// list this process.
export const UsageUnreadable = jarl.error.define("UsageUnreadable");
export type UsageUnreadable = InstanceType<typeof UsageUnreadable>;

// USER_HZ on Linux: /proc/self/stat counts in these ticks, and macOS's microseconds are read as
// them so both hosts share one window.
const CLK_TCK = 100;

export type Reading = {
  readonly cpuTicks: number;
  readonly memoryBytes: number;
};

export type ProcessSample = {
  readonly memoryBytes: number;
  readonly cpuPercent: number;
};

export type Source = () => Promise<jarl.Result<Reading, UsageUnreadable>>;

export type Usage = {
  readonly service: "usage";
  readonly collect: () => Promise<jarl.Result<ProcessSample, UsageUnreadable>>;
};

declare module "@oligarchy/app" {
  interface Services {
    usage: App.Register<"usage", Usage>;
  }
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

export type Options = { readonly source: Source; readonly now?: () => bigint };

// The cpu is this process busy since the last good reading; the first reading has none, so it is 0.
export const create = App.createService<never, Options, Usage>((_, options) => {
  const { source, now = () => process.hrtime.bigint() } = options;
  let last: { readonly reading: Reading; readonly at: bigint } | undefined;

  const collect = async (): Promise<jarl.Result<ProcessSample, UsageUnreadable>> => {
    const read = await source();
    if (!read.ok) {
      return read;
    }
    const reading = jarl.value(read);
    const at = now();
    const before = last;
    last = { reading, at };
    if (before === undefined) {
      return jarl.ok({ memoryBytes: reading.memoryBytes, cpuPercent: 0 });
    }
    const elapsedNs = at - before.at;
    const deltaTicks = reading.cpuTicks - before.reading.cpuTicks;
    // No time, or ticks that went backwards (a wrap): nothing to measure.
    if (elapsedNs <= 0n || deltaTicks < 0) {
      return jarl.ok({ memoryBytes: reading.memoryBytes, cpuPercent: 0 });
    }
    return jarl.ok({
      memoryBytes: reading.memoryBytes,
      cpuPercent: round1((deltaTicks * 1e9 * 100) / (CLK_TCK * Number(elapsedNs))),
    });
  };

  return { service: "usage", collect };
});

// What the /proc walk reads; undefined is a path that is not there, or cannot be read.
export type Fs = {
  readonly readFile: (path: string) => Promise<string | undefined>;
  readonly readdir: (path: string) => Promise<ReadonlyArray<string> | undefined>;
};

// After the last `)` of comm, fields count from state: utime is the 11th after it, stime the 12th.
const TICK_OFFSET = 11;

const parseCpuTicks = (stat: string): number | undefined => {
  const close = stat.lastIndexOf(")");
  if (close < 0) {
    return undefined;
  }
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const utime = Number(fields[TICK_OFFSET]);
  const stime = Number(fields[TICK_OFFSET + 1]);
  return Number.isFinite(utime) && Number.isFinite(stime) ? utime + stime : undefined;
};

const parseVmRssBytes = (status: string): number | undefined => {
  const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
  return match === null ? undefined : Number(match[1]) * 1024;
};

const parseChildren = (text: string): ReadonlyArray<string> =>
  text
    .trim()
    .split(/\s+/)
    .filter((token) => /^\d+$/.test(token));

// QEMU and ./driver hold the RAM this process does not, so memory is the tree: every task's
// children, a pid without VmRSS (a zombie, or one gone) adding nothing but still walked so a
// grandchild that answers counts.
const descendantsMemory = async (fs: Fs, root: string): Promise<number> => {
  const seen = new Set<string>([root]);
  let total = 0;
  const visit = async (pid: string): Promise<void> => {
    for (const tid of (await fs.readdir(`/proc/${pid}/task`)) ?? []) {
      const children = parseChildren(
        (await fs.readFile(`/proc/${pid}/task/${tid}/children`)) ?? "",
      );
      for (const child of children) {
        if (seen.has(child)) {
          continue;
        }
        seen.add(child);
        const status = await fs.readFile(`/proc/${child}/status`);
        total += (status === undefined ? undefined : parseVmRssBytes(status)) ?? 0;
        await visit(child);
      }
    }
  };
  await visit(root);
  return total;
};

const unreadable = (path: string) =>
  jarl.err(new UsageUnreadable(`unreadable process usage: ${path}`));

// cpu stays this pid: children come and go with each job, and their lost ticks would read as 0.
export const procSource =
  (fs: Fs): Source =>
  async () => {
    const statPath = "/proc/self/stat";
    const statusPath = "/proc/self/status";
    const stat = await fs.readFile(statPath);
    const cpuTicks = stat === undefined ? undefined : parseCpuTicks(stat);
    if (cpuTicks === undefined) {
      return unreadable(statPath);
    }
    const status = await fs.readFile(statusPath);
    const memoryBytes = status === undefined ? undefined : parseVmRssBytes(status);
    if (memoryBytes === undefined) {
      return unreadable(statusPath);
    }
    return jarl.ok({ cpuTicks, memoryBytes: memoryBytes + (await descendantsMemory(fs, "self")) });
  };

// What one ps printed, and its own pid.
export type Listing = {
  readonly text: string;
  readonly ps: number;
};

const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/gm;

// The rss of root and every descendant, as the /proc walk sums them. The ps that printed the
// listing is left out: /proc is read without one.
const treeRssBytes = (listing: Listing, root: number): number | undefined => {
  const rss = new Map<number, number>();
  const children = new Map<number, Array<number>>();
  for (const [, pid, ppid, kb] of listing.text.matchAll(PS_ROW)) {
    if (Number(pid) === listing.ps) {
      continue;
    }
    rss.set(Number(pid), Number(kb) * 1024);
    children.set(Number(ppid), [...(children.get(Number(ppid)) ?? []), Number(pid)]);
  }
  if (!rss.has(root)) {
    return undefined;
  }
  // The listing is not one snapshot: a pid reused while ps ran can close a loop.
  const seen = new Set<number>();
  let total = 0;
  const visit = (pid: number) => {
    if (seen.has(pid)) {
      return;
    }
    seen.add(pid);
    total += rss.get(pid) ?? 0;
    for (const child of children.get(pid) ?? []) {
      visit(child);
    }
  };
  visit(root);
  return total;
};

// macOS has no /proc. cpuUsage is getrusage's user and system microseconds for this pid, what
// utime and stime count on Linux; memory is the tree's rss from one ps listing.
export const psSource =
  (options: {
    readonly pid: number;
    readonly cpuUsage: () => { readonly user: number; readonly system: number };
    readonly list: () => Promise<jarl.Result<Listing, UsageUnreadable>>;
  }): Source =>
  async () => {
    const { pid, cpuUsage, list } = options;
    const { user, system } = cpuUsage();
    const listing = await list();
    if (!listing.ok) {
      return listing;
    }
    const memoryBytes = treeRssBytes(jarl.value(listing), pid);
    if (memoryBytes === undefined) {
      return jarl.err(new UsageUnreadable(`ps did not list this process (pid ${String(pid)})`));
    }
    return jarl.ok({ cpuTicks: ((user + system) * CLK_TCK) / 1_000_000, memoryBytes });
  };

// An empty header on every column prints no header line; rss is in KiB, as VmRSS is.
const PS_ARGS = ["-A", "-o", "pid=", "-o", "ppid=", "-o", "rss="];
// ps answers in milliseconds; one that wedges must not hold every later heartbeat with it.
const PS_TIMEOUT_MS = 10_000;
// It has nothing to flush, so SIGTERM gets a second before SIGKILL.
const PS_FORCE_KILL_MS = 1_000;

// Every process with its parent and rss, as ps lists them.
export const listProcesses = (
  options: {
    readonly command?: string;
    readonly args?: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  } = {},
): Promise<jarl.Result<Listing, UsageUnreadable>> =>
  new Promise((resolve) => {
    const { command = "/bin/ps", args = PS_ARGS, timeoutMs = PS_TIMEOUT_MS } = options;
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    let text = "";
    let settled = false;
    const settle = (result: jarl.Result<Listing, UsageUnreadable>) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      resolve(result);
    };
    const deadline = setTimeout(() => {
      settle(
        jarl.err(
          new UsageUnreadable(`ps did not answer within ${String(timeoutMs / 1000)} seconds`),
        ),
      );
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, PS_FORCE_KILL_MS).unref();
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      text += chunk;
    });
    child.on("error", (error) => {
      settle(jarl.err(new UsageUnreadable(error.message)));
    });
    child.on("close", () => {
      settle(jarl.ok({ text, ps: child.pid ?? 0 }));
    });
  });

const orUndefined = async <T>(read: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await read();
  } catch {
    return undefined;
  }
};

const nodeFs: Fs = {
  readFile: (path) => orUndefined(() => readFile(path, "utf8")),
  readdir: (path) => orUndefined(() => readdir(path)),
};

// This process's usage: ps on macOS, /proc everywhere else.
export const forThisProcess = (): App.Made<Usage> =>
  create(
    {},
    {
      source:
        process.platform === "darwin"
          ? psSource({
              pid: process.pid,
              cpuUsage: () => process.cpuUsage(),
              list: () => listProcesses(),
            })
          : procSource(nodeFs),
    },
  );
