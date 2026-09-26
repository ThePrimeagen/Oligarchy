import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import {
  Cause,
  Context,
  Effect,
  Exit,
  FileSystem,
  Fiber,
  Layer,
  PlatformError,
  Sink,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as ProcessUsage from "../src/process.ts";

// pid (comm) then fields 3..13, then utime (14) and stime (15). comm may contain spaces.
const stat = (comm: string, utime: number, stime: number): string =>
  `1 (${comm}) R 0 0 0 0 -1 0 0 0 0 0 ${String(utime)} ${String(stime)} 0 0 20 0`;

const status = (kb: number): string =>
  `Name:\tnode\nState:\tS\nVmRSS:\t    ${String(kb)} kB\nVmData:\t1 kB\n`;

type Scripted = {
  readonly source: ProcessUsage.Source;
  readonly calls: () => number;
};

const scripted = (readings: ReadonlyArray<ProcessUsage.Reading | Error>): Scripted => {
  let index = 0;
  return {
    source: () =>
      Effect.sync(() => {
        const next = readings[Math.min(index, readings.length - 1)];
        index += 1;
        if (next instanceof Error) {
          throw next;
        }
        return next ?? { cpuTicks: 0, memoryBytes: 0 };
      }),
    calls: () => index,
  };
};

const build = (source: ProcessUsage.Source) =>
  Effect.gen(function* () {
    const layer = Layer.effect(ProcessUsage.ProcessUsage)(ProcessUsage.ProcessUsage.make(source));
    return {
      usage: Context.get(yield* Layer.build(layer), ProcessUsage.ProcessUsage),
    };
  });

describe("ProcessUsage.collect happy path", () => {
  it.effect("reports current memory and cpu 0 before a second sample", () =>
    Effect.gen(function* () {
      const { usage } = yield* build(scripted([{ cpuTicks: 10, memoryBytes: 4_096_000 }]).source);
      expect(yield* usage.collect).toEqual({ memoryBytes: 4_096_000, cpuPercent: 0 });
    }),
  );

  it.effect("averages process cpu over the elapsed window, rounded to one decimal", () =>
    Effect.gen(function* () {
      // 3000 ticks in 30s is 100% of one core at USER_HZ 100.
      const { usage } = yield* build(
        scripted([
          { cpuTicks: 0, memoryBytes: 1_000 },
          { cpuTicks: 3_000, memoryBytes: 2_000 },
        ]).source,
      );
      expect(yield* usage.collect).toEqual({ memoryBytes: 1_000, cpuPercent: 0 });
      yield* TestClock.adjust("30 seconds");
      expect(yield* usage.collect).toEqual({ memoryBytes: 2_000, cpuPercent: 100 });
    }),
  );

  it.effect("reports a half-busy and a two-core-busy window", () =>
    Effect.gen(function* () {
      const { usage } = yield* build(
        scripted([
          { cpuTicks: 100, memoryBytes: 1 },
          { cpuTicks: 1_600, memoryBytes: 1 },
          { cpuTicks: 7_600, memoryBytes: 1 },
        ]).source,
      );
      yield* usage.collect;
      yield* TestClock.adjust("30 seconds");
      expect((yield* usage.collect).cpuPercent).toBe(50);
      yield* TestClock.adjust("30 seconds");
      expect((yield* usage.collect).cpuPercent).toBe(200);
    }),
  );

  it.effect("reports cpu 0 when no time has passed between samples", () =>
    Effect.gen(function* () {
      const { usage } = yield* build(
        scripted([
          { cpuTicks: 0, memoryBytes: 1 },
          { cpuTicks: 100, memoryBytes: 1 },
        ]).source,
      );
      yield* usage.collect;
      expect((yield* usage.collect).cpuPercent).toBe(0);
    }),
  );
});

describe("ProcessUsage.collect unhappy path", () => {
  it.effect("a throwing source is a defect and the next collect still runs", () =>
    Effect.gen(function* () {
      const boom = new Error("stat vanished");
      const { usage } = yield* build(
        scripted([{ cpuTicks: 0, memoryBytes: 1 }, boom, { cpuTicks: 3_000, memoryBytes: 2 }])
          .source,
      );
      yield* usage.collect;
      yield* TestClock.adjust("30 seconds");
      const exit = yield* Effect.exit(usage.collect);
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      // The failed read is not a sample: the next window is since the last good one (60s).
      yield* TestClock.adjust("30 seconds");
      expect(yield* usage.collect).toEqual({ memoryBytes: 2, cpuPercent: 50 });
    }),
  );
});

const notFound = (method: string, path: string): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
  });

