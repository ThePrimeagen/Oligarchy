import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectStats,
  cpuUtilizationPercent,
  createStatsCollector,
  parseMeminfo,
  parseOsRelease,
  sampleCpuTimes,
  type CpuTimes,
} from "./stats.ts";

const OMARCHY_OS_RELEASE = `# /etc/os-release for an Omarchy install

PRETTY_NAME="Omarchy"
NAME="Omarchy"
VARIANT="Omarchy \\"Tokyo Night\\" Edition"
VARIANT_ID='tokyo-night'
ID=omarchy
ID_LIKE=arch
BUILD_ID=rolling
ANSI_COLOR="38;2;133;76;199"
HOME_URL="https://omarchy.org"
`;

const ARCH_OS_RELEASE = `NAME="Arch Linux"
PRETTY_NAME="Arch Linux"
ID=arch
BUILD_ID=rolling
ANSI_COLOR="38;2;23;147;209"
HOME_URL="https://archlinux.org/"
`;

const UBUNTU_OS_RELEASE = `PRETTY_NAME="Ubuntu 24.04.4 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION="24.04.4 LTS (Noble Numbat)"
VERSION_CODENAME=noble
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
SUPPORT_URL="https://help.ubuntu.com/"
BUG_REPORT_URL="https://bugs.launchpad.net/ubuntu/"
PRIVACY_POLICY_URL="https://www.ubuntu.com/legal/terms-and-policies/privacy-policy"
UBUNTU_CODENAME=noble
LOGO=ubuntu-logo
`;

const OMARCHY_MEMINFO = `MemTotal:       16265916 kB
MemFree:         8355300 kB
MemAvailable:   12094096 kB
Buffers:          313328 kB
Cached:          3931920 kB
Active(anon):        264 kB
SwapTotal:       4194300 kB
SwapFree:        4194200 kB
HugePages_Total:       0
Hugepagesize:       2048 kB
`;

const NO_AVAILABLE_MEMINFO = `MemTotal:        8148028 kB
MemFree:         2148028 kB
Buffers:          313328 kB
`;

describe("parseOsRelease happy path", () => {
  it("parses an Omarchy os-release with quotes, escapes, and comments", () => {
    assert.deepEqual(parseOsRelease(OMARCHY_OS_RELEASE), {
      PRETTY_NAME: "Omarchy",
      NAME: "Omarchy",
      VARIANT: 'Omarchy "Tokyo Night" Edition',
      VARIANT_ID: "tokyo-night",
      ID: "omarchy",
      ID_LIKE: "arch",
      BUILD_ID: "rolling",
      ANSI_COLOR: "38;2;133;76;199",
      HOME_URL: "https://omarchy.org",
    });
  });

  it("parses a plain Arch os-release", () => {
    assert.deepEqual(parseOsRelease(ARCH_OS_RELEASE), {
      NAME: "Arch Linux",
      PRETTY_NAME: "Arch Linux",
      ID: "arch",
      BUILD_ID: "rolling",
      ANSI_COLOR: "38;2;23;147;209",
      HOME_URL: "https://archlinux.org/",
    });
  });

  it("parses the Ubuntu os-release of the current VM", () => {
    assert.deepEqual(parseOsRelease(UBUNTU_OS_RELEASE), {
      PRETTY_NAME: "Ubuntu 24.04.4 LTS",
      NAME: "Ubuntu",
      VERSION_ID: "24.04",
      VERSION: "24.04.4 LTS (Noble Numbat)",
      VERSION_CODENAME: "noble",
      ID: "ubuntu",
      ID_LIKE: "debian",
      HOME_URL: "https://www.ubuntu.com/",
      SUPPORT_URL: "https://help.ubuntu.com/",
      BUG_REPORT_URL: "https://bugs.launchpad.net/ubuntu/",
      PRIVACY_POLICY_URL: "https://www.ubuntu.com/legal/terms-and-policies/privacy-policy",
      UBUNTU_CODENAME: "noble",
      LOGO: "ubuntu-logo",
    });
  });
});

