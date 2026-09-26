import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as DbErrors from "@oligarchy/db/errors";
import * as Log from "@oligarchy/log/log";
import * as TestingStores from "@oligarchy/testing/stores";
import * as Host from "../src/host.ts";
import * as Member from "../src/member.ts";
import * as ProcessUsage from "../src/process.ts";

const URL = "http://127.0.0.1:55332";
const NAME = "garage";
const ATTRIBUTION = { location: "automation-client" };

type Line = {
  readonly level: string;
  readonly text: string;
  readonly location: string | undefined;
  readonly cause: unknown;
};

// A Log that keeps every line instead of writing it.
const recordingLog = () => {
  const lines: Array<Line> = [];
  const record =
    (level: string) =>
    (text: string, report?: Log.Report): Effect.Effect<void> =>
      Effect.sync(() => {
        lines.push({ level, text, location: report?.location, cause: report?.cause });
      });
  return {
    lines,
    layer: Layer.succeed(Log.Log)(
      Log.Log.of({
        info: record("info"),
        warning: record("warning"),
        error: record("error"),
        fatal: record("fatal"),
        flush: Effect.void,
      }),
    ),
  };
};

const HOST: Host.HostStats = {
  memory: { totalBytes: 16_000, usedBytes: 4_000, freeBytes: 12_000 },
  cpu: {
    cores: 4,
    mean: 20.5,
    mean1m: 22.3,
    mean2m: 21.4,
    mean3m: 20.9,
    p10: 19.8,
    p25: 20.1,
    p75: 20.9,
    p90: 21.1,
  },
};
const SAMPLE = { memoryBytes: 4_096_000, cpuPercent: 12.5 };

// The servers row as the store records it: the member's counts and the sampler's cut down.
const ANNOUNCED = {
  url: URL,
  type: "automation-client",
  name: NAME,
  stats: {
    qemus: 2,
    memory: { totalBytes: 16_000, usedBytes: 4_000 },
    cpu: { mean1m: 22.3, mean2m: 21.4, mean3m: 20.9 },
  },
};
const PROCESS = { name: NAME, type: "automation-client", stats: { jobs: 1, ...SAMPLE } };

const refused = (operation: string) =>
  DbErrors.DatabaseError.make({
    operation,
    message: `Failed query: ${operation}`,
    cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
  });

const failedLine = (text: string, cause: unknown): Line => ({
  level: "error",
  text: `${text}: connect ECONNREFUSED 127.0.0.1:5432`,
  location: "automation-client",
  cause,
});

type Fakes = {
  readonly servers?: TestingStores.FakeServerStore;
  readonly process?: TestingStores.FakeProcessStatsStore;
  readonly usage?: Effect.Effect<ProcessUsage.ProcessSample, ProcessUsage.PsFailed>;
};

// The loop in a scope of its own, so a test can close it and prove the ticking stops.
const start = <RJoin, EJoin, RLeave, ELeave>(
  hooks: {
    readonly report?: Effect.Effect<{ readonly qemus: number; readonly jobs: number }, unknown>;
    readonly onJoin?: Effect.Effect<void, EJoin, RJoin>;
    readonly onLeave?: Effect.Effect<void, ELeave, RLeave>;
  } = {},
  fakes: Fakes = {},
) =>
  Effect.gen(function* () {
    const servers = fakes.servers ?? TestingStores.fakeServerStore();
    const process = fakes.process ?? TestingStores.fakeProcessStatsStore();
    const log = recordingLog();
    const scope = yield* Scope.make();
    yield* Member.announce({
      type: "automation-client",
      url: URL,
      name: NAME,
      attribution: ATTRIBUTION,
      report: hooks.report ?? Effect.succeed({ qemus: 2, jobs: 1 }),
      ...(hooks.onJoin === undefined ? {} : { onJoin: hooks.onJoin }),
      ...(hooks.onLeave === undefined ? {} : { onLeave: hooks.onLeave }),
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Host.Host)(Host.Host.of({ collect: Effect.succeed(HOST) })),
          Layer.succeed(ProcessUsage.ProcessUsage)(
            ProcessUsage.ProcessUsage.of({ collect: fakes.usage ?? Effect.succeed(SAMPLE) }),
          ),
          servers.layer,
          process.layer,
          log.layer,
        ),
      ),
      Scope.provide(scope),
    );
    return { scope, log, servers, process };
  });

