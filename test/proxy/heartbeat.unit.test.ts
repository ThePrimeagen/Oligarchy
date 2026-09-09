import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as Heartbeat from "../../src/proxy/heartbeat.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeSessions from "../support/fake-sessions.ts";
import * as FakeLog from "../support/log.ts";
import * as Stores from "../support/stores.ts";

const URL = "http://127.0.0.1:55332";

// What FakeSessions.STATS says, cut down to what the row keeps.
const ROW_STATS = {
  qemus: 1,
  memory: { totalBytes: 16_000, usedBytes: 4_000 },
  cpu: { mean1m: 22.3, mean2m: 21.4, mean3m: 20.9 },
};

const refused = Errors.DatabaseError.make({
  operation: "heartbeat",
  message: "Failed query: insert into servers",
  cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
});

// The loop in a scope of its own, so a test can close it and prove the ticking stops.
const start = (store: Stores.FakeServerStore, log = FakeLog.fakeLog()) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* Heartbeat.announce(URL).pipe(
      Effect.provide(Layer.mergeAll(FakeSessions.fakeSessions().layer, store.layer, log.layer)),
      Scope.provide(scope),
    );
    return { scope, log };
  });

describe("heartbeat happy path", () => {
  it.effect("writes the row at once and then every thirty seconds with the server's stats", () =>
    Effect.gen(function* () {
      const store = Stores.fakeServerStore();
      const { log } = yield* start(store);
      expect(store.heartbeats).toEqual([{ url: URL, stats: ROW_STATS }]);
      yield* TestClock.adjust("29 seconds");
      expect(store.heartbeats).toHaveLength(1);
      yield* TestClock.adjust("1 second");
      expect(store.heartbeats).toHaveLength(2);
      yield* TestClock.adjust("60 seconds");
      expect(store.heartbeats).toHaveLength(4);
      expect(store.heartbeats.every((beat) => beat.url === URL)).toBe(true);
      expect(log.lines).toEqual([]);
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
});

describe("heartbeat unhappy path", () => {
  it.effect(
    "a refused write is one error line with the driver's reason, and the next tick still writes",
    () =>
      Effect.gen(function* () {
        let attempts = 0;
        const written: Array<{ readonly url: string; readonly stats: typeof ROW_STATS }> = [];
        const store = Stores.fakeServerStore({
          heartbeat: (url, stats) =>
            Effect.suspend(() => {
              attempts += 1;
              if (attempts === 1) {
                return Effect.fail(refused);
              }
              written.push({ url, stats });
              return Effect.void;
            }),
        });
        const { log } = yield* start(store);
        expect(written).toEqual([]);
        expect(log.lines).toEqual([
          {
            level: "error",
            text: "heartbeat failed: connect ECONNREFUSED 127.0.0.1:5432",
            sessionId: undefined,
            agentId: undefined,
            skipSentry: false,
            cause: refused,
          },
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(written).toEqual([{ url: URL, stats: ROW_STATS }]);
        expect(log.lines).toHaveLength(1);
      }),
  );

  it.effect("a defect in a tick is logged the same way and does not end the loop", () =>
    Effect.gen(function* () {
      const boom = new Error("stats exploded");
      let attempts = 0;
      const store = Stores.fakeServerStore({
        heartbeat: () =>
          Effect.suspend(() => {
            attempts += 1;
            return attempts === 1 ? Effect.die(boom) : Effect.void;
          }),
      });
      const { log } = yield* start(store);
      expect(log.lines).toMatchObject([
        { level: "error", text: "heartbeat failed: stats exploded", cause: boom },
      ]);
      yield* TestClock.adjust("30 seconds");
      expect(attempts).toBe(2);
      expect(log.lines).toHaveLength(1);
    }),
  );
});
