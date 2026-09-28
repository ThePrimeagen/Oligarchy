import { describe, expect, it } from "vitest";
import * as Host from "../src/host.ts";
import { logging } from "./support.ts";

// A host whose cpu is busy `busy[i]` percent over the i-th sample, after a first reading at zero.
const scripted = (busy: ReadonlyArray<number | Error>, cores = 2) => {
  let idleMs = 0;
  let totalMs = 0;
  const readings: Array<Host.CpuTimes | Error> = [{ cores, idleMs, totalMs }];
  for (const each of busy) {
    if (each instanceof Error) {
      readings.push(each);
      continue;
    }
    totalMs += 100;
    idleMs += 100 - each;
    readings.push({ cores, idleMs, totalMs });
  }
  const source: Host.Source = {
    cpuTimes: () => {
      const next = readings.shift();
      if (next === undefined) {
        throw new Error("the script ran out");
      }
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
    cores: () => cores,
    memory: () => ({ totalBytes: 1000, freeBytes: 250 }),
  };
  return source;
};

const sampled = (source: Host.Source, times: number) => {
  const { lines, logger } = logging();
  const host = Host.create({ source, logger, attribution: { location: "qemu-server" } });
  for (let i = 0; i < times; i += 1) {
    host.sample();
  }
  return { host, lines };
};

describe("the host sampler", () => {
  it("reports the memory split and the cpu over its last 60 samples: mean, the newest 1, 2 and 3 minutes, and percentiles (happy)", () => {
    // 10 samples the window drops, then 48 idle and 12 half-busy.
    const busy = [
      ...Array<number>(10).fill(100),
      ...Array<number>(48).fill(0),
      ...Array<number>(12).fill(50),
    ];
    const { host, lines } = sampled(scripted(busy), busy.length);

    expect(host.collect()).toEqual({
      memory: { totalBytes: 1000, usedBytes: 750, freeBytes: 250 },
      cpu: {
        cores: 2,
        mean: 10,
        mean1m: 50,
        mean2m: 25,
        mean3m: 16.7,
        p10: 0,
        p25: 0,
        p75: 0,
        p90: 50,
      },
    });
    expect(lines).toEqual([]);
  });

  it("a reading that throws is one error line, and the next sample still counts (error)", () => {
    const { host, lines } = sampled(scripted([new Error("cpus() failed"), 40]), 2);

    expect(lines).toEqual([
      "[ERROR] [global] qemu-server: failed to sample cpu usage: cpus() failed",
    ]);
    expect(host.collect().cpu.mean).toBe(40);
  });

  it.each([
    ["the core count changed", { cores: 4, idleMs: 50, totalMs: 100 }],
    ["no cpu time passed", { cores: 2, idleMs: 0, totalMs: 0 }],
  ])("a reading where %s is skipped, and the next one measures from it (error)", (_, odd) => {
    const readings: Array<Host.CpuTimes> = [
      { cores: 2, idleMs: 0, totalMs: 0 },
      odd,
      { ...odd, idleMs: odd.idleMs + 80, totalMs: odd.totalMs + 100 },
    ];
    const source: Host.Source = {
      cpuTimes: () => readings.shift() ?? odd,
      cores: () => odd.cores,
      memory: () => ({ totalBytes: 1, freeBytes: 1 }),
    };
    const { host, lines } = sampled(source, 2);

    expect(host.collect().cpu).toMatchObject({ mean: 20, p10: 20, p90: 20 });
    expect(lines).toEqual([]);
  });
});
