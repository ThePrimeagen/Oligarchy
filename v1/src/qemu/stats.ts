import os from "node:os";
import { capture } from "../sentry.ts";

const SAMPLE_INTERVAL_MS = 5_000;
const MAX_SAMPLES = 60; // 60 samples x 5s ticks = a 5 minute window

type CpuTimes = {
  cores: number;
  idleMs: number;
  totalMs: number;
};

export type CpuSampler = {
  prev: CpuTimes;
  samples: number[];
};

export type Stats = {
  qemus: number;
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
  };
  cpu: {
    cores: number;
    mean: number;
    p10: number;
    p25: number;
    p75: number;
    p90: number;
  };
};

export function startCpuSampler(): CpuSampler {
  const sampler: CpuSampler = { prev: cpuTimes(), samples: [] };
  setInterval(() => sampleCpu(sampler), SAMPLE_INTERVAL_MS).unref();
  return sampler;
}

export function collectStats(sampler: CpuSampler, qemus: number): Stats {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const sorted = [...sampler.samples].sort((a, b) => a - b);

  return {
    qemus,
    memory: {
      totalBytes,
      usedBytes: totalBytes - freeBytes,
      freeBytes,
    },
    cpu: {
      cores: os.cpus().length,
      mean: mean(sorted),
      p10: percentile(sorted, 10),
      p25: percentile(sorted, 25),
      p75: percentile(sorted, 75),
      p90: percentile(sorted, 90),
    },
  };
}

function sampleCpu(sampler: CpuSampler): void {
  try {
    const next = cpuTimes();
    const prev = sampler.prev;
    sampler.prev = next;

    const totalDelta = next.totalMs - prev.totalMs;
    if (next.cores !== prev.cores || totalDelta <= 0) {
      // os.cpus() can return no data, and cpu hotplug makes aggregate
      // snapshots incomparable.
      return;
    }

    const busyDelta = totalDelta - (next.idleMs - prev.idleMs);
    sampler.samples.push((busyDelta / totalDelta) * 100);
    if (sampler.samples.length > MAX_SAMPLES) {
      sampler.samples.shift();
    }
  } catch (error) {
    // An uncaught throw in a timer callback would take down the whole proxy.
    console.error("failed to sample cpu usage:", error);
    capture({ text: "failed to sample cpu usage", level: "error", cause: error });
  }
}

function cpuTimes(): CpuTimes {
  const cpus = os.cpus();
  let idleMs = 0;
  let totalMs = 0;
  for (const cpu of cpus) {
    const times = cpu.times;
    idleMs += times.idle;
    totalMs += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { cores: cpus.length, idleMs, totalMs };
}

function mean(samples: number[]): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of samples) {
    sum += sample;
  }
  return round1(sum / samples.length);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return round1(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
