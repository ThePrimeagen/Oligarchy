import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import * as Servers from "../../src/db/servers.ts";
import * as Log from "../../src/observability/log.ts";
import * as MaxJobs from "../../src/shared/max-jobs.ts";
import * as FakeLog from "../support/log.ts";
import * as Stores from "../support/stores.ts";

const URL = "http://127.0.0.1:55332";
const MAX_JOBS = 4;

const ROW_STATS = {
  qemus: 0,
  memory: { totalBytes: 1, usedBytes: 0 },
  cpu: { mean1m: 0, mean2m: 0, mean3m: 0 },
};

const capacity = (initial: number): Effect.Effect<MaxJobs.Capacity> =>
  Effect.gen(function* () {
    const limit = yield* Ref.make(initial);
    return {
      maxJobs: Ref.get(limit),
      setMaxJobs: (next: number) => Ref.set(limit, next),
    };
  });

const withStore = <A, E, R>(
  store: Stores.FakeServerStore,
  body: Effect.Effect<A, E, R | Servers.ServerStore>,
) => body.pipe(Effect.provide(store.layer));

describe("max-jobs follow happy path", () => {
  it.effect("adjusts Sessions when the database max_jobs changes after a minute", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = Stores.fakeServerStore();
        const log = FakeLog.fakeLog();
        yield* withStore(
          store,
          Effect.gen(function* () {
            const serverStore = yield* Servers.ServerStore;
            yield* serverStore.heartbeat(URL, "qemu", "garage", ROW_STATS, MAX_JOBS);
          }),
        );
        const cap = yield* capacity(MAX_JOBS);
        yield* MaxJobs.follow(URL, cap, { location: Log.Locations.server }).pipe(
          Effect.provide(Layer.mergeAll(store.layer, log.layer)),
        );
        expect(yield* cap.maxJobs).toBe(MAX_JOBS);
        yield* withStore(
          store,
          Effect.gen(function* () {
            yield* (yield* Servers.ServerStore).setMaxJobs(URL, 8);
          }),
        );
        yield* TestClock.adjust(MaxJobs.INTERVAL);
        expect(yield* cap.maxJobs).toBe(8);
        expect(log.lines).toEqual([
          expect.objectContaining({ level: "info", text: "max-jobs set to 8" }),
        ]);
      }),
    ),
  );
});

describe("max-jobs follow unhappy path", () => {
  it.effect("leaves the limit alone when maxJobsFor is none", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = Stores.fakeServerStore();
        const log = FakeLog.fakeLog();
        const cap = yield* capacity(MAX_JOBS);
        yield* MaxJobs.follow(URL, cap, { location: Log.Locations.server }).pipe(
          Effect.provide(Layer.mergeAll(store.layer, log.layer)),
        );
        yield* TestClock.adjust(MaxJobs.INTERVAL);
        expect(yield* cap.maxJobs).toBe(MAX_JOBS);
      }),
    ),
  );

  it.effect("a failed read is one error line and the next tick still runs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = Stores.fakeServerStore({
          maxJobsFor: () => Effect.die("database down"),
        });
        const log = FakeLog.fakeLog();
        const cap = yield* capacity(MAX_JOBS);
        yield* MaxJobs.follow(URL, cap, { location: Log.Locations.server }).pipe(
          Effect.provide(Layer.mergeAll(store.layer, log.layer)),
        );
        yield* TestClock.adjust(MaxJobs.INTERVAL);
        expect(yield* cap.maxJobs).toBe(MAX_JOBS);
        expect(log.lines.length).toBeGreaterThanOrEqual(1);
        expect(log.lines.every((line) => line.level === "error")).toBe(true);
        expect(log.lines[0]).toMatchObject({
          level: "error",
          text: expect.stringContaining("max-jobs follow failed"),
        });
      }),
    ),
  );
});
