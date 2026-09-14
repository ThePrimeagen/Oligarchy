import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as StaleServers from "../../src/qemu-reverse-proxy/stale-servers.ts";
import type * as Servers from "../../src/db/servers.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeLog from "../support/log.ts";
import * as Stores from "../support/stores.ts";

const DEAD = "http://127.0.0.1:1";
const TYPO = "http://127.0.0.1:2";

const forgotten = (url: string) => ({
  level: "info",
  text: `server forgotten; ${url} silent for 10 minutes`,
  location: "server",
  agentId: undefined,
  skipSentry: false,
  cause: undefined,
});

const refused = Errors.DatabaseError.make({
  operation: "removeStaleServers",
  message: "Failed query: delete from servers",
  cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
});

// The loop in a scope of its own, so a test can close it and prove the ticking stops.
const start = (store: Stores.FakeServerStore, log = FakeLog.fakeLog()) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* StaleServers.forget.pipe(
      Effect.provide(Layer.mergeAll(store.layer, log.layer)),
      Scope.provide(scope),
    );
    return { scope, log };
  });

// A store whose sweep answers `answers` in order and nothing after, recording the kinds asked for.
const sweeping = (answers: ReadonlyArray<Array<string>>) => {
  const asked: Array<Servers.ServerType> = [];
  const store = Stores.fakeServerStore({
    removeStaleServers: (type) =>
      Effect.sync(() => {
        asked.push(type);
        return answers[asked.length - 1] ?? [];
      }),
  });
  return { store, asked };
};

describe("stale servers happy path", () => {
  it.effect(
    "forgets the qemu servers silent for ten minutes at once and every thirty seconds, one info line each",
    () =>
      Effect.gen(function* () {
        const { store, asked } = sweeping([[DEAD, TYPO], [], ["http://127.0.0.1:3"]]);
        const { log } = yield* start(store);
        expect(asked).toEqual(["qemu"]);
        expect(log.lines).toEqual([forgotten(DEAD), forgotten(TYPO)]);
        yield* TestClock.adjust("29 seconds");
        expect(asked).toHaveLength(1);
        yield* TestClock.adjust("1 second");
        expect(asked).toEqual(["qemu", "qemu"]);
        expect(log.lines).toHaveLength(2);
        yield* TestClock.adjust("30 seconds");
        expect(asked).toHaveLength(3);
        expect(log.lines).toEqual([
          forgotten(DEAD),
          forgotten(TYPO),
          forgotten("http://127.0.0.1:3"),
        ]);
      }),
  );

  it.effect("stops when the scope it was started in closes, without a line", () =>
    Effect.gen(function* () {
      const { store, asked } = sweeping([]);
      const { scope, log } = yield* start(store);
      yield* TestClock.adjust("30 seconds");
      expect(asked).toHaveLength(2);
      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust("90 seconds");
      expect(asked).toHaveLength(2);
      expect(log.lines).toEqual([]);
    }),
  );

  it.effect(
    "a close during a sweep in flight waits for the delete and records what it deleted",
    () =>
      Effect.gen(function* () {
        const deleting = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const store = Stores.fakeServerStore({
          removeStaleServers: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(deleting, undefined);
              yield* Deferred.await(release);
              return [DEAD];
            }),
        });
        const { scope, log } = yield* start(store);
        yield* Deferred.await(deleting);
        const closed = yield* Effect.forkChild(Scope.close(scope, Exit.void));
        yield* Effect.yieldNow;
        expect(closed.pollUnsafe()).toBeUndefined();
        expect(log.lines).toEqual([]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(closed);
        expect(log.lines).toEqual([forgotten(DEAD)]);
      }),
  );
});

describe("stale servers unhappy path", () => {
  it.effect(
    "a refused sweep is one error line with the driver's reason, and the next tick sweeps again",
    () =>
      Effect.gen(function* () {
        let sweeps = 0;
        const store = Stores.fakeServerStore({
          removeStaleServers: () =>
            Effect.suspend(() => {
              sweeps += 1;
              return sweeps === 1 ? Effect.fail(refused) : Effect.succeed([DEAD]);
            }),
        });
        const { log } = yield* start(store);
        expect(log.lines).toEqual([
          {
            level: "error",
            text: "stale server cleanup failed: connect ECONNREFUSED 127.0.0.1:5432",
            location: "server",
            agentId: undefined,
            skipSentry: false,
            cause: refused,
          },
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(sweeps).toBe(2);
        expect(log.lines).toHaveLength(2);
        expect(log.lines[1]).toEqual(forgotten(DEAD));
      }),
  );

  it.effect("a close during a sweep that then fails still records the failure", () =>
    Effect.gen(function* () {
      const deleting = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const store = Stores.fakeServerStore({
        removeStaleServers: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(deleting, undefined);
            yield* Deferred.await(release);
            return yield* Effect.fail(refused);
          }),
      });
      const { scope, log } = yield* start(store);
      yield* Deferred.await(deleting);
      const closed = yield* Effect.forkChild(Scope.close(scope, Exit.void));
      yield* Effect.yieldNow;
      expect(closed.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(closed);
      expect(log.lines).toMatchObject([
        {
          level: "error",
          text: "stale server cleanup failed: connect ECONNREFUSED 127.0.0.1:5432",
          cause: refused,
        },
      ]);
    }),
  );

  it.effect("a defect in the sweep is logged the same way, and the loop goes on", () =>
    Effect.gen(function* () {
      const boom = new Error("store exploded");
      let sweeps = 0;
      const store = Stores.fakeServerStore({
        removeStaleServers: () =>
          Effect.suspend(() => {
            sweeps += 1;
            return sweeps === 1 ? Effect.die(boom) : Effect.succeed([]);
          }),
      });
      const { log } = yield* start(store);
      expect(log.lines).toMatchObject([
        { level: "error", text: "stale server cleanup failed: store exploded", cause: boom },
      ]);
      yield* TestClock.adjust("30 seconds");
      expect(sweeps).toBe(2);
      expect(log.lines).toHaveLength(1);
    }),
  );
});