// A /proc of the given files and directories, recording which methods were called; a directory
// lists the entries directly under it.
const procFs = (spec: {
  readonly files: Readonly<Record<string, string>>;
  readonly directories?: ReadonlyArray<string>;
}) => {
  const methods: Array<string> = [];
  const directories = spec.directories ?? [];
  const entries = [...directories, ...Object.keys(spec.files)];
  const layer = FileSystem.layerNoop({
    readFileString: (path) =>
      Effect.suspend(() => {
        methods.push("readFileString");
        const text = spec.files[path];
        return text === undefined
          ? Effect.fail(notFound("readFileString", path))
          : Effect.succeed(text);
      }),
    readDirectory: (path) =>
      Effect.suspend(() => {
        methods.push("readDirectory");
        return directories.includes(path)
          ? Effect.succeed(
              entries
                .filter((entry) => entry.startsWith(`${path}/`))
                .map((entry) => entry.slice(path.length + 1))
                .filter((name) => !name.includes("/")),
            )
          : Effect.fail(notFound("readDirectory", path));
      }),
  });
  return { methods, layer };
};

// The Linux source over a scripted /proc, whatever host the test runs on.
const onLinux = (fs: ReturnType<typeof procFs>) =>
  Layer.effect(ProcessUsage.ProcessUsage)(
    Effect.flatMap(ProcessUsage.procSource, ProcessUsage.ProcessUsage.make),
  ).pipe(Layer.provide(fs.layer));

const collectTree = (spec: {
  readonly files: Readonly<Record<string, string>>;
  readonly directories?: ReadonlyArray<string>;
}) =>
  Effect.gen(function* () {
    const usage = yield* ProcessUsage.ProcessUsage;
    return yield* usage.collect;
  }).pipe(Effect.provide(onLinux(procFs(spec))));

const collectThrough = (statText: string | undefined, statusText: string | undefined) =>
  collectTree({
    files: {
      ...(statText === undefined ? {} : { "/proc/self/stat": statText }),
      ...(statusText === undefined ? {} : { "/proc/self/status": statusText }),
    },
  });

describe("ProcessUsage.procSource happy path (Linux)", () => {
  it.effect("reads /proc/self/stat and /proc/self/status without sudo", () => {
    const fs = procFs({
      files: { "/proc/self/stat": stat("node", 0, 0), "/proc/self/status": status(4) },
    });
    return Effect.gen(function* () {
      const usage = yield* ProcessUsage.ProcessUsage;
      expect(yield* usage.collect).toEqual({ memoryBytes: 4 * 1024, cpuPercent: 0 });
      expect(fs.methods).toEqual(["readFileString", "readFileString", "readDirectory"]);
    }).pipe(Effect.provide(onLinux(fs)));
  });

  it.effect("reads ticks after a comm that contains spaces and parentheses", () =>
    Effect.gen(function* () {
      expect(yield* collectThrough(stat("qemu-system x86_64", 10, 5), status(1))).toEqual({
        memoryBytes: 1024,
        cpuPercent: 0,
      });
    }),
  );

  it.effect("reads VmRSS kilobytes as bytes", () =>
    Effect.gen(function* () {
      expect(yield* collectThrough(stat("node", 0, 0), status(12345))).toEqual({
        memoryBytes: 12_345 * 1024,
        cpuPercent: 0,
      });
    }),
  );

  it.effect("sums VmRSS of every child that still answers, not only this pid", () =>
    Effect.gen(function* () {
      expect(
        yield* collectTree({
          directories: [
            "/proc/self/task",
            "/proc/self/task/1",
            "/proc/10/task",
            "/proc/10/task/10",
          ],
          files: {
            "/proc/self/stat": stat("node", 10, 5),
            "/proc/self/status": status(4),
            "/proc/self/task/1/children": "10\n",
            "/proc/10/stat": stat("qemu-system x86_64", 900, 100),
            "/proc/10/status": status(8),
            "/proc/10/task/10/children": "",
          },
        }),
      ).toEqual({ memoryBytes: 12 * 1024, cpuPercent: 0 });
    }),
  );

  it.effect("adds children listed by every thread and walks grandchildren", () =>
    Effect.gen(function* () {
      expect(
        yield* collectTree({
          directories: [
            "/proc/self/task",
            "/proc/self/task/1",
            "/proc/self/task/2",
            "/proc/10/task",
            "/proc/10/task/10",
            "/proc/11/task",
            "/proc/11/task/11",
            "/proc/20/task",
            "/proc/20/task/20",
          ],
          files: {
            "/proc/self/stat": stat("node", 0, 0),
            "/proc/self/status": status(1),
            "/proc/self/task/1/children": "10",
            "/proc/self/task/2/children": "11",
            "/proc/10/stat": stat("qemu", 0, 0),
            "/proc/10/status": status(2),
            "/proc/10/task/10/children": "20",
            "/proc/11/stat": stat("opencode", 0, 0),
            "/proc/11/status": status(3),
            "/proc/11/task/11/children": "",
            "/proc/20/stat": stat("vhost", 0, 0),
            "/proc/20/status": status(4),
            "/proc/20/task/20/children": "",
          },
        }),
      ).toEqual({ memoryBytes: 10 * 1024, cpuPercent: 0 });
    }),
  );
});

