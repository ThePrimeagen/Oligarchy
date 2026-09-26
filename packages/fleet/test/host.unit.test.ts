import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as Log from "@oligarchy/log/log";
import * as Host from "../src/host.ts";

type Line = { readonly level: string; readonly text: string; readonly cause: unknown };

// A Log that keeps every line instead of writing it.
const recordingLog = () => {
  const lines: Array<Line> = [];
  const record =
    (level: string) =>
    (text: string, report?: Log.Report): Effect.Effect<void> =>
      Effect.sync(() => {
        lines.push({ level, text, cause: report?.cause });
      });
  return {
    lines,
    layer: Layer.succeed(Log.Log)(
      Log.Log.of({
        info: record("info"),
        warning: record("warning"),
        error: record("error"),
        fatal: record("fatal"),
        flush: Effect.void,
      }),
    ),
  };
};

type Scripted = {
  readonly source: Host.Source;
  readonly calls: () => number;
};

// Serves the snapshots in order; the first one is taken when the layer is built.
const scripted = (
  snapshots: ReadonlyArray<Host.CpuTimes | Error>,
  memory: Host.MemoryReading = { totalBytes: 16_000, freeBytes: 6_000 },
): Scripted => {
  let index = 0;
  return {
    source: {
      cpuTimes: () => {
        const next = snapshots[Math.min(index, snapshots.length - 1)];
        index += 1;
        if (next instanceof Error) {
          throw next;
        }
        return next ?? { cores: 0, idleMs: 0, totalMs: 0 };
      },
      cores: () => 4,
      memory: () => memory,
    },
    calls: () => index,
  };
};

const snapshot = (cores: number, idleMs: number, totalMs: number): Host.CpuTimes => ({
  cores,
  idleMs,
  totalMs,
});

const build = (source: Host.Source, log = recordingLog()) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.build(
      Layer.effect(Host.Host)(Host.Host.make(source)).pipe(Layer.provide(log.layer)),
    ).pipe(Scope.provide(scope));
    return { host: Context.get(context, Host.Host), scope, log };
  });

