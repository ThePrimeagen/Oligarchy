import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as ProcessUsage from "../../src/shared/process-usage.ts";
import * as FakeFs from "../support/fake-fs.ts";

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

const procFs = (statText: string | undefined, statusText: string | undefined) =>
  FakeFs.recordingFs(
    {
      ...(statText === undefined ? {} : { "/proc/self/stat": "File" }),
      ...(statusText === undefined ? {} : { "/proc/self/status": "File" }),
    },
    {
      contents: {
        ...(statText === undefined
          ? {}
          : { "/proc/self/stat": new TextEncoder().encode(statText) }),
        ...(statusText === undefined
          ? {}
          : { "/proc/self/status": new TextEncoder().encode(statusText) }),
      },
    },
  );

const collectThrough = (statText: string | undefined, statusText: string | undefined) =>
  Effect.gen(function* () {
    const usage = yield* ProcessUsage.ProcessUsage;
    return yield* usage.collect;
  }).pipe(
    Effect.provide(
      ProcessUsage.ProcessUsage.layer.pipe(Layer.provide(procFs(statText, statusText).layer)),
    ),
  );

const treeFs = (spec: {
  readonly files: Readonly<Record<string, string>>;
  readonly directories?: ReadonlyArray<string>;
}) => {
  const entries: Record<string, "File" | "Directory"> = {};
  const contents: Record<string, Uint8Array> = {};
  for (const dir of spec.directories ?? []) {
    entries[dir] = "Directory";
  }
  for (const [path, text] of Object.entries(spec.files)) {
    entries[path] = "File";
    contents[path] = new TextEncoder().encode(text);
  }
  return FakeFs.recordingFs(entries, { contents });
};

const collectTree = (spec: {
  readonly files: Readonly<Record<string, string>>;
  readonly directories?: ReadonlyArray<string>;
}) =>
  Effect.gen(function* () {
    const usage = yield* ProcessUsage.ProcessUsage;
    return yield* usage.collect;
  }).pipe(
    Effect.provide(ProcessUsage.ProcessUsage.layer.pipe(Layer.provide(treeFs(spec).layer))),
  );

describe("ProcessUsage.layer happy path", () => {
  it.effect("reads /proc/self/stat and /proc/self/status without sudo", () => {
    const fs = procFs(stat("node", 0, 0), status(4));
    return Effect.gen(function* () {
      const usage = yield* ProcessUsage.ProcessUsage;
      expect(yield* usage.collect).toEqual({ memoryBytes: 4 * 1024, cpuPercent: 0 });
      expect(FakeFs.methods(fs)).toEqual(["readFileString", "readFileString", "readDirectory"]);
    }).pipe(Effect.provide(ProcessUsage.ProcessUsage.layer.pipe(Layer.provide(fs.layer))));
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
          directories: ["/proc/self/task", "/proc/self/task/1", "/proc/10/task", "/proc/10/task/10"],
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

describe("ProcessUsage.layer unhappy path", () => {
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

  it.effect("skips a child whose stat or status cannot be read as a reading", () =>
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
            "/proc/12/task",
            "/proc/12/task/12",
          ],
          files: {
            "/proc/self/stat": stat("node", 0, 0),
            "/proc/self/status": status(4),
            "/proc/self/task/1/children": "10 11 12",
            "/proc/10/stat": "1 (qemu R 0 0",
            "/proc/10/status": status(8),
            "/proc/10/task/10/children": "",
            "/proc/11/stat": stat("qemu", 0, 0),
            "/proc/11/status": "Name:\tqemu\n",
            "/proc/11/task/11/children": "",
            "/proc/12/stat": stat("qemu", 0, 0),
            "/proc/12/status": status(16),
            "/proc/12/task/12/children": "",
          },
        }),
      ).toEqual({ memoryBytes: 20 * 1024, cpuPercent: 0 });
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
