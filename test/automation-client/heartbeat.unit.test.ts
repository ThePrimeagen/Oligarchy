import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as Heartbeat from "../../src/automation-client/heartbeat.ts";
import * as Sessions from "../../src/automation-client/sessions.ts";
import * as Stats from "../../src/qemu/stats.ts";
import * as Contract from "../../src/shared/contract.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as ProcessUsage from "../../src/shared/process-usage.ts";
import * as FakeQemu from "../support/fake-qemu.ts";
import * as FakeLog from "../support/log.ts";
import * as Stores from "../support/stores.ts";

const URL = "http://127.0.0.1:55332";
const NAME = "garage";

// What FakeQemu.fakeStats says for collect(0), cut down to what the row keeps.
const ROW_STATS = {
  qemus: 0,
  memory: { totalBytes: 0, usedBytes: 0 },
  cpu: { mean1m: 0, mean2m: 0, mean3m: 0 },
};

// One heartbeat as the store records it: this process announces itself as an automation-client.
const ANNOUNCED = { url: URL, type: "automation-client", name: NAME, stats: ROW_STATS };
const REGISTERED = { url: URL, type: "automation-client", name: NAME };

const SAMPLE = { memoryBytes: 8_192_000, cpuPercent: 4.5 };
const PROCESS = {
  name: NAME,
  type: "automation-client" as const,
  stats: { jobs: 0, ...SAMPLE },
};

const fakeUsage = (sample = SAMPLE) =>
  Layer.succeed(ProcessUsage.ProcessUsage)(
    ProcessUsage.ProcessUsage.of({ collect: Effect.succeed(sample) }),
  );

const fakeSessions = (jobs: Effect.Effect<number> = Effect.succeed(0)) =>
  Layer.succeed(Sessions.Sessions)(
    Sessions.Sessions.of({
      reserve: () => Effect.die("Unexpected Sessions.reserve"),
      run: () => Effect.die("Unexpected Sessions.run"),
      abort: () => Effect.die("Unexpected Sessions.abort"),
      jobs,
    }),
  );

const refused = Errors.DatabaseError.make({
  operation: "heartbeat",
  message: "Failed query: insert into servers",
  cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
});

const fakeStats = (
  collect: (qemus: number) => Effect.Effect<Contract.Stats> = (qemus) =>
    Effect.succeed(Contract.Stats.make({ qemus, ...FakeQemu.ZERO_STATS })),
): Layer.Layer<Stats.Stats> => Layer.succeed(Stats.Stats)(Stats.Stats.of({ collect }));

// The loop in a scope of its own, so a test can close it and prove the ticking stops.
const start = (
  store: Stores.FakeServerStore,
  stats = fakeStats(),
  log = FakeLog.fakeLog(),
  process = Stores.fakeProcessStatsStore(),
  usage = fakeUsage(),
  sessions = fakeSessions(),
) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* Heartbeat.announce(URL, NAME).pipe(
      Effect.provide(Layer.mergeAll(sessions, stats, store.layer, process.layer, usage, log.layer)),
      Scope.provide(scope),
    );
    return { scope, log, process };
  });

