// Simple host stats for the proxy's GET /stats endpoint: how many qemu
// sessions this proxy is running (the sessions map is the source of truth),
// how much memory the host has, and cpu utilization over the last 5 minutes.
//
// A timer started with the server samples cpu utilization (the busy share of
// cpu time between ticks) every 5 seconds into a rolling 5 minute window;
// /stats reports the mean and the p10/p25/p75/p90 percentiles of that window.
// Until the first tick lands the cpu numbers are null.

import os from "node:os";

const SAMPLE_INTERVAL_MS = 5_000;
const WINDOW_MS = 5 * 60 * 1000;
const MAX_SAMPLES = Math.ceil(WINDOW_MS / SAMPLE_INTERVAL_MS);

type CpuTimes = {
  idleMs: number;
  totalMs: number;
};

export type CpuSampler = {
  prev: CpuTimes;
  /** Utilization percents, oldest first, capped to the 5 minute window. */
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

/** Starts the utilization timer; it never keeps the process alive (unref). */
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
  const next = cpuTimes();
  const totalDelta = next.totalMs - sampler.prev.totalMs;
  if (totalDelta > 0) {
    const busyDelta = totalDelta - (next.idleMs - sampler.prev.idleMs);
    sampler.samples.push(Math.min(100, Math.max(0, (busyDelta / totalDelta) * 100)));
    if (sampler.samples.length > MAX_SAMPLES) {
      sampler.samples.shift();
    }
  }
  sampler.prev = next;
}

function cpuTimes(): CpuTimes {
  let idleMs = 0;
  let totalMs = 0;
  for (const cpu of os.cpus()) {
    const times = cpu.times;
    idleMs += times.idle;
    totalMs += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idleMs, totalMs };
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

/** Linear-interpolated percentile of an ascending-sorted, non-empty-or-null array. */
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
