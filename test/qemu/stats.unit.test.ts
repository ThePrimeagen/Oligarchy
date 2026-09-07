import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as Stats from "../../src/qemu/stats.ts";
import * as FakeLog from "../support/log.ts";

type Scripted = {
  readonly source: Stats.Source;
  readonly calls: () => number;
};

// Serves the snapshots in order; the first one is taken when the layer is built.
const scripted = (
  snapshots: ReadonlyArray<Stats.CpuTimes | Error>,
  memory: Stats.Memory = { totalBytes: 16_000, freeBytes: 6_000 },
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

const snapshot = (cores: number, idleMs: number, totalMs: number): Stats.CpuTimes => ({
  cores,
  idleMs,
  totalMs,
});

const build = (source: Stats.Source, log = FakeLog.fakeLog()) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.build(
      Layer.effect(Stats.Stats)(Stats.Stats.make(source)).pipe(Layer.provide(log.layer)),
    ).pipe(Scope.provide(scope));
    return { stats: Context.get(context, Stats.Stats), scope, log };
  });

describe("Stats happy path", () => {
  it.effect("reports zeros before the first sample and the memory split", () =>
    Effect.gen(function* () {
      const { stats } = yield* build(scripted([snapshot(4, 0, 0)]).source);
      expect(yield* stats.collect(3)).toEqual({
        qemus: 3,
        memory: { totalBytes: 16_000, usedBytes: 10_000, freeBytes: 6_000 },
        cpu: { cores: 4, mean: 0, p10: 0, p25: 0, p75: 0, p90: 0 },
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
      const { stats } = yield* build(source);
      yield* TestClock.adjust(Stats.SAMPLE_INTERVAL_MS - 1);
      expect(calls()).toBe(1);
      yield* TestClock.adjust(1);
      expect(calls()).toBe(2);
      expect((yield* stats.collect(0)).cpu).toEqual({
        cores: 4,
        mean: 50,
        p10: 50,
        p25: 50,
        p75: 50,
        p90: 50,
      });
      yield* TestClock.adjust(Stats.SAMPLE_INTERVAL_MS);
      expect((yield* stats.collect(0)).cpu).toEqual({
        cores: 4,
        mean: 70,
        p10: 54,
        p25: 60,
        p75: 80,
        p90: 86,
      });
    }),
  );

  it.effect("keeps a window of 60 samples", () =>
    Effect.gen(function* () {
      // Sample i is exactly i% busy: 100 ms of cpu time per tick, i of them not idle.
      const snapshots: Array<Stats.CpuTimes> = [snapshot(1, 0, 0)];
      let idle = 0;
      for (let i = 1; i <= Stats.MAX_SAMPLES + 1; i++) {
        idle += 100 - i;
        snapshots.push(snapshot(1, idle, 100 * i));
      }
      const { stats } = yield* build(scripted(snapshots).source);
      yield* TestClock.adjust(Stats.SAMPLE_INTERVAL_MS * (Stats.MAX_SAMPLES + 1));
      const { cpu } = yield* stats.collect(0);
      // Samples 1..61 were taken; the window holds 2..61.
      expect(cpu.mean).toBe(31.5);
      expect(cpu.p10).toBe(7.9);
      expect(cpu.p90).toBe(55.1);
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
      const { stats } = yield* build(source);
      yield* TestClock.adjust(Stats.SAMPLE_INTERVAL_MS * 3);
      expect((yield* stats.collect(0)).cpu.mean).toBe(90);
    }),
  );

  it.effect("stops sampling when the layer's scope closes", () =>
    Effect.gen(function* () {
      const { source, calls } = scripted([snapshot(1, 0, 0), snapshot(1, 5, 10)]);
      const { scope } = yield* build(source);
      yield* TestClock.adjust(Stats.SAMPLE_INTERVAL_MS);
      expect(calls()).toBe(2);
      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust(Stats.SAMPLE_INTERVAL_MS * 3);
      expect(calls()).toBe(2);
    }),
  );
});

describe("Stats unhappy path", () => {
  it.effect("logs a throwing source with its detail and keeps ticking", () =>
    Effect.gen(function* () {
      const boom = new Error("cpus unavailable");
      const { source } = scripted([snapshot(2, 0, 0), boom, snapshot(2, 50, 100)]);
      const { stats, log } = yield* build(source);
      yield* TestClock.adjust(Stats.SAMPLE_INTERVAL_MS);
      expect(log.lines).toMatchObject([
        { level: "error", text: "failed to sample cpu usage: cpus unavailable", cause: boom },
      ]);
      expect((yield* stats.collect(0)).cpu.mean).toBe(0);
      yield* TestClock.adjust(Stats.SAMPLE_INTERVAL_MS);
      expect((yield* stats.collect(0)).cpu.mean).toBe(50);
      expect(log.lines).toHaveLength(1);
    }),
  );

  it.effect("logs a non-Error throw with String(value)", () =>
    Effect.gen(function* () {
      let first = true;
      const source: Stats.Source = {
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
      yield* TestClock.adjust(Stats.SAMPLE_INTERVAL_MS);
      expect(log.lines.map((line) => line.text)).toEqual(["failed to sample cpu usage: no cpus"]);
    }),
  );
});
