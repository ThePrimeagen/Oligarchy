import * as Db from "@oligarchy/db";
import * as jarl from "jarl";
import { describe, expect, it, vi } from "vitest";
import type * as Host from "../src/host.ts";
import { announce, type Member, type Needs } from "../src/member.ts";
import * as Usage from "../src/usage.ts";
import { database, held, logging } from "./support.ts";

const STATS: Host.HostStats = {
  memory: { totalBytes: 1000, usedBytes: 750, freeBytes: 250 },
  cpu: { cores: 2, mean: 10, mean1m: 11, mean2m: 12, mean3m: 13, p10: 0, p25: 0, p75: 0, p90: 50 },
};

const USAGE = { memoryBytes: 5, cpuPercent: 1.5 };

const MEMBER: Member = {
  type: "qemu",
  url: "http://s1:9000",
  name: "s1",
  attribution: { location: "qemu-server" },
  report: async () => jarl.ok({ qemus: 2, jobs: 3 }),
};

// What a failed database write says: drizzle's failed query, with the driver's reason as cause.
const refusedWrite = (reason: string) => {
  const error = new Db.DatabaseError(`Failed query: insert into ...: ${reason}`);
  error.cause = new Error(reason);
  return error;
};

// Every need faked and recording what was asked of it, with the parts a test replaces.
const faked = (overrides: Partial<Omit<Needs, "logger">> = {}) => {
  const { lines, logger } = logging();
  const calls: Array<string> = [];
  const needs: Needs = {
    host: { collect: () => STATS },
    usage: { collect: async () => jarl.ok(USAGE) },
    servers: {
      heartbeat: async () => {
        calls.push("heartbeat");
        return jarl.ok(undefined);
      },
      removeServer: async () => {
        calls.push("remove");
        return jarl.ok(true);
      },
    },
    processStats: {
      report: async () => {
        calls.push("process stats");
        return jarl.ok(undefined);
      },
    },
    logger,
    ...overrides,
  };
  return { calls, lines, needs };
};

const EVERY = { every: 5 };

const count = (calls: ReadonlyArray<string>, call: string) =>
  calls.filter((each) => each === call).length;