describe("Host happy path", () => {
  it.effect("reports zeros before the first sample and the memory split, and no qemu count", () =>
    Effect.gen(function* () {
      const { host } = yield* build(scripted([snapshot(4, 0, 0)]).source);
      expect(yield* host.collect).toStrictEqual({
        memory: { totalBytes: 16_000, usedBytes: 10_000, freeBytes: 6_000 },
        cpu: {
          cores: 4,
          mean: 0,
          mean1m: 0,
          mean2m: 0,
          mean3m: 0,
          p10: 0,
          p25: 0,
          p75: 0,
          p90: 0,
        },
      });
    }),
  );

  it.effect("samples every 5 seconds and reports mean and percentiles rounded to one decimal", () =>
    Effect.gen(function* () {
      const { source, calls } = scripted([
        snapshot(2, 0, 0),
        snapshot(2, 50, 100),
        snapshot(2, 60, 200),
      ]);
      const { host } = yield* build(source);
      yield* TestClock.adjust(Host.SAMPLE_INTERVAL_MS - 1);
      expect(calls()).toBe(1);
      yield* TestClock.adjust(1);
      expect(calls()).toBe(2);
      expect((yield* host.collect).cpu).toEqual({
        cores: 4,
        mean: 50,
        mean1m: 50,
        mean2m: 50,
        mean3m: 50,
        p10: 50,
        p25: 50,
        p75: 50,
        p90: 50,
      });
      yield* TestClock.adjust(Host.SAMPLE_INTERVAL_MS);
      expect((yield* host.collect).cpu).toEqual({
        cores: 4,
        mean: 70,
        mean1m: 70,
        mean2m: 70,
        mean3m: 70,
        p10: 54,
        p25: 60,
        p75: 80,
        p90: 86,
      });
    }),
  );

  it.effect("a clean tick logs nothing", () =>
    Effect.gen(function* () {
      const { log } = yield* build(scripted([snapshot(1, 0, 0), snapshot(1, 5, 10)]).source);
      yield* TestClock.adjust(Host.SAMPLE_INTERVAL_MS * 3);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("keeps a window of 60 samples", () =>
    Effect.gen(function* () {
      // Sample i is exactly i% busy: 100 ms of cpu time per tick, i of them not idle.
      const snapshots: Array<Host.CpuTimes> = [snapshot(1, 0, 0)];
      let idle = 0;
      for (let i = 1; i <= Host.MAX_SAMPLES + 1; i++) {
        idle += 100 - i;
        snapshots.push(snapshot(1, idle, 100 * i));
      }
      const { host } = yield* build(scripted(snapshots).source);
      yield* TestClock.adjust(Host.SAMPLE_INTERVAL_MS * (Host.MAX_SAMPLES + 1));
      const { cpu } = yield* host.collect;
      // Samples 1..61 were taken; the window holds 2..61.
      expect(cpu.mean).toBe(31.5);
      expect(cpu.p10).toBe(7.9);
      expect(cpu.p90).toBe(55.1);
    }),
  );

  it.effect("the one, two and three minute means read the newest 12, 24 and 36 samples", () =>
    Effect.gen(function* () {
      // Sample i is exactly i% busy, as above: the newest 12 are 50..61, the newest 24 38..61,
      // the newest 36 26..61, while the whole window is 2..61.
      const snapshots: Array<Host.CpuTimes> = [snapshot(1, 0, 0)];
      let idle = 0;
      for (let i = 1; i <= Host.MAX_SAMPLES + 1; i++) {
        idle += 100 - i;
        snapshots.push(snapshot(1, idle, 100 * i));
      }
      const { host } = yield* build(scripted(snapshots).source);
      yield* TestClock.adjust(Host.SAMPLE_INTERVAL_MS * (Host.MAX_SAMPLES + 1));
      const { cpu } = yield* host.collect;
      expect(cpu.mean).toBe(31.5);
      expect(cpu.mean1m).toBe(55.5);
      expect(cpu.mean2m).toBe(49.5);
      expect(cpu.mean3m).toBe(43.5);
    }),
  );

  it.effect("a mean whose minute is not yet full averages the samples there are", () =>
    Effect.gen(function* () {
      // Three samples: 10%, 20% and 60% busy. Every mean sees the same three.
      const { host } = yield* build(
        scripted([
          snapshot(1, 0, 0),
          snapshot(1, 90, 100),
          snapshot(1, 170, 200),
          snapshot(1, 210, 300),
        ]).source,
      );
      yield* TestClock.adjust(Host.SAMPLE_INTERVAL_MS * 3);
      const { cpu } = yield* host.collect;
      expect(cpu.mean).toBe(30);
      expect(cpu.mean1m).toBe(30);
      expect(cpu.mean2m).toBe(30);
      expect(cpu.mean3m).toBe(30);
    }),
  );

  it.effect("skips a sample when the core count changes or no cpu time passed", () =>
    Effect.gen(function* () {
      const { source } = scripted([
        snapshot(2, 0, 0),
        snapshot(4, 10, 100),
        snapshot(4, 10, 100),
        snapshot(4, 20, 200),
      ]);
      const { host } = yield* build(source);
      yield* TestClock.adjust(Host.SAMPLE_INTERVAL_MS * 3);
      expect((yield* host.collect).cpu.mean).toBe(90);
    }),
  );

  it.effect("stops sampling when the layer's scope closes", () =>
    Effect.gen(function* () {
      const { source, calls } = scripted([snapshot(1, 0, 0), snapshot(1, 5, 10)]);
      const { scope } = yield* build(source);
      yield* TestClock.adjust(Host.SAMPLE_INTERVAL_MS);
      expect(calls()).toBe(2);
      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust(Host.SAMPLE_INTERVAL_MS * 3);
      expect(calls()).toBe(2);
    }),
  );
});

describe("Host unhappy path", () => {
  it.effect(
    "a throwing reading is one line with the thrown value as its cause, and the next tick samples against the last good reading",
    () =>
      Effect.gen(function* () {
        const boom = new Error("cpus unavailable");
        const { source } = scripted([snapshot(2, 0, 0), boom, snapshot(2, 50, 100)]);
        const { host, log } = yield* build(source);
        yield* TestClock.adjust(Host.SAMPLE_INTERVAL_MS);
        expect(log.lines).toEqual([
          { level: "error", text: "failed to sample cpu usage: cpus unavailable", cause: boom },
        ]);
        expect((yield* host.collect).cpu.mean).toBe(0);
        // 50 of 100 ms busy since the first reading: the throw did not become the baseline.
        yield* TestClock.adjust(Host.SAMPLE_INTERVAL_MS);
        expect((yield* host.collect).cpu.mean).toBe(50);
        expect(log.lines).toHaveLength(1);
      }),
  );

  it.effect("logs a non-Error throw with String(value)", () =>
    Effect.gen(function* () {
      let first = true;
      const source: Host.Source = {
        cpuTimes: () => {
          if (first) {
            first = false;
            return snapshot(1, 0, 0);
          }
          throw "no cpus";
        },
        cores: () => 1,
        memory: () => ({ totalBytes: 1, freeBytes: 1 }),
      };
      const { log } = yield* build(source);
      yield* TestClock.adjust(Host.SAMPLE_INTERVAL_MS);
      expect(log.lines).toEqual([
        { level: "error", text: "failed to sample cpu usage: no cpus", cause: "no cpus" },
      ]);
    }),
  );
});