describe("ProcessUsage.procSource unhappy path (Linux)", () => {
  it.effect("dies when /proc/self/stat is missing", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(collectThrough(undefined, status(1)));
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    }),
  );

  it.effect("dies when the stat line is empty, unclosed, too short, or not numbers", () =>
    Effect.gen(function* () {
      for (const line of [
        "",
        "1 (node R 0 0",
        "1 (node) R 0",
        "1 (node) R 0 0 0 0 -1 0 0 0 0 0 xx 0",
      ]) {
        const exit = yield* Effect.exit(collectThrough(line, status(1)));
        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause), line).toBe(true);
      }
    }),
  );

  it.effect("dies when the status text has no VmRSS or it is not a number", () =>
    Effect.gen(function* () {
      for (const text of ["Name:\tnode\n", "VmRSS:\t    xx kB\n"]) {
        const exit = yield* Effect.exit(collectThrough(stat("node", 0, 0), text));
        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause), text).toBe(true);
      }
    }),
  );

  it.effect("skips a child whose /proc files are gone", () =>
    Effect.gen(function* () {
      expect(
        yield* collectTree({
          directories: ["/proc/self/task", "/proc/self/task/1"],
          files: {
            "/proc/self/stat": stat("node", 0, 0),
            "/proc/self/status": status(4),
            "/proc/self/task/1/children": "10 11\n",
          },
        }),
      ).toEqual({ memoryBytes: 4 * 1024, cpuPercent: 0 });
    }),
  );

  it.effect("skips a child whose status cannot be read as VmRSS", () =>
    Effect.gen(function* () {
      expect(
        yield* collectTree({
          directories: [
            "/proc/self/task",
            "/proc/self/task/1",
            "/proc/10/task",
            "/proc/10/task/10",
            "/proc/11/task",
            "/proc/11/task/11",
          ],
          files: {
            "/proc/self/stat": stat("node", 0, 0),
            "/proc/self/status": status(4),
            "/proc/self/task/1/children": "10 11",
            "/proc/10/status": "Name:\tqemu\n",
            "/proc/10/task/10/children": "",
            "/proc/11/status": status(16),
            "/proc/11/task/11/children": "",
          },
        }),
      ).toEqual({ memoryBytes: 20 * 1024, cpuPercent: 0 });
    }),
  );

  it.effect("still counts a grandchild when the child in between has no VmRSS", () =>
    Effect.gen(function* () {
      expect(
        yield* collectTree({
          directories: [
            "/proc/self/task",
            "/proc/self/task/1",
            "/proc/10/task",
            "/proc/10/task/10",
            "/proc/20/task",
            "/proc/20/task/20",
          ],
          files: {
            "/proc/self/stat": stat("node", 0, 0),
            "/proc/self/status": status(1),
            "/proc/self/task/1/children": "10",
            "/proc/10/status": "Name:\tqemu\n",
            "/proc/10/task/10/children": "20",
            "/proc/20/status": status(4),
            "/proc/20/task/20/children": "",
          },
        }),
      ).toEqual({ memoryBytes: 5 * 1024, cpuPercent: 0 });
    }),
  );

  it.effect("a missing children file on a thread still reports this pid", () =>
    Effect.gen(function* () {
      expect(
        yield* collectTree({
          directories: ["/proc/self/task", "/proc/self/task/1"],
          files: {
            "/proc/self/stat": stat("node", 0, 0),
            "/proc/self/status": status(4),
          },
        }),
      ).toEqual({ memoryBytes: 4 * 1024, cpuPercent: 0 });
    }),
  );
});

const PID = 500;
const PS_PID = 4000;

