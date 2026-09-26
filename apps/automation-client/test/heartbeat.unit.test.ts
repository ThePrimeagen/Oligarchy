import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as Host from "@oligarchy/fleet/host";
import * as ProcessUsage from "@oligarchy/fleet/process";
import * as TestingStores from "@oligarchy/testing/stores";
import * as Heartbeat from "../src/heartbeat.ts";
import * as Sessions from "../src/sessions.ts";
import * as TestingLog from "@oligarchy/testing/log";

const URL = "http://127.0.0.1:55332";
const NAME = "garage";
const SAMPLE = { memoryBytes: 8_192_000, cpuPercent: 4.5 };
const HOST: Host.HostStats = {
  memory: { totalBytes: 32_000, usedBytes: 8_000, freeBytes: 24_000 },
  cpu: {
    cores: 8,
    mean: 10,
    mean1m: 11.1,
    mean2m: 10.5,
    mean3m: 10.2,
    p10: 9,
    p25: 9.5,
    p75: 10.5,
    p90: 11,
  },
};

const fakeSessions = (jobs: Effect.Effect<number>) =>
  Layer.succeed(Sessions.Sessions)(
    Sessions.Sessions.of({
      reserve: () => Effect.die("Unexpected Sessions.reserve"),
      run: () => Effect.die("Unexpected Sessions.run"),
      abort: () => Effect.die("Unexpected Sessions.abort"),
      shutdown: () => Effect.die("Unexpected Sessions.shutdown"),
      jobs,
    }),
  );

const start = (
  jobs: Effect.Effect<number>,
  usage: Effect.Effect<ProcessUsage.ProcessSample, ProcessUsage.PsFailed> = Effect.succeed(SAMPLE),
) =>
  Effect.gen(function* () {
    const servers = TestingStores.fakeServerStore();
    const process = TestingStores.fakeProcessStatsStore();
    const log = TestingLog.fakeLog();
    const scope = yield* Scope.make();
    yield* Heartbeat.announce(URL, NAME).pipe(
      Effect.provide(
        Layer.mergeAll(
          fakeSessions(jobs),
          Layer.succeed(Host.Host)(Host.Host.of({ collect: Effect.succeed(HOST) })),
          Layer.succeed(ProcessUsage.ProcessUsage)(
            ProcessUsage.ProcessUsage.of({ collect: usage }),
          ),
          servers.layer,
          process.layer,
          log.layer,
        ),
      ),
      Scope.provide(scope),
    );
    return { scope, servers, process, log };
  });

describe("automation-client heartbeat happy path", () => {
  it.effect(
    "announces an automation-client member with no guests, the host's values, and its sessions as jobs",
    () =>
      Effect.gen(function* () {
        let jobs = 1;
        const { servers, process, log } = yield* start(Effect.sync(() => jobs));
        expect(servers.heartbeats).toEqual([
          {
            url: URL,
            type: "automation-client",
            name: NAME,
            stats: {
              qemus: 0,
              memory: { totalBytes: 32_000, usedBytes: 8_000 },
              cpu: { mean1m: 11.1, mean2m: 10.5, mean3m: 10.2 },
            },
          },
        ]);
        jobs = 3;
        yield* TestClock.adjust("30 seconds");
        expect(process.reports).toEqual([
          { name: NAME, type: "automation-client", stats: { jobs: 1, ...SAMPLE } },
          { name: NAME, type: "automation-client", stats: { jobs: 3, ...SAMPLE } },
        ]);
        expect(log.lines).toEqual([]);
      }),
  );
});

describe("automation-client heartbeat unhappy path", () => {
  it.effect(
    "a failing process read is PsFailed on one line under the client's attribution; the servers row still lands",
    () =>
      Effect.gen(function* () {
        const unlisted = ProcessUsage.PsFailed.make({
          message: "ps did not list this process (pid 500)",
        });
        const { servers, process, log } = yield* start(Effect.succeed(0), Effect.fail(unlisted));
        expect(servers.heartbeats).toHaveLength(1);
        expect(process.reports).toEqual([]);
        expect(log.lines).toEqual([
          {
            level: "error",
            text: "process stats failed: ps did not list this process (pid 500)",
            location: "automation-client",
            agentId: undefined,
            skipSentry: false,
            cause: unlisted,
          },
        ]);
      }),
  );
});