describe("Member.announce happy path", () => {
  it.effect(
    "the first tick writes the servers row with the member's counts and the sampler's values, then the process row",
    () =>
      Effect.gen(function* () {
        const order: Array<string> = [];
        const servers = TestingStores.fakeServerStore({
          heartbeat: () => Effect.sync(() => void order.push("servers")),
        });
        const process = TestingStores.fakeProcessStatsStore({
          report: () => Effect.sync(() => void order.push("process")),
        });
        yield* start({}, { servers, process });
        expect(order).toEqual(["servers", "process"]);
        const { servers: written, process: reported, log } = yield* start();
        expect(written.heartbeats).toEqual([ANNOUNCED]);
        expect(written.servers).toEqual([
          expect.objectContaining({ url: URL, type: "automation-client", name: NAME }),
        ]);
        expect(reported.reports).toEqual([PROCESS]);
        expect(log.lines).toEqual([]);
      }),
  );

  it.effect("ticks every thirty seconds, reading the member's counts afresh each time", () =>
    Effect.gen(function* () {
      let jobs = 0;
      const { servers, process } = yield* start({
        report: Effect.sync(() => ({ qemus: jobs, jobs })),
      });
      yield* TestClock.adjust("29 seconds");
      expect(servers.heartbeats).toHaveLength(1);
      jobs = 3;
      yield* TestClock.adjust("1 second");
      expect(servers.heartbeats).toHaveLength(2);
      expect(servers.heartbeats[1]?.stats.qemus).toBe(3);
      expect(process.reports.map((row) => row.stats.jobs)).toEqual([0, 3]);
      yield* TestClock.adjust("60 seconds");
      expect(servers.heartbeats).toHaveLength(4);
    }),
  );

  it.effect("closing the scope stops the ticks and deletes its own row, and no other", () =>
    Effect.gen(function* () {
      const servers = TestingStores.fakeServerStore();
      const other = {
        id: crypto.randomUUID(),
        url: "http://127.0.0.1:1",
        name: null,
        type: "qemu" as const,
      };
      servers.servers.push(other);
      const { scope, log } = yield* start({}, { servers });
      yield* TestClock.adjust("30 seconds");
      yield* Scope.close(scope, Exit.void);
      expect(servers.servers).toEqual([other]);
      yield* TestClock.adjust("90 seconds");
      expect(servers.heartbeats).toHaveLength(2);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("a write in flight finishes before the row is deleted", () =>
    Effect.gen(function* () {
      const writing = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const order: Array<string> = [];
      const servers = TestingStores.fakeServerStore({
        heartbeat: () =>
          Effect.gen(function* () {
            order.push("write");
            yield* Deferred.succeed(writing, undefined);
            yield* Deferred.await(release);
          }),
        removeServer: () => Effect.sync(() => (order.push("delete"), true)),
      });
      const { scope } = yield* start({}, { servers });
      yield* Deferred.await(writing);
      const closed = yield* Effect.forkChild(Scope.close(scope, Exit.void));
      yield* Effect.yieldNow;
      expect(closed.pollUnsafe()).toBeUndefined();
      expect(order).toEqual(["write"]);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(closed);
      expect(order).toEqual(["write", "delete"]);
    }),
  );

  it.effect("onJoin runs before the first heartbeat and, once it succeeds, never again", () =>
    Effect.gen(function* () {
      const order: Array<string> = [];
      const servers = TestingStores.fakeServerStore({
        heartbeat: () => Effect.sync(() => void order.push("heartbeat")),
      });
      yield* start({ onJoin: Effect.sync(() => void order.push("join")) }, { servers });
      yield* TestClock.adjust("60 seconds");
      expect(order).toEqual(["join", "heartbeat", "heartbeat", "heartbeat"]);
    }),
  );

  it.effect("onLeave runs before the row is deleted", () =>
    Effect.gen(function* () {
      const order: Array<string> = [];
      const servers = TestingStores.fakeServerStore({
        removeServer: () => Effect.sync(() => (order.push("delete"), true)),
      });
      const { scope } = yield* start(
        { onLeave: Effect.sync(() => void order.push("leave")) },
        { servers },
      );
      yield* Scope.close(scope, Exit.void);
      expect(order).toEqual(["leave", "delete"]);
    }),
  );

  it.effect("a row already gone at close is not an error", () =>
    Effect.gen(function* () {
      const servers = TestingStores.fakeServerStore({ removeServer: () => Effect.succeed(false) });
      const { scope, log } = yield* start({}, { servers });
      yield* Scope.close(scope, Exit.void);
      expect(log.lines).toEqual([]);
    }),
  );
});

describe("Member.announce unhappy path", () => {
  it.effect(
    "a refused servers write is one heartbeat failed line under the member's attribution, and the process row still lands",
    () =>
      Effect.gen(function* () {
        const error = refused("heartbeat");
        let attempts = 0;
        const servers = TestingStores.fakeServerStore({
          heartbeat: () =>
            Effect.suspend(() => (++attempts === 1 ? Effect.fail(error) : Effect.void)),
        });
        const { process, log } = yield* start({}, { servers });
        expect(process.reports).toEqual([PROCESS]);
        expect(log.lines).toEqual([failedLine("heartbeat failed", error)]);
        yield* TestClock.adjust("30 seconds");
        expect(attempts).toBe(2);
        expect(log.lines).toHaveLength(1);
      }),
  );

  it.effect(
    "a refused process write is one process stats failed line; the servers row still lands",
    () =>
      Effect.gen(function* () {
        const error = refused("reportProcess");
        const process = TestingStores.fakeProcessStatsStore({ report: () => Effect.fail(error) });
        const { servers, log } = yield* start({}, { process });
        expect(servers.heartbeats).toEqual([ANNOUNCED]);
        expect(log.lines).toEqual([failedLine("process stats failed", error)]);
      }),
  );

  it.effect(
    "a failing process reading is one process stats failed line, and the next tick reads",
    () =>
      Effect.gen(function* () {
        const unlisted = ProcessUsage.PsFailed.make({
          message: "ps did not list this process (pid 500)",
        });
        let reads = 0;
        const { servers, process, log } = yield* start(
          {},
          {
            usage: Effect.suspend(() =>
              ++reads === 1 ? Effect.fail(unlisted) : Effect.succeed(SAMPLE),
            ),
          },
        );
        expect(servers.heartbeats).toEqual([ANNOUNCED]);
        expect(process.reports).toEqual([]);
        expect(log.lines).toEqual([
          {
            level: "error",
            text: "process stats failed: ps did not list this process (pid 500)",
            location: "automation-client",
            cause: unlisted,
          },
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(process.reports).toEqual([PROCESS]);
      }),
  );

  it.effect("a failing report is one line, nothing is written, and the next tick reports", () =>
    Effect.gen(function* () {
      const boom = new Error("counts unavailable");
      let reads = 0;
      const { servers, process, log } = yield* start({
        report: Effect.suspend(() =>
          ++reads === 1 ? Effect.die(boom) : Effect.succeed({ qemus: 2, jobs: 1 }),
        ),
      });
      expect(servers.heartbeats).toEqual([]);
      expect(process.reports).toEqual([]);
      expect(log.lines).toEqual([
        {
          level: "error",
          text: "report failed: counts unavailable",
          location: "automation-client",
          cause: boom,
        },
      ]);
      yield* TestClock.adjust("30 seconds");
      expect(servers.heartbeats).toEqual([ANNOUNCED]);
      expect(process.reports).toEqual([PROCESS]);
    }),
  );

  it.effect(
    "a failing onJoin is one line, the heartbeat still writes, and it runs again next tick",
    () =>
      Effect.gen(function* () {
        const error = refused("removeServerSetups");
        let joins = 0;
        const { servers, log } = yield* start({
          onJoin: Effect.suspend(() => (++joins === 1 ? Effect.fail(error) : Effect.void)),
        });
        expect(servers.heartbeats).toEqual([ANNOUNCED]);
        expect(log.lines).toEqual([failedLine("join failed", error)]);
        yield* TestClock.adjust("30 seconds");
        expect(joins).toBe(2);
        yield* TestClock.adjust("60 seconds");
        expect(joins).toBe(2);
        expect(log.lines).toHaveLength(1);
      }),
  );

  it.effect("a refused delete is one unannounce failed line, and the scope still closes", () =>
    Effect.gen(function* () {
      const error = refused("removeServer");
      const servers = TestingStores.fakeServerStore({ removeServer: () => Effect.fail(error) });
      const { scope, log } = yield* start({}, { servers });
      yield* Scope.close(scope, Exit.void);
      expect(servers.servers).toEqual([expect.objectContaining({ url: URL })]);
      expect(log.lines).toEqual([failedLine("unannounce failed", error)]);
    }),
  );

  it.effect("a failing onLeave is one line, and the row is still deleted", () =>
    Effect.gen(function* () {
      const error = refused("leave");
      const { scope, servers, log } = yield* start({ onLeave: Effect.fail(error) });
      yield* Scope.close(scope, Exit.void);
      expect(servers.servers).toEqual([]);
      expect(log.lines).toEqual([failedLine("leave failed", error)]);
    }),
  );
});
