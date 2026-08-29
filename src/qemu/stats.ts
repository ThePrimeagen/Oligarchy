// Host stats for the proxy's GET /stats endpoint.
//
// The proxy may run on an Arch/Omarchy workstation or inside a plain cloud VM,
// so every source here is best-effort: /etc/os-release (with the spec fallback
// /usr/lib/os-release), /proc/meminfo, and /dev/kvm are read when present, and
// anything unavailable degrades to the node:os equivalents or null instead of
// failing the request.
//
// CPU utilization is the busy share of cpu time since the previous collect
// (the baseline is sampled when the collector is created), like top does.

import { access, readFile } from "node:fs/promises";
import os from "node:os";

const OS_RELEASE_PATHS = ["/etc/os-release", "/usr/lib/os-release"];
const MEMINFO_PATH = "/proc/meminfo";
const KVM_PATH = "/dev/kvm";

export type CpuTimes = {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
};

export type CpuSample = {
  idleMs: number;
  totalMs: number;
};

export type SessionStat = {
  id: string;
  pid: number | null;
};

export type StatsDeps = {
  readFile: (path: string) => Promise<string>;
  access: (path: string) => Promise<void>;
  cpus: () => { model: string; times: CpuTimes }[];
  totalmem: () => number;
  freemem: () => number;
  loadavg: () => number[];
  uptime: () => number;
  hostname: () => string;
  platform: () => string;
  arch: () => string;
  release: () => string;
  now: () => Date;
};

export type StatsCollector = {
  readonly deps: StatsDeps;
  prevCpu: CpuSample | null;
};

export type Distro = {
  id: string | null;
  name: string | null;
  prettyName: string | null;
  idLike: string | null;
};

export type Stats = {
  generatedAt: string;
  sessions: {
    count: number;
    instances: SessionStat[];
  };
  host: {
    hostname: string;
    platform: string;
    arch: string;
    kernel: string;
    uptimeSeconds: number;
    distro: Distro | null;
  };
  cpu: {
    count: number;
    model: string | null;
    loadAverage: number[];
    utilizationPercent: number | null;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    availableBytes: number | null;
    usedBytes: number;
    usedPercent: number;
    swapTotalBytes: number | null;
    swapFreeBytes: number | null;
  };
  kvm: {
    available: boolean;
  };
};

const defaultDeps: StatsDeps = {
  readFile: (path) => readFile(path, "utf8"),
  access: (path) => access(path),
  cpus: () => os.cpus(),
  totalmem: () => os.totalmem(),
  freemem: () => os.freemem(),
  loadavg: () => os.loadavg(),
  uptime: () => os.uptime(),
  hostname: () => os.hostname(),
  platform: () => os.platform(),
  arch: () => os.arch(),
  release: () => os.release(),
  now: () => new Date(),
};

export function createStatsCollector(overrides: Partial<StatsDeps> = {}): StatsCollector {
  const deps = { ...defaultDeps, ...overrides };
  return { deps, prevCpu: sampleCpuTimes(deps.cpus()) };
}

export async function collectStats(
  collector: StatsCollector,
  sessions: SessionStat[],
): Promise<Stats> {
  const deps = collector.deps;
  const [distro, meminfo, kvmAvailable] = await Promise.all([
    readDistro(deps),
    readMeminfo(deps),
    deps.access(KVM_PATH).then(
      () => true,
      () => false,
    ),
  ]);

  const cpuList = deps.cpus();
  const sample = sampleCpuTimes(cpuList);
  const utilizationPercent = cpuUtilizationPercent(collector.prevCpu, sample);
  collector.prevCpu = sample;

  const totalBytes = meminfo.MemTotal ?? deps.totalmem();
  const freeBytes = meminfo.MemFree ?? deps.freemem();
  const availableBytes = meminfo.MemAvailable ?? null;
  const usedBytes = Math.max(0, totalBytes - (availableBytes ?? freeBytes));

  return {
    generatedAt: deps.now().toISOString(),
    sessions: { count: sessions.length, instances: sessions },
    host: {
      hostname: deps.hostname(),
      platform: deps.platform(),
      arch: deps.arch(),
      kernel: deps.release(),
      uptimeSeconds: Math.floor(deps.uptime()),
      distro,
    },
    cpu: {
      count: cpuList.length,
      model: cpuList[0]?.model ?? null,
      loadAverage: deps.loadavg(),
      utilizationPercent,
    },
    memory: {
      totalBytes,
      freeBytes,
      availableBytes,
      usedBytes,
      usedPercent: totalBytes > 0 ? round1((usedBytes / totalBytes) * 100) : 0,
      swapTotalBytes: meminfo.SwapTotal ?? null,
      swapFreeBytes: meminfo.SwapFree ?? null,
    },
    kvm: { available: kvmAvailable },
  };
}

/**
 * Parses os-release(5) content into a key/value record. Comments, blank
 * lines, and anything that is not KEY=value are skipped; quoted values are
 * unquoted (double quotes also unescape).
 */
export function parseOsRelease(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    out[match[1]] = unquote(match[2]);
  }
  return out;
}

/**
 * Parses /proc/meminfo content into a record of byte counts. "kB" fields are
 * converted to bytes; unitless fields (e.g. HugePages_Total) stay as counts.
 */
export function parseMeminfo(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const raw of text.split("\n")) {
    const match = /^([^\s:]+):\s*(\d+)(\s*kB)?$/.exec(raw.trim());
    if (match === null) {
      continue;
    }
    const value = Number(match[2]);
    out[match[1]] = match[3] === undefined ? value : value * 1024;
  }
  return out;
}

/** Aggregates per-core cpu times into one idle/total sample. */
export function sampleCpuTimes(cpus: { times: CpuTimes }[]): CpuSample {
  let idleMs = 0;
  let totalMs = 0;
  for (const cpu of cpus) {
    const times = cpu.times;
    idleMs += times.idle;
    totalMs += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idleMs, totalMs };
}

/**
 * Busy percentage between two samples, clamped to 0..100 and rounded to one
 * decimal. Returns null without a baseline or when no cpu time has passed.
 */
export function cpuUtilizationPercent(prev: CpuSample | null, next: CpuSample): number | null {
  if (prev === null) {
    return null;
  }
  const totalDelta = next.totalMs - prev.totalMs;
  if (totalDelta <= 0) {
    return null;
  }
  const busyDelta = totalDelta - (next.idleMs - prev.idleMs);
  return round1(Math.min(100, Math.max(0, (busyDelta / totalDelta) * 100)));
}

async function readDistro(deps: StatsDeps): Promise<Distro | null> {
  for (const path of OS_RELEASE_PATHS) {
    let text: string;
    try {
      text = await deps.readFile(path);
    } catch {
      continue;
    }
    const record = parseOsRelease(text);
    if (Object.keys(record).length === 0) {
      continue;
    }
    return {
      id: record.ID ?? null,
      name: record.NAME ?? null,
      prettyName: record.PRETTY_NAME ?? null,
      idLike: record.ID_LIKE ?? null,
    };
  }
  return null;
}

async function readMeminfo(deps: StatsDeps): Promise<Record<string, number>> {
  try {
    return parseMeminfo(await deps.readFile(MEMINFO_PATH));
  } catch {
    return {};
  }
}

function unquote(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
    const inner = value.slice(1, -1);
    return quote === '"' ? inner.replace(/\\(.)/g, "$1") : inner;
  }
  return value;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
