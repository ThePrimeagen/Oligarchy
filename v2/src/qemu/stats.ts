import { cpus, freemem, totalmem } from "node:os";
import { Context, Effect, Layer } from "effect";
import type { Scope } from "effect";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Contract from "../shared/contract.ts";

export const SAMPLE_INTERVAL_MS = 5_000;
// 60 samples x 5s ticks = a 5 minute window.
export const MAX_SAMPLES = 60;

export type CpuTimes = {
  readonly cores: number;
  readonly idleMs: number;
  readonly totalMs: number;
};

export type Memory = {
  readonly totalBytes: number;
  readonly freeBytes: number;
};

// The host readings behind the sampler; tests script them.
export type Source = {
  readonly cpuTimes: () => CpuTimes;
  readonly cores: () => number;
  readonly memory: () => Memory;
};

export const osSource: Source = {
  cpuTimes: () => {
    const all = cpus();
    let idleMs = 0;
    let totalMs = 0;
    for (const cpu of all) {
      const times = cpu.times;
      idleMs += times.idle;
      totalMs += times.user + times.nice + times.sys + times.idle + times.irq;
    }
    return { cores: all.length, idleMs, totalMs };
  },
  cores: () => cpus().length,
  memory: () => ({ totalBytes: totalmem(), freeBytes: freemem() }),
};

export type StatsService = {
  readonly collect: (qemus: number) => Effect.Effect<Contract.Stats>;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

const mean = (sorted: ReadonlyArray<number>): number => {
  if (sorted.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of sorted) {
    sum += sample;
  }
  return round1(sum / sorted.length);
};

const percentile = (sorted: ReadonlyArray<number>, p: number): number => {
  if (sorted.length === 0) {
    return 0;
  }
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return round1((sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight);
};

const make = (source: Source): Effect.Effect<StatsService, never, Scope.Scope | Log.Log> =>
  Effect.gen(function* () {
    const log = yield* Log.Log;
    let previous = source.cpuTimes();
    const samples: Array<number> = [];

    const record = (next: CpuTimes): void => {
      const before = previous;
      previous = next;
      const totalDelta = next.totalMs - before.totalMs;
      // os.cpus() can return no data, and cpu hotplug makes aggregate snapshots incomparable.
      if (next.cores !== before.cores || totalDelta <= 0) {
        return;
      }
      const busyDelta = totalDelta - (next.idleMs - before.idleMs);
      samples.push((busyDelta / totalDelta) * 100);
      if (samples.length > MAX_SAMPLES) {
        samples.shift();
      }
    };
    // A throwing reading is a defect of the host, not an expected failure; it is logged and the
    // next tick still runs, so one bad reading never takes the sampler down.
    const sample = Effect.sync(() => {
      record(source.cpuTimes());
    }).pipe(
      Effect.catchDefect((cause) =>
        log.error(`failed to sample cpu usage: ${Render.errorDetail(cause)}`, { cause }),
      ),
    );
    yield* Effect.forkScoped(
      Effect.forever(Effect.sleep(SAMPLE_INTERVAL_MS).pipe(Effect.andThen(sample))),
      { startImmediately: true },
    );

    const collect = Effect.fn("Stats.collect")(function* (qemus: number) {
      return yield* Effect.sync(() => {
        const memory = source.memory();
        const sorted = [...samples].sort((left, right) => left - right);
        return Contract.Stats.make({
          qemus,
          memory: Contract.Memory.make({
            totalBytes: memory.totalBytes,
            usedBytes: memory.totalBytes - memory.freeBytes,
            freeBytes: memory.freeBytes,
          }),
          cpu: Contract.Cpu.make({
            cores: source.cores(),
            mean: mean(sorted),
            p10: percentile(sorted, 10),
            p25: percentile(sorted, 25),
            p75: percentile(sorted, 75),
            p90: percentile(sorted, 90),
          }),
        });
      });
    });

    return { collect } satisfies StatsService;
  });

export class Stats extends Context.Service<Stats>()("@oligarchy/qemu/Stats", { make }) {
  // The sampler fiber belongs to this layer's scope: it never keeps the process alive on its own.
  static readonly layer: Layer.Layer<Stats, never, Log.Log> = Layer.effect(this)(
    this.make(osSource),
  );
}
