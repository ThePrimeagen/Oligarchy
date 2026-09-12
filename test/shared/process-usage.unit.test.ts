import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import * as ProcessUsage from "../../src/shared/process-usage.ts";
import * as FakeFs from "../support/fake-fs.ts";

// pid (comm) then fields 3..13, then utime (14) and stime (15). comm may contain spaces.
const stat = (comm: string, utime: number, stime: number): string =>
  `1 (${comm}) R 0 0 0 0 -1 0 0 0 0 0 ${String(utime)} ${String(stime)} 0 0 20 0`;

const status = (kb: number): string =>
  `Name:\tnode\nState:\tS\nVmRSS:\t    ${String(kb)} kB\nVmData:\t1 kB\n`;

describe("parseCpuTicks happy path", () => {
  it("reads utime plus stime from a /proc/self/stat line", () => {
    expect(ProcessUsage.parseCpuTicks(stat("node", 120, 30))).toEqual(Option.some(150));
  });

  it("finds the ticks after a comm that contains spaces and parentheses", () => {
    expect(ProcessUsage.parseCpuTicks(stat("qemu-system x86_64", 10, 5))).toEqual(Option.some(15));
  });
});

describe("parseCpuTicks unhappy path", () => {
  it("is none for an empty string, a line with no closing paren, or too few fields", () => {
    expect(ProcessUsage.parseCpuTicks("")).toEqual(Option.none());
    expect(ProcessUsage.parseCpuTicks("1 (node R 0 0")).toEqual(Option.none());
    expect(ProcessUsage.parseCpuTicks("1 (node) R 0")).toEqual(Option.none());
  });

  it("is none when the tick fields are not numbers", () => {
    expect(ProcessUsage.parseCpuTicks("1 (node) R 0 0 0 0 -1 0 0 0 0 0 xx 0")).toEqual(
      Option.none(),
    );
  });
});

describe("parseVmRssBytes happy path", () => {
  it("reads VmRSS kilobytes as bytes", () => {
    expect(ProcessUsage.parseVmRssBytes(status(12345))).toEqual(Option.some(12_345 * 1024));
  });
});

describe("parseVmRssBytes unhappy path", () => {
  it("is none when VmRSS is missing or not a number", () => {
    expect(ProcessUsage.parseVmRssBytes("Name:\tnode\n")).toEqual(Option.none());
    expect(ProcessUsage.parseVmRssBytes("VmRSS:\t    xx kB\n")).toEqual(Option.none());
  });
});

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
      const { usage } = yield* build(
        scripted([{ cpuTicks: 10, memoryBytes: 4_096_000 }]).source,
      );
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

describe("ProcessUsage.layer happy path", () => {
  it.effect("reads /proc/self/stat and /proc/self/status without sudo", () => {
    const fs = procFs(stat("node", 0, 0), status(4));
    return Effect.gen(function* () {
      const usage = yield* ProcessUsage.ProcessUsage;
      expect(yield* usage.collect).toEqual({ memoryBytes: 4 * 1024, cpuPercent: 0 });
      expect(FakeFs.methods(fs)).toEqual(["readFileString", "readFileString"]);
    }).pipe(Effect.provide(ProcessUsage.ProcessUsage.layer.pipe(Layer.provide(fs.layer))));
  });
});

describe("ProcessUsage.layer unhappy path", () => {
  it.effect("dies when /proc/self/stat is missing", () =>
    Effect.gen(function* () {
      const usage = yield* ProcessUsage.ProcessUsage;
      const exit = yield* Effect.exit(usage.collect);
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    }).pipe(
      Effect.provide(
        ProcessUsage.ProcessUsage.layer.pipe(Layer.provide(procFs(undefined, status(1)).layer)),
      ),
    ),
  );

  it.effect("dies when the status text has no VmRSS", () =>
    Effect.gen(function* () {
      const usage = yield* ProcessUsage.ProcessUsage;
      const exit = yield* Effect.exit(usage.collect);
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    }).pipe(
      Effect.provide(
        ProcessUsage.ProcessUsage.layer.pipe(
          Layer.provide(procFs(stat("node", 0, 0), "Name:\tnode\n").layer),
        ),
      ),
    ),
  );
});
