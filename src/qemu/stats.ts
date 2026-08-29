// Host stats for the proxy's GET /stats endpoint: what the machine the proxy
// runs on can tell us, not the guests. Memory, cpu, distro, kvm, and how many
// oligarchy proxies and qemu processes are running on the box.
//
// The proxy may sit on an Arch/Omarchy workstation or inside a plain cloud
// VM, so every source is best-effort: /etc/os-release (with the spec fallback
// /usr/lib/os-release), /proc/meminfo, the /proc process table, and /dev/kvm
// degrade to the node:os equivalents or null instead of failing the request.
//
// CPU utilization is the busy share of cpu time since the previous collect
// (the baseline is sampled when the collector is created), like top does.

import { access, readdir, readFile } from "node:fs/promises";
import os from "node:os";

const OS_RELEASE_PATHS = ["/etc/os-release", "/usr/lib/os-release"];
const MEMINFO_PATH = "/proc/meminfo";
const KVM_PATH = "/dev/kvm";
const QEMU_PROCESS_PREFIX = "qemu-system";
const PROXY_SCRIPT = "proxy.ts";

type CpuSample = {
  idleMs: number;
  totalMs: number;
};

export type StatsCollector = {
  prevCpu: CpuSample;
};

export type Stats = {
  generatedAt: string;
  processes: {
    proxies: number;
    qemus: number;
  } | null;
  host: {
    hostname: string;
    platform: string;
    arch: string;
    kernel: string;
    uptimeSeconds: number;
    distro: {
      id: string | null;
      name: string | null;
      prettyName: string | null;
      idLike: string | null;
    } | null;
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

export function createStatsCollector(): StatsCollector {
  return { prevCpu: sampleCpuTimes(os.cpus()) };
}

export async function collectStats(collector: StatsCollector): Promise<Stats> {
  const [distro, meminfo, processes, kvmAvailable] = await Promise.all([
    readDistro(),
    readMeminfo(),
    countProcesses(),
    access(KVM_PATH).then(
      () => true,
      () => false,
    ),
  ]);

  const cpuList = os.cpus();
  const sample = sampleCpuTimes(cpuList);
  const utilizationPercent = cpuUtilizationPercent(collector.prevCpu, sample);
  collector.prevCpu = sample;

  const totalBytes = meminfo.MemTotal ?? os.totalmem();
  const freeBytes = meminfo.MemFree ?? os.freemem();
  const availableBytes = meminfo.MemAvailable ?? null;
  const usedBytes = Math.max(0, totalBytes - (availableBytes ?? freeBytes));

  return {
    generatedAt: new Date().toISOString(),
    processes,
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      kernel: os.release(),
      uptimeSeconds: Math.floor(os.uptime()),
      distro,
    },
    cpu: {
      count: cpuList.length,
      model: cpuList[0]?.model ?? null,
      loadAverage: os.loadavg(),
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
 * Counts oligarchy proxies and qemu guests in the host process table, this
 * proxy included. A proxy is any process running proxy.ts; a qemu is any
 * qemu-system-* binary. Returns null when /proc is unavailable (non-Linux).
 */
async function countProcesses(): Promise<{ proxies: number; qemus: number } | null> {
  let entries: string[];
  try {
    entries = await readdir("/proc");
  } catch {
    return null;
  }

  let proxies = 0;
  let qemus = 0;
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    let cmdline: string;
    try {
      cmdline = await readFile(`/proc/${entry}/cmdline`, "utf8");
    } catch {
      continue; // the process exited mid-scan
    }
    const argv = cmdline.split("\0").filter((arg) => arg !== "");
    if (argv.length === 0) {
      continue; // kernel thread
    }
    const bin = argv[0].split("/").pop() ?? argv[0];
    if (bin.startsWith(QEMU_PROCESS_PREFIX)) {
      qemus += 1;
    } else if (argv.some((arg) => arg === PROXY_SCRIPT || arg.endsWith(`/${PROXY_SCRIPT}`))) {
      proxies += 1;
    }
  }
  return { proxies, qemus };
}

async function readDistro(): Promise<Stats["host"]["distro"]> {
  for (const path of OS_RELEASE_PATHS) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
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

async function readMeminfo(): Promise<Record<string, number>> {
  try {
    return parseMeminfo(await readFile(MEMINFO_PATH, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Parses os-release(5) content into a key/value record. Comments, blank
 * lines, and anything that is not KEY=value are skipped; quoted values are
 * unquoted (double quotes also unescape).
 */
function parseOsRelease(text: string): Record<string, string> {
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
function parseMeminfo(text: string): Record<string, number> {
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
function sampleCpuTimes(cpus: os.CpuInfo[]): CpuSample {
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
 * decimal. Returns null when no cpu time has passed.
 */
function cpuUtilizationPercent(prev: CpuSample, next: CpuSample): number | null {
  const totalDelta = next.totalMs - prev.totalMs;
  if (totalDelta <= 0) {
    return null;
  }
  const busyDelta = totalDelta - (next.idleMs - prev.idleMs);
  return round1(Math.min(100, Math.max(0, (busyDelta / totalDelta) * 100)));
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
