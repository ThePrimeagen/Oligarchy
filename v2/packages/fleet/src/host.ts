import { cpus, freemem, totalmem } from "node:os";
import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import type * as Logger from "@oligarchy/logger";

export type CpuTimes = {
  readonly cores: number;
  readonly idleMs: number;
  readonly totalMs: number;
};

export type MemoryReading = {
  readonly totalBytes: number;
  readonly freeBytes: number;
};

// The host readings behind the sampler; tests script them.
export type Source = {
  readonly cpuTimes: () => CpuTimes;
  readonly cores: () => number;
  readonly memory: () => MemoryReading;
};

export type HostStats = {
  readonly memory: {
    readonly totalBytes: number;
    readonly usedBytes: number;
    readonly freeBytes: number;
  };
  readonly cpu: {
    readonly cores: number;
    readonly mean: number;
    readonly mean1m: number;
    readonly mean2m: number;
    readonly mean3m: number;
    readonly p10: number;
    readonly p25: number;
    readonly p75: number;
    readonly p90: number;
  };
};

export type Host = {
  readonly service: "host";
  readonly sample: () => void;
  readonly collect: () => HostStats;
};

declare module "@oligarchy/app" {
  interface Services {
    host: App.Register<"host", Host>;
  }
}

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

const round1 = (value: number): number => Math.round(value * 10) / 10;

const mean = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return round1(sum / values.length);
};

const percentile = (sorted: ReadonlyArray<number>, p: number): number => {
  if (sorted.length === 0) {
    return 0;
  }
  const index = (p / 100) * (sorted.length - 1);
  const lower = sorted[Math.floor(index)] ?? 0;
  const upper = sorted[Math.ceil(index)] ?? 0;
  const weight = index - Math.floor(index);
  return round1(lower * (1 - weight) + upper * weight);
};

const messageOf = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.message : String(thrown);

export type Options = {
  readonly source: Source;
  readonly attribution?: Logger.Attribution;
  readonly sampleInterval: number;
  readonly sampleLimit: number;
};

// Each sample is the cpu busy since the last reading. A reading that throws is one error line and
// is not the next one's baseline; a reading after a core count change, or with no cpu time
// passed, is not comparable to the last, so it only becomes the next one's baseline.
export const create = App.createService<Logger.Logger, Options, Host>(({ logger }, options) => {
  const { source, attribution, sampleInterval, sampleLimit } = options;
  const samplesPerMinute = 60_000 / sampleInterval;
  const samples: Array<number> = [];
  let previous: CpuTimes | undefined;

  const read = (): CpuTimes | undefined => {
    try {
      return source.cpuTimes();
    } catch (thrown) {
      logger.error(`failed to sample cpu usage: ${messageOf(thrown)}`, attribution);
      return undefined;
    }
  };

  previous = read();

  const sample = () => {
    const next = read();
    if (next === undefined) {
      return;
    }
    const before = previous;
    previous = next;
    if (before === undefined || next.cores !== before.cores) {
      return;
    }
    const totalDelta = next.totalMs - before.totalMs;
    if (totalDelta <= 0) {
      return;
    }
    const busyDelta = totalDelta - (next.idleMs - before.idleMs);
    samples.push((busyDelta / totalDelta) * 100);
    if (samples.length > sampleLimit) {
      samples.shift();
    }
  };

  const collect = (): HostStats => {
    const memory = source.memory();
    const sorted = [...samples].sort((left, right) => left - right);
    return {
      memory: {
        totalBytes: memory.totalBytes,
        usedBytes: memory.totalBytes - memory.freeBytes,
        freeBytes: memory.freeBytes,
      },
      cpu: {
        cores: source.cores(),
        mean: mean(sorted),
        // samples is oldest first, so the tail is the newest minutes.
        mean1m: mean(samples.slice(-Math.ceil(samplesPerMinute))),
        mean2m: mean(samples.slice(-Math.ceil(2 * samplesPerMinute))),
        mean3m: mean(samples.slice(-Math.ceil(3 * samplesPerMinute))),
        p10: percentile(sorted, 10),
        p25: percentile(sorted, 25),
        p75: percentile(sorted, 75),
        p90: percentile(sorted, 90),
      },
    };
  };

  return { service: "host", sample, collect };
});

// Samples at the configured interval until signal aborts.
export const sampling = (
  services: App.Needs<Host>,
  signal: AbortSignal,
  options: { readonly every: number },
): Promise<void> => Async.tick(() => services.host.sample(), options.every, signal);
