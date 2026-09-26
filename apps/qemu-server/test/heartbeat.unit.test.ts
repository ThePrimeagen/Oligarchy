import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as DbErrors from "@oligarchy/db/errors";
import * as SetupRequests from "@oligarchy/db/setup-requests";
import * as ProcessUsage from "@oligarchy/fleet/process";
import * as TestingStores from "@oligarchy/testing/stores";
import * as Heartbeat from "../src/heartbeat.ts";
import * as FakeQemu from "./support/fake-qemu.ts";
import * as FakeSessions from "./support/fake-sessions.ts";
import * as TestingLog from "@oligarchy/testing/log";

const URL = "http://127.0.0.1:55332";
const NAME = "garage";
const SAMPLE = { memoryBytes: 4_096_000, cpuPercent: 12.5 };

// A setup store whose removals answer `removed` in order, recording the urls asked for.
const fakeSetups = (removed: ReadonlyArray<Effect.Effect<number, DbErrors.DatabaseError>>) => {
  const cleared: Array<string> = [];
  const layer = Layer.succeed(SetupRequests.SetupRequestStore)(
    SetupRequests.SetupRequestStore.of({
      insert: () => Effect.die("Unexpected SetupRequestStore.insert"),
      setResult: () => Effect.die("Unexpected SetupRequestStore.setResult"),
      claim: () => Effect.die("Unexpected SetupRequestStore.claim"),
      remove: () => Effect.die("Unexpected SetupRequestStore.remove"),
      removeServer: (url) =>
        Effect.suspend(() => {
          cleared.push(url);
          return removed[cleared.length - 1] ?? Effect.succeed(0);
        }),
      serverForResult: () => Effect.die("Unexpected SetupRequestStore.serverForResult"),
      list: () => Effect.die("Unexpected SetupRequestStore.list"),
      inspect: () => Effect.die("Unexpected SetupRequestStore.inspect"),
    }),
  );
  return { cleared, layer };
};

const start = (
  options: {
    readonly setups?: ReturnType<typeof fakeSetups>;
    readonly usage?: Effect.Effect<ProcessUsage.ProcessSample, ProcessUsage.PsFailed>;
  } = {},
) =>
  Effect.gen(function* () {
    const servers = TestingStores.fakeServerStore();
    const process = TestingStores.fakeProcessStatsStore();
    const setups = options.setups ?? fakeSetups([]);
    const log = TestingLog.fakeLog();
    const scope = yield* Scope.make();
    yield* Heartbeat.announce(URL, NAME).pipe(
      Effect.provide(
        Layer.mergeAll(
          FakeSessions.fakeSessions({ qemus: Effect.succeed(3), jobs: Effect.succeed(2) }).layer,
          FakeQemu.fakeHost,
          Layer.succeed(ProcessUsage.ProcessUsage)(
            ProcessUsage.ProcessUsage.of({ collect: options.usage ?? Effect.succeed(SAMPLE) }),
          ),
          servers.layer,
          process.layer,
          setups.layer,
          log.layer,
        ),
      ),
      Scope.provide(scope),
    );
    return { scope, servers, process, setups, log };
  });

describe("qemu-server heartbeat happy path", () => {
  it.effect(
    "announces a qemu member: its machine count and the host's values, then its slots and this process",
    () =>
      Effect.gen(function* () {
        const { servers, process, log } = yield* start();
        expect(servers.heartbeats).toEqual([
          {
            url: URL,
            type: "qemu",
            name: NAME,
            stats: {
              qemus: 3,
              memory: { totalBytes: 16_000, usedBytes: 4_000 },
              cpu: { mean1m: 22.3, mean2m: 21.4, mean3m: 20.9 },
            },
          },
        ]);
        expect(process.reports).toEqual([
          { name: NAME, type: "qemu", stats: { jobs: 2, ...SAMPLE } },
        ]);
        expect(log.lines).toEqual([]);
      }),
  );

  it.effect("on joining it removes this url's setup rows once and says how many went", () =>
    Effect.gen(function* () {
      const setups = fakeSetups([Effect.succeed(2)]);
      const { log } = yield* start({ setups });
      yield* TestClock.adjust("60 seconds");
      expect(setups.cleared).toEqual([URL]);
      expect(log.lines).toEqual([
        {
          level: "info",
          text: `setup cleared; ${URL}; 2`,
          location: "server",
          agentId: undefined,
          skipSentry: false,
          cause: undefined,
        },
      ]);
    }),
  );

  it.effect("a join that removed nothing says nothing", () =>
    Effect.gen(function* () {
      const setups = fakeSetups([Effect.succeed(0)]);
      const { log } = yield* start({ setups });
      yield* TestClock.adjust("30 seconds");
      expect(setups.cleared).toEqual([URL]);
      expect(log.lines).toEqual([]);
    }),
  );
});

describe("qemu-server heartbeat unhappy path", () => {
  it.effect("a refused setup removal is one line under the server and is retried next tick", () =>
    Effect.gen(function* () {
      const refused = DbErrors.DatabaseError.make({
        operation: "removeServerSetups",
        message: "Failed query: delete from setup_requests",
        cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      });
      const setups = fakeSetups([Effect.fail(refused), Effect.succeed(1)]);
      const { servers, log } = yield* start({ setups });
      expect(servers.heartbeats).toHaveLength(1);
      expect(log.lines).toEqual([
        {
          level: "error",
          text: "join failed: connect ECONNREFUSED 127.0.0.1:5432",
          location: "server",
          agentId: undefined,
          skipSentry: false,
          cause: refused,
        },
      ]);
      yield* TestClock.adjust("30 seconds");
      expect(setups.cleared).toEqual([URL, URL]);
      expect(log.lines.map((line) => line.text)).toEqual([
        "join failed: connect ECONNREFUSED 127.0.0.1:5432",
        `setup cleared; ${URL}; 1`,
      ]);
    }),
  );

  it.effect("a failing process read is PsFailed on one line; the servers row still lands", () =>
    Effect.gen(function* () {
      const unlisted = ProcessUsage.PsFailed.make({
        message: "ps did not list this process (pid 500)",
      });
      const { servers, process, log } = yield* start({ usage: Effect.fail(unlisted) });
      expect(servers.heartbeats).toHaveLength(1);
      expect(process.reports).toEqual([]);
      expect(log.lines).toEqual([
        {
          level: "error",
          text: "process stats failed: ps did not list this process (pid 500)",
          location: "server",
          agentId: undefined,
          skipSentry: false,
          cause: unlisted,
        },
      ]);
    }),
  );
});