describe("parseOsRelease unhappy path", () => {
  it("returns an empty record for empty input", () => {
    assert.deepEqual(parseOsRelease(""), {});
  });

  it("ignores garbage lines without throwing", () => {
    const garbage = [
      "just some words",
      "=value-without-key",
      "  # a comment",
      "123ABC=key-must-start-with-a-letter",
      "KEY-WITHOUT-EQUALS",
    ].join("\n");
    assert.deepEqual(parseOsRelease(garbage), {});
  });

  it("keeps valid lines that sit between garbage lines", () => {
    assert.deepEqual(parseOsRelease("garbage line\nID=arch\nmore garbage"), { ID: "arch" });
  });

  it("leaves an unterminated quote untouched instead of throwing", () => {
    assert.deepEqual(parseOsRelease('NAME="unterminated'), { NAME: '"unterminated' });
  });
});

describe("parseMeminfo happy path", () => {
  it("converts kB fields to bytes and keeps unitless fields as counts", () => {
    assert.deepEqual(parseMeminfo(OMARCHY_MEMINFO), {
      MemTotal: 16265916 * 1024,
      MemFree: 8355300 * 1024,
      MemAvailable: 12094096 * 1024,
      Buffers: 313328 * 1024,
      Cached: 3931920 * 1024,
      "Active(anon)": 264 * 1024,
      SwapTotal: 4194300 * 1024,
      SwapFree: 4194200 * 1024,
      HugePages_Total: 0,
      Hugepagesize: 2048 * 1024,
    });
  });
});

describe("parseMeminfo unhappy path", () => {
  it("returns an empty record for empty or garbage input", () => {
    assert.deepEqual(parseMeminfo(""), {});
    assert.deepEqual(parseMeminfo("complete garbage\nno colons here"), {});
  });

  it("skips lines whose value is not a number", () => {
    assert.deepEqual(parseMeminfo("MemTotal: lots kB\nMemFree:  1 kB"), {
      MemFree: 1024,
    });
  });

  it("omits MemAvailable when the kernel does not report it", () => {
    const parsed = parseMeminfo(NO_AVAILABLE_MEMINFO);
    assert.equal("MemAvailable" in parsed, false);
    assert.equal(parsed.MemTotal, 8148028 * 1024);
  });
});

describe("cpu utilization happy path", () => {
  it("aggregates idle and total times across cores", () => {
    const cores = [
      { times: { user: 100, nice: 50, sys: 150, idle: 600, irq: 100 } },
      { times: { user: 0, nice: 0, sys: 0, idle: 500, irq: 0 } },
    ];
    assert.deepEqual(sampleCpuTimes(cores), { idleMs: 1100, totalMs: 1500 });
  });

  it("computes the busy percentage between two samples", () => {
    const prev = { idleMs: 1000, totalMs: 2000 };
    const next = { idleMs: 1500, totalMs: 3000 };
    assert.equal(cpuUtilizationPercent(prev, next), 50);
  });

  it("rounds to one decimal place", () => {
    const prev = { idleMs: 0, totalMs: 0 };
    const next = { idleMs: 1, totalMs: 3 };
    assert.equal(cpuUtilizationPercent(prev, next), 66.7);
  });

  it("clamps to the 0..100 range on skewed samples", () => {
    assert.equal(
      cpuUtilizationPercent({ idleMs: 1000, totalMs: 2000 }, { idleMs: 900, totalMs: 2100 }),
      100,
    );
    assert.equal(
      cpuUtilizationPercent({ idleMs: 1000, totalMs: 2000 }, { idleMs: 1300, totalMs: 2100 }),
      0,
    );
  });
});

describe("cpu utilization unhappy path", () => {
  it("returns null without a baseline sample", () => {
    assert.equal(cpuUtilizationPercent(null, { idleMs: 1500, totalMs: 3000 }), null);
  });

  it("returns null when no time has passed between samples", () => {
    const sample = { idleMs: 1000, totalMs: 2000 };
    assert.equal(cpuUtilizationPercent(sample, { ...sample }), null);
  });

  it("returns null when counters went backwards", () => {
    assert.equal(
      cpuUtilizationPercent({ idleMs: 5000, totalMs: 9000 }, { idleMs: 100, totalMs: 200 }),
      null,
    );
  });
});

