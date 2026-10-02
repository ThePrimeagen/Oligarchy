import { EventEmitter } from "node:events";
import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Usage from "../src/usage.ts";

const SECOND = 1_000_000_000n;

// A source that answers from `readings` in turn, and a clock that reads `times` in turn.
const scripted = (
  readings: ReadonlyArray<Usage.Reading | Usage.UsageUnreadable>,
  times: ReadonlyArray<bigint>,
) => {
  const left = [...readings];
  const clock = [...times];
  const source: Usage.Source = async () => {
    const next = left.shift();
    if (next === undefined) {
      throw new Error("the script ran out");
    }
    return next instanceof Usage.UsageUnreadable ? jarl.err(next) : jarl.ok(next);
  };
  return Usage.create({}, { source, now: () => clock.shift() ?? 0n });
};

describe("collecting this process's usage", () => {
  it("reports memory and cpu 0 at first, then the cpu busy over the window since the last reading (happy)", async () => {
    const usage = scripted(
      [
        { cpuTicks: 100, memoryBytes: 1000 },
        { cpuTicks: 150, memoryBytes: 2000 },
      ],
      [0n, SECOND],
    );

    expect(jarl.unwrap(await usage.collect())).toEqual({ memoryBytes: 1000, cpuPercent: 0 });
    expect(jarl.unwrap(await usage.collect())).toEqual({ memoryBytes: 2000, cpuPercent: 50 });
  });

  it.each([
    ["no time passed", { cpuTicks: 150, memoryBytes: 2 }, 0n],
    ["the ticks went backwards", { cpuTicks: 50, memoryBytes: 2 }, SECOND],
  ])("reports cpu 0 when %s (error)", async (_, second, at) => {
    const usage = scripted([{ cpuTicks: 100, memoryBytes: 1 }, second], [0n, at]);
    await usage.collect();

    expect(jarl.unwrap(await usage.collect())).toEqual({ memoryBytes: 2, cpuPercent: 0 });
  });

  it("a source that fails is its error, and the next collect measures from the last good reading (error)", async () => {
    const refused = new Usage.UsageUnreadable("ps did not list this process (pid 42)");
    const usage = scripted(
      [{ cpuTicks: 0, memoryBytes: 1 }, refused, { cpuTicks: 100, memoryBytes: 1 }],
      [0n, 2n * SECOND],
    );
    await usage.collect();

    const failed = await usage.collect();
    expect(jarl.is_err(failed) && failed.error).toBe(refused);
    expect(jarl.unwrap(await usage.collect()).cpuPercent).toBe(50);
  });
});

const stat = (utime: number, stime: number) =>
  `123 (node (a b)) S ${Array<string>(10).fill("0").join(" ")} ${String(utime)} ${String(stime)} 0 0 20`;

const vmRss = (kb: number) => `Name:\tnode\nVmRSS:\t   ${String(kb)} kB\nThreads:\t1\n`;

// A /proc of paths to texts, and of directories to their entries.
const fakeFs = (
  files: Record<string, string>,
  dirs: Record<string, ReadonlyArray<string>>,
): Usage.Fs => ({
  readFile: async (path) => files[path],
  readdir: async (path) => dirs[path],
});

const SELF = { "/proc/self/stat": stat(250, 50), "/proc/self/status": vmRss(1000) };

describe("reading usage from /proc", () => {
  it("reads this pid's ticks and memory and adds every descendant's VmRSS, walking past a child that has none (happy)", async () => {
    const fs = fakeFs(
      {
        ...SELF,
        "/proc/self/task/123/children": "200 ",
        "/proc/self/task/124/children": "201",
        // A zombie: no VmRSS of its own, and its child still counts.
        "/proc/200/status": "Name:\tqemu\nState:\tZ\n",
        "/proc/200/task/200/children": "300",
        "/proc/300/status": vmRss(5),
      },
      {
        "/proc/self/task": ["123", "124"],
        "/proc/200/task": ["200"],
        "/proc/300/task": ["300"],
      },
    );

    expect(jarl.unwrap(await Usage.procSource(fs)())).toEqual({
      cpuTicks: 300,
      memoryBytes: (1000 + 5) * 1024,
    });
  });

  it.each([
    ["missing", {}],
    ["without the closing parenthesis of comm", { "/proc/self/stat": "123 (node S 1 2 3" }],
    ["too short", { "/proc/self/stat": "123 (node) S 1 2" }],
  ])("a /proc/self/stat that is %s is unreadable (error)", async (_, files) => {
    const read = await Usage.procSource(
      fakeFs({ "/proc/self/status": SELF["/proc/self/status"], ...files }, {}),
    )();

    expect(jarl.is_err(read) && read.error.message).toBe(
      "unreadable process usage: /proc/self/stat",
    );
  });

  it("a /proc/self/status without VmRSS is unreadable (error)", async () => {
    const read = await Usage.procSource(
      fakeFs({ ...SELF, "/proc/self/status": "Name:\tnode\n" }, {}),
    )();

    expect(jarl.is_err(read) && read.error.message).toBe(
      "unreadable process usage: /proc/self/status",
    );
  });
});