// Synthetic: laid out as macOS prints `ps -A -o pid= -o ppid= -o rss=`, rss in KiB.
const psRow = (pid: number, ppid: number, kb: number): string =>
  `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${String(kb).padStart(6)}\n`;

type CpuUsage = { readonly user: number; readonly system: number };

// The listing a ps printed, as the reader is handed it.
const listed = (rows: ReadonlyArray<string>): Effect.Effect<ProcessUsage.Listing> =>
  Effect.succeed({ text: rows.join(""), ps: PS_PID });

// The macOS source over a listing and getrusage, whatever host the test runs on.
const onMac = (
  list: Effect.Effect<ProcessUsage.Listing, ProcessUsage.PsFailed>,
  cpu: () => CpuUsage = () => ({ user: 0, system: 0 }),
) =>
  Layer.effect(ProcessUsage.ProcessUsage)(
    ProcessUsage.ProcessUsage.make(ProcessUsage.psSource(PID, cpu, list)),
  );

const collectOnMac = (list: Effect.Effect<ProcessUsage.Listing, ProcessUsage.PsFailed>) =>
  Effect.gen(function* () {
    const usage = yield* ProcessUsage.ProcessUsage;
    return yield* usage.collect;
  }).pipe(Effect.provide(onMac(list)));

describe("ProcessUsage.psSource happy path (macOS)", () => {
  it.effect("sums ps's rss of this pid and every descendant, KiB as bytes, and no one else", () =>
    Effect.gen(function* () {
      expect(
        yield* collectOnMac(
          listed([
            psRow(1, 0, 9_000),
            psRow(PID, 1, 100),
            psRow(600, PID, 20),
            psRow(601, PID, 7),
            psRow(700, 600, 3),
            psRow(800, 1, 5_000),
            psRow(900, 800, 5_000),
          ]),
        ),
      ).toEqual({ memoryBytes: 130 * 1024, cpuPercent: 0 });
    }),
  );

  it.effect("does not count the ps it ran to take the reading", () =>
    Effect.gen(function* () {
      expect(
        yield* collectOnMac(
          listed([psRow(PID, 1, 100), psRow(PS_PID, PID, 1_500), psRow(600, PID, 20)]),
        ),
      ).toEqual({ memoryBytes: 120 * 1024, cpuPercent: 0 });
    }),
  );

  it.effect("reads cpu as this pid's user plus system time, over the window as /proc's is", () => {
    const readings: ReadonlyArray<CpuUsage> = [
      { user: 0, system: 0 },
      { user: 20_000_000, system: 10_000_000 },
      { user: 30_000_000, system: 15_000_000 },
    ];
    let index = 0;
    const cpu = () => readings[Math.min(index++, readings.length - 1)] ?? { user: 0, system: 0 };
    return Effect.gen(function* () {
      const usage = yield* ProcessUsage.ProcessUsage;
      expect(yield* usage.collect).toEqual({ memoryBytes: 1024, cpuPercent: 0 });
      // 30 s of cpu in 30 s is one core busy, as 3000 ticks are.
      yield* TestClock.adjust("30 seconds");
      expect((yield* usage.collect).cpuPercent).toBe(100);
      yield* TestClock.adjust("30 seconds");
      expect((yield* usage.collect).cpuPercent).toBe(50);
    }).pipe(Effect.provide(onMac(listed([psRow(PID, 1, 1)]), cpu)));
  });

  it.effect("a header or a blank line is not a process, and the rows after it still count", () =>
    Effect.gen(function* () {
      expect(
        yield* collectOnMac(
          listed(["  PID  PPID    RSS\n", "\n", psRow(PID, 1, 100), "   \n", psRow(600, PID, 20)]),
        ),
      ).toEqual({ memoryBytes: 120 * 1024, cpuPercent: 0 });
    }),
  );
});

describe("ProcessUsage.psSource unhappy path (macOS)", () => {
  it.effect(
    "a listing that fails fails collect with its PsFailed, and the next collect reads",
    () =>
      Effect.gen(function* () {
        let runs = 0;
        const refused = ProcessUsage.PsFailed.make({ message: "spawn /bin/ps EAGAIN" });
        const list = Effect.suspend(() => {
          runs += 1;
          return runs === 1 ? Effect.fail(refused) : listed([psRow(PID, 1, 4)]);
        });
        yield* Effect.gen(function* () {
          const usage = yield* ProcessUsage.ProcessUsage;
          expect(yield* Effect.flip(usage.collect)).toBe(refused);
          expect(yield* usage.collect).toEqual({ memoryBytes: 4 * 1024, cpuPercent: 0 });
        }).pipe(Effect.provide(onMac(list)));
      }),
  );

  it.effect("a listing that does not name this pid fails collect with PsFailed", () =>
    Effect.gen(function* () {
      for (const rows of [[], [psRow(1, 0, 9_000), psRow(600, 1, 20)]]) {
        const error = yield* Effect.flip(collectOnMac(listed(rows)));
        expect(error, rows.join("")).toMatchObject({
          _tag: "PsFailed",
          message: "ps did not list this process (pid 500)",
        });
      }
    }),
  );
});

