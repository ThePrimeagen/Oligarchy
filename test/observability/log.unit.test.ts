import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestConsole } from "effect/testing";
import * as Log from "@oligarchy/log/log";
import * as RowLog from "../../src/observability/log.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as Reporter from "../support/reporter.ts";
import * as Stores from "../support/stores.ts";

const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";

const ESC = String.fromCharCode(27);
const sgr = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

const plain = (line: unknown): string => String(line).replace(sgr, "");

const consoleLines = Effect.map(TestConsole.logLines, (lines) => lines.map(plain));

describe("Log rows", () => {
  it.effect("inserts rows in call order across interleaved fibers, each line after its row", () =>
    Effect.gen(function* () {
      const store = Stores.fakeLogStore();
      const reporter = Reporter.collect();
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        const worker = (agentId: string) =>
          Effect.gen(function* () {
            for (const n of [1, 2, 3]) {
              yield* log.info(`${agentId} line ${n}`, { agentId, location: SESSION_ID });
              yield* Effect.yieldNow;
            }
          });
        yield* Effect.all([worker("A"), worker("B"), worker("C")], { concurrency: "unbounded" });
        yield* log.flush;
      }).pipe(
        Effect.provide(
          RowLog.layer.pipe(Layer.provide(store.layer), Layer.provide(reporter.layer)),
        ),
      );
      const printed = (yield* consoleLines).map((line) => line.slice(line.indexOf(": ") + 2));
      expect(store.rows.map((row) => row.text)).toEqual(printed);
      expect(store.rows).toHaveLength(9);
      expect(store.rows[0]).toEqual({
        text: "A line 1",
        level: "info",
        location: SESSION_ID,
        agentId: "A",
      });
      expect(reporter.reported).toHaveLength(0);
    }),
  );

  it.effect("writes a global row with null attribution", () =>
    Effect.gen(function* () {
      const store = Stores.fakeLogStore();
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.warning("follower dropped; 64 events behind");
        yield* log.flush;
      }).pipe(Effect.provide(RowLog.layer.pipe(Layer.provide(store.layer))));
      expect(store.rows).toEqual([
        {
          text: "follower dropped; 64 events behind",
          level: "warning",
          location: null,
          agentId: null,
        },
      ]);
      expect(yield* consoleLines).toEqual(["[WARN] [global] follower dropped; 64 events behind"]);
    }),
  );

  // The row is the record and stdout its copy, so the copy follows the record.
  it.effect("the line follows its row: nothing is printed until the insert lands", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const store = Stores.fakeLogStore({ insertLog: () => Deferred.await(gate) });
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.info("slow");
        const flushing = yield* Effect.forkChild(log.flush);
        yield* Effect.yieldNow;
        expect(flushing.pollUnsafe()).toBeUndefined();
        expect(store.rows).toHaveLength(0);
        expect(yield* consoleLines).toEqual([]);
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(flushing);
        expect(store.rows.map((row) => row.text)).toEqual(["slow"]);
        expect(yield* consoleLines).toEqual(["[INFO] [global] slow"]);
      }).pipe(Effect.provide(RowLog.layer.pipe(Layer.provide(store.layer))));
    }),
  );

  it.effect(
    "a refused row still prints its line, then the failure, reports it, and never fails the caller (unhappy)",
    () =>
      Effect.gen(function* () {
        const store = Stores.fakeLogStore({
          insertLog: (row) =>
            row.text === "bad"
              ? Effect.fail(
                  Errors.DatabaseError.make({
                    operation: "insertLog",
                    message: "Failed query: insert into logs",
                    cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
                  }),
                )
              : Effect.void,
        });
        const reporter = Reporter.collect();
        yield* Effect.gen(function* () {
          const log = yield* Log.Log;
          yield* log.info("good 1");
          yield* log.info("bad");
          yield* log.info("good 2");
          yield* log.flush;
        }).pipe(
          Effect.provide(
            RowLog.layer.pipe(Layer.provide(store.layer), Layer.provide(reporter.layer)),
          ),
        );
        expect(store.rows.map((row) => row.text)).toEqual(["good 1", "good 2"]);
        expect(yield* consoleLines).toEqual([
          "[INFO] [global] good 1",
          "[INFO] [global] bad",
          "[ERROR] [global] db: log insert failed: connect ECONNREFUSED 127.0.0.1:5432",
          "[INFO] [global] good 2",
        ]);
        expect(reporter.reported).toHaveLength(1);
        expect(reporter.reported[0]?.error.message).toBe("Failed query: insert into logs");
      }),
  );

  it.effect("a refused row without a nested cause prints the error's own message (unhappy)", () =>
    Effect.gen(function* () {
      const store = Stores.fakeLogStore({
        insertLog: () =>
          Effect.fail(Errors.DatabaseError.make({ operation: "insertLog", message: "pool ended" })),
      });
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.info("x");
        yield* log.flush;
      }).pipe(Effect.provide(RowLog.layer.pipe(Layer.provide(store.layer))));
      expect(yield* consoleLines).toEqual([
        "[INFO] [global] x",
        "[ERROR] [global] db: log insert failed: pool ended",
      ]);
    }),
  );

  it.effect("the layer flushes before it is released", () =>
    Effect.gen(function* () {
      const store = Stores.fakeLogStore({ insertLog: () => Effect.yieldNow });
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.info("one");
        yield* log.info("two");
      }).pipe(Effect.provide(RowLog.layer.pipe(Layer.provide(store.layer))));
      expect(store.rows.map((row) => row.text)).toEqual(["one", "two"]);
      expect(yield* consoleLines).toEqual(["[INFO] [global] one", "[INFO] [global] two"]);
    }),
  );
});
