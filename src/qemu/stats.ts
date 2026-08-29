// Host stats for the proxy's GET /stats endpoint: how many qemu sessions the
// proxy is running, how much memory the host has, and cpu utilization over
// the last five minutes.
//
// A timer started with the server samples the busy share of cpu time every
// tick into a rolling window; /stats reports the window's mean and
// p10/p25/p75/p90 percentiles. The cpu fields are null until the first tick.

import os from "node:os";

const SAMPLE_INTERVAL_MS = 5_000;
const MAX_SAMPLES = 60; // 60 samples x 5s ticks = a 5 minute window

type CpuTimes = {
  cores: number;
  idleMs: number;
  totalMs: number;
};

export type CpuSampler = {
  prev: CpuTimes;
  /** Utilization percents, oldest first. */
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
    mean: number | null;
    p10: number | null;
    p25: number | null;
    p75: number | null;
    p90: number | null;
  };
};

/** Starts the sampling timer; unref keeps it from holding the process open. */
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

function mean(samples: number[]): number | null {
  if (samples.length === 0) {
    return null;
  }
  let sum = 0;
  for (const sample of samples) {
    sum += sample;
  }
  return round1(sum / samples.length);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
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