// pid ppid rss(KiB): 42 is this process, 99 the ps that listed it, 70 someone else's.
const LISTING = [
  "  1     0   100",
  " 42     1  1000",
  " 50    42   200",
  " 60    50    30",
  " 99    42     7",
  " 70     1   500",
].join("\n");

const listed = (text: string) => async () => jarl.ok({ text, ps: 99 });

describe("reading usage from ps", () => {
  it("sums the rss of this pid and its descendants, not the ps or anyone else's, and reads cpu from getrusage (happy)", async () => {
    const source = Usage.psSource({
      pid: 42,
      cpuUsage: () => ({ user: 2_000_000, system: 1_000_000 }),
      list: listed(LISTING),
    });

    expect(jarl.unwrap(await source())).toEqual({ cpuTicks: 300, memoryBytes: 1230 * 1024 });
  });

  it("a listing that does not name this pid is unreadable (error)", async () => {
    const source = Usage.psSource({
      pid: 7,
      cpuUsage: () => ({ user: 0, system: 0 }),
      list: listed(LISTING),
    });

    const read = await source();
    expect(jarl.is_err(read) && read.error.message).toBe("ps did not list this process (pid 7)");
  });

  it("a listing that failed is its error (error)", async () => {
    const refused = new Usage.UsageUnreadable("ps did not answer within 10 seconds");
    const source = Usage.psSource({
      pid: 42,
      cpuUsage: () => ({ user: 0, system: 0 }),
      list: async () => jarl.err(refused),
    });

    const read = await source();
    expect(jarl.is_err(read) && read.error).toBe(refused);
  });

  it("a pid reused while ps ran closes a loop, and each process in it counts once (error)", async () => {
    const loop = [" 42    60  1000", " 50    42   200", " 60    50    30"].join("\n");
    const source = Usage.psSource({
      pid: 42,
      cpuUsage: () => ({ user: 0, system: 0 }),
      list: listed(loop),
    });

    expect(jarl.unwrap(await source()).memoryBytes).toBe(1230 * 1024);
  });
});

describe("running ps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const fakeProcess = () => {
    const events = new EventEmitter();
    const output = new EventEmitter();
    const calls: Array<Parameters<Usage.Spawn>> = [];
    const signals: Array<string> = [];
    const encodings: Array<string> = [];
    let exited = false;
    const spawn: Usage.Spawn = (...args) => {
      calls.push(args);
      return {
        pid: 42,
        get exitCode() {
          return exited ? 0 : null;
        },
        signalCode: null,
        kill: (signal) => {
          signals.push(signal);
        },
        on: events.on.bind(events),
        stdout: {
          setEncoding: (encoding) => {
            encodings.push(encoding);
          },
          on: output.on.bind(output),
        },
      };
    };
    return {
      spawn,
      calls,
      signals,
      encodings,
      write: (text: string) => output.emit("data", text),
      fail: (error: Error) => events.emit("error", error),
      close: () => {
        exited = true;
        events.emit("close");
      },
    };
  };

  it("gives what the command printed and its pid (happy)", async () => {
    const child = fakeProcess();
    const ran = Usage.listProcesses({ spawn: child.spawn });
    child.write(" 1 0");
    child.write(" 5\n");
    child.close();

    expect(jarl.unwrap(await ran)).toEqual({ text: " 1 0 5\n", ps: 42 });
    expect(child.calls).toEqual([
      [
        "/bin/ps",
        ["-A", "-o", "pid=", "-o", "ppid=", "-o", "rss="],
        { stdio: ["ignore", "pipe", "ignore"] },
      ],
    ]);
    expect(child.encodings).toEqual(["utf8"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.signals).toEqual([]);
  });

  it("a command that cannot start is unreadable, with the platform's reason (error)", async () => {
    const child = fakeProcess();
    const pending = Usage.listProcesses({ command: "/nonexistent/ps", spawn: child.spawn });
    child.fail(new Error("spawn /nonexistent/ps ENOENT"));
    child.close();
    const ran = await pending;

    expect(jarl.error.is(ran, Usage.UsageUnreadable)).toBe(true);
    expect(jarl.is_err(ran) && ran.error.message).toBe("spawn /nonexistent/ps ENOENT");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.signals).toEqual([]);
  });

  it.each([
    { behavior: "exits during the grace period", exits: true },
    { behavior: "ignores SIGTERM", exits: false },
  ])(
    "a command that $behavior times out at the deadline and is killed only while still running (error)",
    async ({ exits }) => {
      const child = fakeProcess();
      let settled = false;
      const pending = Usage.listProcesses({
        spawn: child.spawn,
        timeoutMs: 200,
      }).then((result) => {
        settled = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(199);
      expect(settled).toBe(false);
      expect(child.signals).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      const ran = await pending;
      expect(jarl.error.is(ran, Usage.UsageUnreadable)).toBe(true);
      expect(jarl.is_err(ran) && ran.error.message).toBe("ps did not answer within 0.2 seconds");
      expect(child.signals).toEqual(["SIGTERM"]);
      if (exits) {
        child.close();
      }
      await vi.advanceTimersByTimeAsync(999);
      expect(child.signals).toEqual(["SIGTERM"]);
      await vi.advanceTimersByTimeAsync(1);
      expect(child.signals).toEqual(exits ? ["SIGTERM"] : ["SIGTERM", "SIGKILL"]);
      child.close();
    },
  );
});