describe("automation-client heartbeat happy path", () => {
  it.effect(
    "writes the row at once and then every thirty seconds, an automation-client with the host's stats",
    () =>
      Effect.gen(function* () {
        const store = Stores.fakeServerStore();
        const { log } = yield* start(store);
        expect(store.heartbeats).toEqual([ANNOUNCED]);
        expect(store.servers).toEqual([expect.objectContaining(REGISTERED)]);
        yield* TestClock.adjust("29 seconds");
        expect(store.heartbeats).toHaveLength(1);
        yield* TestClock.adjust("1 second");
        expect(store.heartbeats).toHaveLength(2);
        yield* TestClock.adjust("60 seconds");
        expect(store.heartbeats).toHaveLength(4);
        expect(
          store.heartbeats.every((beat) => beat.url === URL && beat.type === "automation-client"),
        ).toBe(true);
        expect(log.lines).toEqual([]);
      }),
  );

  it.effect("writes process stats at once and then every thirty seconds", () =>
    Effect.gen(function* () {
      const store = Stores.fakeServerStore();
      const { process, log } = yield* start(store);
      expect(process.reports).toEqual([PROCESS]);
      yield* TestClock.adjust("30 seconds");
      expect(process.reports).toHaveLength(2);
      expect(
        process.reports.every((row) => row.name === NAME && row.type === "automation-client"),
      ).toBe(true);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("reports the current job count, not an average", () =>
    Effect.gen(function* () {
      let jobs = 0;
      const store = Stores.fakeServerStore();
      const process = Stores.fakeProcessStatsStore();
      yield* start(
        store,
        fakeStats(),
        FakeLog.fakeLog(),
        process,
        fakeUsage(),
        fakeSessions(Effect.sync(() => jobs)),
      );
      expect(process.reports[0]?.stats.jobs).toBe(0);
      jobs = 2;
      yield* TestClock.adjust("30 seconds");
      expect(process.reports[1]?.stats.jobs).toBe(2);
    }),
  );

  it.effect("stops when the scope it was started in closes", () =>
    Effect.gen(function* () {
      const store = Stores.fakeServerStore();
      const { scope } = yield* start(store);
      yield* TestClock.adjust("30 seconds");
      expect(store.heartbeats).toHaveLength(2);
      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust("90 seconds");
      expect(store.heartbeats).toHaveLength(2);
    }),
  );

  it.effect("deletes its own row when the scope closes, and leaves every other server", () =>
    Effect.gen(function* () {
      const store = Stores.fakeServerStore();
      const other = {
        id: crypto.randomUUID(),
        url: "http://127.0.0.1:1",
        name: null,
        type: "qemu" as const,
      };
      store.servers.push(other);
      const { scope, log } = yield* start(store);
      expect(store.servers).toEqual([other, expect.objectContaining(REGISTERED)]);
      yield* Scope.close(scope, Exit.void);
      expect(store.servers).toEqual([other]);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect("a write in flight finishes before the row is deleted", () =>
    Effect.gen(function* () {
      const writing = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const order: Array<string> = [];
      const store = Stores.fakeServerStore({
        heartbeat: () =>
          Effect.gen(function* () {
            order.push("write");
            yield* Deferred.succeed(writing, undefined);
            yield* Deferred.await(release);
          }),
        removeServer: () =>
          Effect.sync(() => {
            order.push("delete");
            return true;
          }),
      });
      const { scope } = yield* start(store);
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
});

describe("automation-client heartbeat unhappy path", () => {
  it.effect(
    "a refused write is one error line with the driver's reason, and the next tick still writes",
    () =>
      Effect.gen(function* () {
        let attempts = 0;
        const written: Array<typeof ANNOUNCED> = [];
        const store = Stores.fakeServerStore({
          heartbeat: (url, type, name, stats) =>
            Effect.suspend(() => {
              attempts += 1;
              if (attempts === 1) {
                return Effect.fail(refused);
              }
              written.push({ url, type, name, stats });
              return Effect.void;
            }),
        });
        const { log } = yield* start(store);
        expect(written).toEqual([]);
        expect(log.lines).toEqual([
          {
            level: "error",
            text: "heartbeat failed: connect ECONNREFUSED 127.0.0.1:5432",
            location: "automation-client",
            agentId: undefined,
            skipSentry: false,
            cause: refused,
          },
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(written).toEqual([ANNOUNCED]);
        expect(log.lines).toHaveLength(1);
      }),
  );

  it.effect(
    "a defect reading the stats is logged the same way, nothing written, and the loop goes on",
    () =>
      Effect.gen(function* () {
        const boom = new Error("stats exploded");
        let reads = 0;
        const stats = fakeStats((qemus) =>
          Effect.suspend(() => {
            reads += 1;
            return reads === 1
              ? Effect.die(boom)
              : Effect.succeed(Contract.Stats.make({ qemus, ...FakeQemu.ZERO_STATS }));
          }),
        );
        const store = Stores.fakeServerStore();
        const { log } = yield* start(store, stats);
        expect(store.heartbeats).toEqual([]);
        expect(log.lines).toMatchObject([
          { level: "error", text: "heartbeat failed: stats exploded", cause: boom },
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(store.heartbeats).toEqual([ANNOUNCED]);
        expect(log.lines).toHaveLength(1);
      }),
  );

  it.effect(
    "a refused delete is one error line with the driver's reason, and the scope still closes",
    () =>
      Effect.gen(function* () {
        const refusedDelete = Errors.DatabaseError.make({
          operation: "removeServer",
          message: "Failed query: delete from servers",
          cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        });
        const store = Stores.fakeServerStore({
          removeServer: () => Effect.fail(refusedDelete),
        });
        const { scope, log } = yield* start(store);
        expect(store.servers).toEqual([expect.objectContaining(REGISTERED)]);
        yield* Scope.close(scope, Exit.void);
        expect(store.servers).toEqual([expect.objectContaining(REGISTERED)]);
        expect(log.lines).toEqual([
          {
            level: "error",
            text: "unannounce failed: connect ECONNREFUSED 127.0.0.1:5432",
            location: "automation-client",
            agentId: undefined,
            skipSentry: false,
            cause: refusedDelete,
          },
        ]);
      }),
  );

  it.effect(
    "a refused process write is its own error line, and the servers heartbeat still writes",
    () =>
      Effect.gen(function* () {
        const refusedProcess = Errors.DatabaseError.make({
          operation: "reportProcess",
          message: "Failed query: insert into process_stats",
          cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        });
        const process = Stores.fakeProcessStatsStore({
          report: () => Effect.fail(refusedProcess),
        });
        const store = Stores.fakeServerStore();
        const { log } = yield* start(store, fakeStats(), FakeLog.fakeLog(), process);
        expect(store.heartbeats).toEqual([ANNOUNCED]);
        expect(log.lines).toEqual([
          {
            level: "error",
            text: "process stats failed: connect ECONNREFUSED 127.0.0.1:5432",
            location: "automation-client",
            agentId: undefined,
            skipSentry: false,
            cause: refusedProcess,
          },
        ]);
      }),
  );

  it.effect("a missing row is not an error", () =>
    Effect.gen(function* () {
      const removals: Array<string> = [];
      const store = Stores.fakeServerStore({
        removeServer: (url) =>
          Effect.sync(() => {
            removals.push(url);
            return false;
          }),
      });
      const { scope, log } = yield* start(store);
      yield* Scope.close(scope, Exit.void);
      expect(removals).toEqual([URL]);
      expect(log.lines).toEqual([]);
    }),
  );
});