// A spawner that hands ps the scripted stdout, recording the command it was given and whether
// the handle's scope was released (the real spawner's release is what signals the process).
const psSpawner = (
  answer: { readonly stdout: string | "never" } | { readonly spawnError: string },
) => {
  const commands: Array<ChildProcess.StandardCommand> = [];
  let released = false;
  const spawn: ChildProcessSpawner.ChildProcessSpawner["Service"]["spawn"] = (command) =>
    Effect.gen(function* () {
      if (!ChildProcess.isStandardCommand(command)) {
        return yield* Effect.die("psSpawner: piped commands are not scripted");
      }
      commands.push(command);
      if ("spawnError" in answer) {
        return yield* Effect.fail(
          PlatformError.systemError({
            _tag: "Unknown",
            module: "ChildProcess",
            method: "spawn",
            pathOrDescriptor: command.command,
            cause: new Error(answer.spawnError),
          }),
        );
      }
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          released = true;
        }),
      );
      const stdout =
        answer.stdout === "never"
          ? Stream.never
          : Stream.make(new TextEncoder().encode(answer.stdout));
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(PS_PID),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout,
        stderr: Stream.empty,
        all: stdout,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
    });
  return {
    commands,
    released: () => released,
    layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(ChildProcessSpawner.make(spawn)),
  };
};

describe("ProcessUsage.listProcesses happy path", () => {
  it.effect(
    "runs /bin/ps for every pid's parent and rss and answers what it printed with its pid",
    () => {
      const spawner = psSpawner({ stdout: psRow(PID, 1, 100) });
      return Effect.gen(function* () {
        expect(yield* ProcessUsage.listProcesses).toEqual({
          text: psRow(PID, 1, 100),
          ps: PS_PID,
        });
        expect(spawner.commands.map((command) => [command.command, command.args])).toEqual([
          ["/bin/ps", ["-A", "-o", "pid=", "-o", "ppid=", "-o", "rss="]],
        ]);
        expect(spawner.released()).toBe(true);
      }).pipe(Effect.provide(spawner.layer));
    },
  );

  // The spawner's release signals the process with the command's own settings: SIGTERM, then
  // SIGKILL a second later for a ps that ignores it, so a wedged ps never holds the tick.
  it.effect("asks for SIGTERM, then SIGKILL a second later, when the listing is abandoned", () => {
    const spawner = psSpawner({ stdout: "" });
    return Effect.gen(function* () {
      yield* ProcessUsage.listProcesses;
      expect(spawner.commands[0]?.options).toMatchObject({
        killSignal: "SIGTERM",
        forceKillAfter: "1 second",
      });
    }).pipe(Effect.provide(spawner.layer));
  });
});

describe("ProcessUsage.listProcesses unhappy path", () => {
  it.effect("a ps that cannot start fails with PsFailed naming the platform's reason", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(ProcessUsage.listProcesses).pipe(
        Effect.provide(psSpawner({ spawnError: "spawn /bin/ps EAGAIN" }).layer),
      );
      expect(error).toMatchObject({ _tag: "PsFailed", message: "spawn /bin/ps EAGAIN" });
    }),
  );

  it.effect(
    "a listing that never answers fails with PsFailed after ten seconds, and its process is released",
    () => {
      const spawner = psSpawner({ stdout: "never" });
      return Effect.gen(function* () {
        const listing = yield* Effect.forkChild(Effect.flip(ProcessUsage.listProcesses));
        yield* TestClock.adjust("9 seconds");
        expect(listing.pollUnsafe()).toBeUndefined();
        expect(spawner.released()).toBe(false);
        yield* TestClock.adjust("1 second");
        expect(yield* Fiber.join(listing)).toMatchObject({
          _tag: "PsFailed",
          message: "ps did not answer within 10 seconds",
        });
        expect(spawner.released()).toBe(true);
      }).pipe(Effect.provide(spawner.layer));
    },
  );
});