/** Returns a cpus() stub whose times advance on every call. */
function advancingCpus(model: string, samples: CpuTimes[][]): () => { model: string; times: CpuTimes }[] {
  let call = 0;
  return () => {
    const sample = samples[Math.min(call, samples.length - 1)];
    call += 1;
    return sample.map((times) => ({ model, times }));
  };
}

describe("collectStats happy path", () => {
  it("returns the full payload on an Omarchy install", async () => {
    const collector = createStatsCollector({
      readFile: async (path) => {
        if (path === "/etc/os-release") {
          return OMARCHY_OS_RELEASE;
        }
        if (path === "/proc/meminfo") {
          return OMARCHY_MEMINFO;
        }
        throw new Error(`ENOENT: ${path}`);
      },
      access: async (path) => {
        if (path !== "/dev/kvm") {
          throw new Error(`ENOENT: ${path}`);
        }
      },
      cpus: advancingCpus("AMD Ryzen AI Max+ 395", [
        [
          { user: 100, nice: 0, sys: 100, idle: 800, irq: 0 },
          { user: 100, nice: 0, sys: 100, idle: 800, irq: 0 },
        ],
        [
          { user: 350, nice: 0, sys: 150, idle: 1000, irq: 0 },
          { user: 350, nice: 0, sys: 150, idle: 1000, irq: 0 },
        ],
      ]),
      totalmem: () => 999,
      freemem: () => 999,
      loadavg: () => [0.52, 0.34, 0.18],
      uptime: () => 5432.9,
      hostname: () => "omarchy-rig",
      platform: () => "linux",
      arch: () => "x64",
      release: () => "6.12.1-arch1-1",
      now: () => new Date("2026-08-29T12:00:00.000Z"),
    });

    const stats = await collectStats(collector, [
      { id: "aaaa-1111", pid: 4242 },
      { id: "bbbb-2222", pid: null },
    ]);

    assert.deepEqual(stats, {
      generatedAt: "2026-08-29T12:00:00.000Z",
      sessions: {
        count: 2,
        instances: [
          { id: "aaaa-1111", pid: 4242 },
          { id: "bbbb-2222", pid: null },
        ],
      },
      host: {
        hostname: "omarchy-rig",
        platform: "linux",
        arch: "x64",
        kernel: "6.12.1-arch1-1",
        uptimeSeconds: 5432,
        distro: { id: "omarchy", name: "Omarchy", prettyName: "Omarchy", idLike: "arch" },
      },
      cpu: {
        count: 2,
        model: "AMD Ryzen AI Max+ 395",
        loadAverage: [0.52, 0.34, 0.18],
        utilizationPercent: 60,
      },
      memory: {
        totalBytes: 16265916 * 1024,
        freeBytes: 8355300 * 1024,
        availableBytes: 12094096 * 1024,
        usedBytes: (16265916 - 12094096) * 1024,
        usedPercent: 25.6,
        swapTotalBytes: 4194300 * 1024,
        swapFreeBytes: 4194200 * 1024,
      },
      kvm: { available: true },
    });
  });

  it("degrades cleanly on a VM without MemAvailable, /etc/os-release, or KVM", async () => {
    const collector = createStatsCollector({
      readFile: async (path) => {
        // Only the os-release spec fallback location exists on this host.
        if (path === "/usr/lib/os-release") {
          return UBUNTU_OS_RELEASE;
        }
        if (path === "/proc/meminfo") {
          return NO_AVAILABLE_MEMINFO;
        }
        throw new Error(`ENOENT: ${path}`);
      },
      access: async (path) => {
        throw new Error(`ENOENT: ${path}`);
      },
      cpus: advancingCpus("Intel(R) Xeon(R) CPU", [
        [{ user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 }],
        [{ user: 250, nice: 0, sys: 250, idle: 1500, irq: 0 }],
      ]),
      totalmem: () => 999,
      freemem: () => 999,
      loadavg: () => [1.5, 1, 0.5],
      uptime: () => 100.2,
      hostname: () => "cloud-vm",
      platform: () => "linux",
      arch: () => "x64",
      release: () => "6.12.94+",
      now: () => new Date("2026-08-29T12:00:00.000Z"),
    });

    const stats = await collectStats(collector, []);

    assert.deepEqual(stats, {
      generatedAt: "2026-08-29T12:00:00.000Z",
      sessions: { count: 0, instances: [] },
      host: {
        hostname: "cloud-vm",
        platform: "linux",
        arch: "x64",
        kernel: "6.12.94+",
        uptimeSeconds: 100,
        distro: {
          id: "ubuntu",
          name: "Ubuntu",
          prettyName: "Ubuntu 24.04.4 LTS",
          idLike: "debian",
        },
      },
      cpu: {
        count: 1,
        model: "Intel(R) Xeon(R) CPU",
        loadAverage: [1.5, 1, 0.5],
        utilizationPercent: 50,
      },
      memory: {
        totalBytes: 8148028 * 1024,
        freeBytes: 2148028 * 1024,
        availableBytes: null,
        usedBytes: (8148028 - 2148028) * 1024,
        usedPercent: 73.6,
        swapTotalBytes: null,
        swapFreeBytes: null,
      },
      kvm: { available: false },
    });
  });
});

