import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Console, Deferred, Effect, ErrorReporter, Fiber, Layer, type LogLevel } from "effect";
import { TestConsole } from "effect/testing";
import * as DbErrors from "@oligarchy/db/errors";
import * as Logs from "@oligarchy/db/logs";
import * as Log from "@oligarchy/log/log";
import * as Observability from "../src/log.ts";

const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";

const ESC = String.fromCharCode(27);
const sgr = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const plain = (line: unknown): string => String(line).replace(sgr, "");
const consoleLines = Effect.map(TestConsole.logLines, (lines) => lines.map(plain));

type Row = Parameters<typeof Logs.LogStore.Service.insertLog>[0];

// A LogStore that keeps the rows it was asked to insert once the insert lands; the only method
// the row-writing log calls.
const fakeLogStore = (
  insertLog: (row: Row) => Effect.Effect<void, DbErrors.DatabaseError> = () => Effect.void,
) => {
  const rows: Array<Row> = [];
  const layer = Layer.succeed(Logs.LogStore)(
    Logs.LogStore.of({
      insertLog: (row) =>
        insertLog(row).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              rows.push(row);
            }),
          ),
        ),
      listLogs: () => Effect.die("Unexpected LogStore.listLogs"),
      listRecent: () => Effect.die("Unexpected LogStore.listRecent"),
      listIntents: () => Effect.die("Unexpected LogStore.listIntents"),
    }),
  );
  return { rows, layer };
};

type Reported = { readonly error: Error; readonly severity: LogLevel.Severity };

const collect = () => {
  const reported: Array<Reported> = [];
  const reporter = ErrorReporter.make(({ error, severity }) => {
    reported.push({ error, severity });
  });
  return { reported, layer: ErrorReporter.layer([reporter]) };
};

const live = (store: ReturnType<typeof fakeLogStore>, reporter = collect()) =>
  Observability.LogLive.pipe(Layer.provide(store.layer), Layer.provide(reporter.layer));

describe("LogLive", () => {
  it.effect(
    "inserts rows in call order across interleaved fibers, each line after its row (happy)",
    () =>
      Effect.gen(function* () {
        const store = fakeLogStore();
        const reporter = collect();
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
        }).pipe(Effect.provide(live(store, reporter)));
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

  it.effect("writes a global row with null attribution (happy)", () =>
    Effect.gen(function* () {
      const store = fakeLogStore();
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.warning("follower dropped; 64 events behind");
        yield* log.flush;
      }).pipe(Effect.provide(live(store)));
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
  it.effect(
    "no line appears before its row has landed, and flush waits for the last line (happy)",
    () =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const store = fakeLogStore(() => Deferred.await(gate));
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
        }).pipe(Effect.provide(live(store)));
      }),
  );

  it.effect(
    "a refused row still writes its line, then the failure, then reports it, and the rows behind it land (unhappy)",
    () =>
      Effect.gen(function* () {
        // One timeline for inserts, lines and reports, so the order between them is what is pinned.
        const timeline: Array<string> = [];
        const store = fakeLogStore((row) => {
          if (row.text === "bad") {
            return Effect.fail(
              DbErrors.DatabaseError.make({
                operation: "insertLog",
                message: "Failed query: insert into logs",
                cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
              }),
            );
          }
          timeline.push(`insert:${row.text}`);
          return Effect.void;
        });
        // The ambient TestConsole with its `log` noted: prototype delegation, so every other method
        // stays the TestConsole's own.
        const ambient = yield* Console.Console;
        const noting: Console.Console = Object.assign(Object.create(ambient), {
          log: (...parameters: ReadonlyArray<unknown>) => {
            timeline.push(`line:${plain(parameters[0])}`);
            ambient.log(...parameters);
          },
        });
        const reporter = ErrorReporter.make(({ error }) => {
          timeline.push(`report:${error.message}`);
        });
        yield* Effect.gen(function* () {
          const log = yield* Log.Log;
          yield* log.info("good 1");
          yield* log.info("bad");
          yield* log.info("good 2");
          yield* log.flush;
        }).pipe(
          Effect.provide(
            Observability.LogLive.pipe(
              Layer.provide(store.layer),
              Layer.provide(ErrorReporter.layer([reporter])),
              Layer.provide(Layer.succeed(Console.Console)(noting)),
            ),
          ),
        );
        expect(store.rows.map((row) => row.text)).toEqual(["good 1", "good 2"]);
        expect(timeline).toEqual([
          "insert:good 1",
          "line:[INFO] [global] good 1",
          "line:[INFO] [global] bad",
          "line:[ERROR] [global] db: log insert failed: connect ECONNREFUSED 127.0.0.1:5432",
          "report:Failed query: insert into logs",
          "insert:good 2",
          "line:[INFO] [global] good 2",
        ]);
      }),
  );

  it.effect("a refused row without a nested cause prints the error's own message (unhappy)", () =>
    Effect.gen(function* () {
      const store = fakeLogStore(() =>
        Effect.fail(DbErrors.DatabaseError.make({ operation: "insertLog", message: "pool ended" })),
      );
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.info("x");
        yield* log.flush;
      }).pipe(Effect.provide(live(store)));
      expect(yield* consoleLines).toEqual([
        "[INFO] [global] x",
        "[ERROR] [global] db: log insert failed: pool ended",
      ]);
    }),
  );

  it.effect("the layer flushes before it is released (happy)", () =>
    Effect.gen(function* () {
      const store = fakeLogStore(() => Effect.yieldNow);
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.info("one");
        yield* log.info("two");
      }).pipe(Effect.provide(live(store)));
      expect(store.rows.map((row) => row.text)).toEqual(["one", "two"]);
      expect(yield* consoleLines).toEqual(["[INFO] [global] one", "[INFO] [global] two"]);
    }),
  );
});