describe("announcing a member", () => {
  it("writes its servers row and a process_stats row at once, and on abort leaves and deletes the row but keeps the readings (happy)", async () => {
    const { servers, processStats } = await database();
    const { lines, logger } = logging();
    const left: Array<string> = [];
    const stop = new AbortController();

    const announced = announce(
      {
        ...MEMBER,
        onLeave: async () => {
          left.push("left");
          return jarl.ok(undefined);
        },
      },
      {
        host: { collect: () => STATS },
        usage: { collect: async () => jarl.ok(USAGE) },
        servers,
        processStats,
        logger,
      },
      stop.signal,
      { every: 15_000 },
    );
    await vi.waitFor(async () => {
      expect(jarl.unwrap(await processStats.listSeries(10))).toHaveLength(1);
    });

    expect(jarl.unwrap(await servers.listMachines())).toMatchObject([
      {
        url: "http://s1:9000",
        name: "s1",
        type: "qemu",
        generation: 1,
        stats: {
          qemus: 2,
          memory: { totalBytes: 1000, usedBytes: 750 },
          cpu: { mean1m: 11, mean2m: 12, mean3m: 13 },
        },
      },
    ]);
    stop.abort();
    await announced;
    expect(left).toEqual(["left"]);
    expect(jarl.unwrap(await servers.listMachines())).toEqual([]);
    expect(jarl.unwrap(await processStats.listSeries(10))).toEqual([
      { name: "s1", type: "qemu", samples: [{ jobs: 3, ...USAGE }] },
    ]);
    expect(lines).toEqual([]);
  });

  it("with the database gone, every write is one line with the driver's reason, the ticks go on, and the leave still settles (error)", async () => {
    const { fake, servers, processStats } = await database();
    await fake.stop();
    const { lines, logger } = logging();
    const stop = new AbortController();

    const announced = announce(
      MEMBER,
      {
        host: { collect: () => STATS },
        usage: { collect: async () => jarl.ok(USAGE) },
        servers,
        processStats,
        logger,
      },
      stop.signal,
      { every: 20 },
    );
    await vi.waitFor(() => {
      expect(
        lines.filter((line) => line.includes("heartbeat failed")).length,
      ).toBeGreaterThanOrEqual(2);
    });
    stop.abort();
    await announced;

    expect(lines[0]).toMatch(
      /^\[ERROR\] \[global\] qemu-server: heartbeat failed: connect ECONNREFUSED 127\.0\.0\.1:\d+$/,
    );
    expect(lines[1]).toMatch(
      /^\[ERROR\] \[global\] qemu-server: process stats failed: connect ECONNREFUSED/,
    );
    expect(lines.at(-1)).toMatch(
      /^\[ERROR\] \[global\] qemu-server: unannounce failed: connect ECONNREFUSED/,
    );
  });

  it("a refused heartbeat is one line, the process stats are still written, and the next tick heartbeats (error)", async () => {
    const { calls, lines, needs } = faked();
    let first = true;
    const stop = new AbortController();
    const announced = announce(
      MEMBER,
      {
        ...needs,
        servers: {
          ...needs.servers,
          heartbeat: async () => {
            calls.push("heartbeat");
            const refused = first;
            first = false;
            return refused
              ? jarl.err(refusedWrite("connect ECONNREFUSED 127.0.0.1:5432"))
              : jarl.ok(undefined);
          },
        },
      },
      stop.signal,
      EVERY,
    );
    await vi.waitFor(() => {
      expect(count(calls, "process stats")).toBeGreaterThanOrEqual(2);
    });
    stop.abort();
    await announced;

    expect(calls.slice(0, 4)).toEqual(["heartbeat", "process stats", "heartbeat", "process stats"]);
    expect(lines).toEqual([
      "[ERROR] [global] qemu-server: heartbeat failed: connect ECONNREFUSED 127.0.0.1:5432",
    ]);
  });

  it("usage that cannot be read is one process stats line, and the heartbeat is still written (error)", async () => {
    const { calls, lines, needs } = faked({
      usage: {
        collect: async () =>
          jarl.err(new Usage.UsageUnreadable("ps did not list this process (pid 42)")),
      },
    });
    const stop = new AbortController();
    const announced = announce(MEMBER, needs, stop.signal, EVERY);
    await vi.waitFor(() => {
      expect(count(calls, "heartbeat")).toBeGreaterThanOrEqual(1);
    });
    stop.abort();
    await announced;

    expect(count(calls, "process stats")).toBe(0);
    expect(lines[0]).toBe(
      "[ERROR] [global] qemu-server: process stats failed: ps did not list this process (pid 42)",
    );
  });

  it.each([
    ["refuses", async () => jarl.err({ message: "qemu list failed" }), "qemu list failed"],
    [
      "throws",
      async () => {
        throw new Error("boom");
      },
      "boom",
    ],
  ])(
    "a report that %s is one line, nothing is written that tick, and the next tick reports (error)",
    async (_, failing, said) => {
      const { calls, lines, needs } = faked();
      const reports = [failing];
      const stop = new AbortController();
      const announced = announce(
        { ...MEMBER, report: (signal) => (reports.shift() ?? MEMBER.report)(signal) },
        needs,
        stop.signal,
        EVERY,
      );
      await vi.waitFor(() => {
        expect(count(calls, "heartbeat")).toBeGreaterThanOrEqual(1);
      });
      stop.abort();
      await announced;

      expect(lines).toEqual([`[ERROR] [global] qemu-server: report failed: ${said}`]);
      expect(calls[0]).toBe("heartbeat");
    },
  );

  it("a join that fails is one line, the tick still writes, and it is tried each tick until it succeeds, then never again (error)", async () => {
    const { calls, lines, needs } = faked();
    let joins = 0;
    const stop = new AbortController();
    const announced = announce(
      {
        ...MEMBER,
        onJoin: async () => {
          joins += 1;
          return joins === 1 ? jarl.err({ message: "reclaim failed" }) : jarl.ok(undefined);
        },
      },
      needs,
      stop.signal,
      EVERY,
    );
    await vi.waitFor(() => {
      expect(count(calls, "heartbeat")).toBeGreaterThanOrEqual(4);
    });
    stop.abort();
    await announced;

    expect(joins).toBe(2);
    expect(lines).toEqual(["[ERROR] [global] qemu-server: join failed: reclaim failed"]);
  });

  it("a leave that fails is one line, and the row is still deleted (error)", async () => {
    const { calls, lines, needs } = faked();
    const stop = new AbortController();
    const announced = announce(
      { ...MEMBER, onLeave: async () => jarl.err({ message: "guests still running" }) },
      needs,
      stop.signal,
      EVERY,
    );
    stop.abort();
    await announced;

    expect(calls.at(-1)).toBe("remove");
    expect(lines).toEqual(["[ERROR] [global] qemu-server: leave failed: guests still running"]);
  });

  it("a refused delete is one unannounce line, and the announce still settles (error)", async () => {
    const { needs, lines } = faked();
    const stop = new AbortController();
    const announced = announce(
      MEMBER,
      {
        ...needs,
        servers: {
          ...needs.servers,
          removeServer: async () => jarl.err(refusedWrite("Connection terminated")),
        },
      },
      stop.signal,
      EVERY,
    );
    stop.abort();
    await announced;

    expect(lines).toEqual([
      "[ERROR] [global] qemu-server: unannounce failed: Connection terminated",
    ]);
  });

  it("an abort during a write lets the write finish before the row is deleted (error)", async () => {
    vi.useFakeTimers();
    const { calls, needs } = faked();
    const entered = held<void>();
    const writing = held<jarl.Result<void, Db.DatabaseError>>();
    const stop = new AbortController();
    let settled = false;
    const announced = announce(
      MEMBER,
      {
        ...needs,
        servers: {
          ...needs.servers,
          heartbeat: () => {
            calls.push("heartbeat");
            entered.release();
            return writing.promise;
          },
        },
      },
      stop.signal,
      EVERY,
    ).then(() => {
      settled = true;
    });
    try {
      await entered.promise;

      stop.abort();
      await vi.advanceTimersByTimeAsync(20);
      expect(calls).toEqual(["heartbeat"]);
      expect(settled).toBe(false);

      writing.release(jarl.ok(undefined));
      await announced;
      expect(calls).toEqual(["heartbeat", "process stats", "remove"]);
    } finally {
      stop.abort();
      writing.release(jarl.ok(undefined));
      vi.useRealTimers();
    }
  });
});