describe("collectStats unhappy path", () => {
  it("falls back to the os module when no proc or release files are readable", async () => {
    const collector = createStatsCollector({
      readFile: async (path) => {
        throw new Error(`ENOENT: ${path}`);
      },
      access: async (path) => {
        throw new Error(`ENOENT: ${path}`);
      },
      cpus: advancingCpus("cpu", [
        [{ user: 100, nice: 0, sys: 100, idle: 800, irq: 0 }],
        [{ user: 350, nice: 0, sys: 250, idle: 1200, irq: 0 }],
      ]),
      totalmem: () => 8 * 2 ** 30,
      freemem: () => 2 * 2 ** 30,
      loadavg: () => [0, 0, 0],
      uptime: () => 42.9,
      hostname: () => "bare-host",
      platform: () => "darwin",
      arch: () => "arm64",
      release: () => "23.6.0",
      now: () => new Date("2026-08-29T12:00:00.000Z"),
    });

    const stats = await collectStats(collector, []);

    assert.deepEqual(stats, {
      generatedAt: "2026-08-29T12:00:00.000Z",
      sessions: { count: 0, instances: [] },
      host: {
        hostname: "bare-host",
        platform: "darwin",
        arch: "arm64",
        kernel: "23.6.0",
        uptimeSeconds: 42,
        distro: null,
      },
      cpu: {
        count: 1,
        model: "cpu",
        loadAverage: [0, 0, 0],
        // Samples advanced by 800 total / 400 idle -> 50% busy.
        utilizationPercent: 50,
      },
      memory: {
        totalBytes: 8 * 2 ** 30,
        freeBytes: 2 * 2 ** 30,
        availableBytes: null,
        usedBytes: 6 * 2 ** 30,
        usedPercent: 75,
        swapTotalBytes: null,
        swapFreeBytes: null,
      },
      kvm: { available: false },
    });
  });

  it("reports empty cpu info instead of throwing when cpus() sees nothing", async () => {
    const collector = createStatsCollector({
      readFile: async (path) => {
        throw new Error(`ENOENT: ${path}`);
      },
      access: async (path) => {
        throw new Error(`ENOENT: ${path}`);
      },
      cpus: () => [],
      totalmem: () => 8 * 2 ** 30,
      freemem: () => 2 * 2 ** 30,
      loadavg: () => [0, 0, 0],
      uptime: () => 1,
      hostname: () => "empty-host",
      platform: () => "linux",
      arch: () => "x64",
      release: () => "6.0.0",
      now: () => new Date("2026-08-29T12:00:00.000Z"),
    });

    const stats = await collectStats(collector, []);

    assert.deepEqual(stats.cpu, {
      count: 0,
      model: null,
      loadAverage: [0, 0, 0],
      utilizationPercent: null,
    });
  });
});
