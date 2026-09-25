import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock, TestConsole } from "effect/testing";
import * as Log from "../../src/observability/log.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as Reporter from "../support/reporter.ts";
import * as Stores from "../support/stores.ts";

const AGENT_ID = "OLI-61";
const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";

const ESC = String.fromCharCode(27);
const sgr = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

const plain = (line: unknown): string => String(line).replace(sgr, "");

const consoleLines = Effect.map(TestConsole.logLines, (lines) => lines.map(plain));

describe("Log rows", () => {
  it.effect("inserts rows in call order across interleaved fibers", () =>
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
          Log.Log.layer.pipe(Layer.provide(store.layer), Layer.provide(reporter.layer)),
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
      }).pipe(Effect.provide(Log.Log.layer.pipe(Layer.provide(store.layer))));
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

  it.effect("a failed insert prints the cause, reports it and never fails the caller", () =>
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
          Log.Log.layer.pipe(Layer.provide(store.layer), Layer.provide(reporter.layer)),
        ),
      );
      expect(store.rows.map((row) => row.text)).toEqual(["good 1", "good 2"]);
      expect(yield* consoleLines).toEqual([
        "[INFO] [global] good 1",
        "[INFO] [global] bad",
        "[INFO] [global] good 2",
        "[ERROR] [global] db: log insert failed: connect ECONNREFUSED 127.0.0.1:5432",
      ]);
      expect(reporter.reported).toHaveLength(1);
      expect(reporter.reported[0]?.error.message).toBe("Failed query: insert into logs");
    }),
  );

  it.effect("a failed insert without a nested cause prints the error's own message", () =>
    Effect.gen(function* () {
      const store = Stores.fakeLogStore({
        insertLog: () =>
          Effect.fail(Errors.DatabaseError.make({ operation: "insertLog", message: "pool ended" })),
      });
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.info("x");
        yield* log.flush;
      }).pipe(Effect.provide(Log.Log.layer.pipe(Layer.provide(store.layer))));
      expect(yield* consoleLines).toEqual([
        "[INFO] [global] x",
        "[ERROR] [global] db: log insert failed: pool ended",
      ]);
    }),
  );

  it.effect("flush waits for outstanding rows", () =>
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
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(flushing);
        expect(store.rows.map((row) => row.text)).toEqual(["slow"]);
      }).pipe(Effect.provide(Log.Log.layer.pipe(Layer.provide(store.layer))));
    }),
  );

  it.effect("the layer flushes before it is released", () =>
    Effect.gen(function* () {
      const store = Stores.fakeLogStore({ insertLog: () => Effect.yieldNow });
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.info("one");
        yield* log.info("two");
      }).pipe(Effect.provide(Log.Log.layer.pipe(Layer.provide(store.layer))));
      expect(store.rows.map((row) => row.text)).toEqual(["one", "two"]);
    }),
  );

  it.effect("layerStdout writes lines and flush resolves at once", () =>
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.info("hello", { agentId: AGENT_ID });
      yield* log.flush;
      expect(yield* consoleLines).toEqual(["[INFO] [OLI-61] hello"]);
    }).pipe(Effect.provide(Log.Log.layerStdout)),
  );
});

describe("Log Sentry policy", () => {
  it.effect("error reports the cause with session and agent tags", () =>
    Effect.gen(function* () {
      const reporter = Reporter.collect();
      const cause = new Error("connect ECONNREFUSED");
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.error("stop cleanup failed: connect ECONNREFUSED", {
          location: SESSION_ID,
          agentId: AGENT_ID,
          cause,
        });
      }).pipe(Effect.provide(Log.Log.layerStdout.pipe(Layer.provide(reporter.layer))));
      expect(reporter.reported).toHaveLength(1);
      const [report] = reporter.reported;
      expect(report?.error.name).toBe(Errors.LogLine.identifier);
      expect(report?.error.message).toBe("stop cleanup failed: connect ECONNREFUSED");
      expect(report?.error.cause).toMatchObject({ message: "connect ECONNREFUSED" });
      expect(report?.severity).toBe("Error");
      expect(report?.annotations).toEqual({
        location: SESSION_ID,
        agent_id: AGENT_ID,
        log: "stop cleanup failed: connect ECONNREFUSED",
      });
      expect(yield* consoleLines).toEqual([
        `[ERROR] [OLI-61] ${SESSION_ID}: stop cleanup failed: connect ECONNREFUSED`,
      ]);
    }),
  );

  it.effect("fatal with a cause reports the line at Fatal with the cause on it", () =>
    Effect.gen(function* () {
      const reporter = Reporter.collect();
      const cause = Errors.DatabaseError.make({
        operation: "ping",
        message: "database unreachable: connect ECONNREFUSED 127.0.0.1:5432",
        cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      });
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.fatal("proxy: database unreachable: connect ECONNREFUSED 127.0.0.1:5432", {
          cause,
        });
      }).pipe(Effect.provide(Log.Log.layerStdout.pipe(Layer.provide(reporter.layer))));
      expect(reporter.reported).toHaveLength(1);
      const [report] = reporter.reported;
      expect(report?.severity).toBe("Fatal");
      expect(report?.error.message).toBe(
        "proxy: database unreachable: connect ECONNREFUSED 127.0.0.1:5432",
      );
      expect(report?.error.cause).toMatchObject({
        _tag: "DatabaseError",
        message: "database unreachable: connect ECONNREFUSED 127.0.0.1:5432",
      });
      expect(yield* consoleLines).toEqual([
        "[FATAL] [global] proxy: database unreachable: connect ECONNREFUSED 127.0.0.1:5432",
      ]);
    }),
  );

  it.effect("error with skipSentry reports nothing", () =>
    Effect.gen(function* () {
      const reporter = Reporter.collect();
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.error("POST /stop failed: unauthorized", { skipSentry: true });
      }).pipe(Effect.provide(Log.Log.layerStdout.pipe(Layer.provide(reporter.layer))));
      expect(reporter.reported).toHaveLength(0);
      expect(yield* consoleLines).toEqual(["[ERROR] [global] POST /stop failed: unauthorized"]);
    }),
  );

  it.effect("info and warning never report", () =>
    Effect.gen(function* () {
      const reporter = Reporter.collect();
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.info("running");
        yield* log.warning("iso: heartbeat failed: EACCES");
      }).pipe(Effect.provide(Log.Log.layerStdout.pipe(Layer.provide(reporter.layer))));
      expect(reporter.reported).toHaveLength(0);
    }),
  );

  it.effect("fatal without a cause reports a LogLine whose message is the text", () =>
    Effect.gen(function* () {
      const reporter = Reporter.collect();
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.fatal("proxy: missing host requirements:\nqemu-system-x86_64 not on PATH");
      }).pipe(Effect.provide(Log.Log.layerStdout.pipe(Layer.provide(reporter.layer))));
      expect(reporter.reported).toHaveLength(1);
      const [report] = reporter.reported;
      expect(report?.error.message).toBe(
        "proxy: missing host requirements:\nqemu-system-x86_64 not on PATH",
      );
      expect(report?.error.name).toBe(Errors.LogLine.identifier);
      expect(report?.error.cause).toBeUndefined();
      expect(report?.severity).toBe("Fatal");
      expect(report?.annotations).toEqual({
        log: "proxy: missing host requirements:\nqemu-system-x86_64 not on PATH",
      });
    }),
  );

  it.effect("error without a cause reports at Error severity", () =>
    Effect.gen(function* () {
      const reporter = Reporter.collect();
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.error("timeout cleanup failed: boom", { location: SESSION_ID });
      }).pipe(Effect.provide(Log.Log.layerStdout.pipe(Layer.provide(reporter.layer))));
      expect(reporter.reported[0]?.severity).toBe("Error");
      expect(reporter.reported[0]?.annotations).toEqual({
        location: SESSION_ID,
        log: "timeout cleanup failed: boom",
      });
    }),
  );
});

describe("Log colours", () => {
  const colored = Log.Log.layerStdout.pipe(Layer.provide(Layer.succeed(Log.Colors)(true)));

  // The colour sequence written right before the ticket.
  const ticket = (line: string | undefined, agent: string): string =>
    new RegExp(`(${ESC}\\[[0-9;]+m)${agent}${ESC}`).exec(line ?? "")?.[1] ?? "";
  const printed = Effect.map(TestConsole.logLines, (lines) => lines.map(String));

  it.effect("a ticket takes a colour on its first line and keeps it, with nothing to acquire", () =>
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.info("a", { agentId: "OLI-1" });
      yield* log.error("b", { agentId: "OLI-2", skipSentry: true });
      yield* log.info("a again", { agentId: "OLI-1" });
      const lines = yield* printed;
      expect(ticket(lines[0], "OLI-1")).not.toBe("");
      expect(ticket(lines[2], "OLI-1")).toBe(ticket(lines[0], "OLI-1"));
      expect(ticket(lines[1], "OLI-2")).not.toBe(ticket(lines[0], "OLI-1"));
    }).pipe(Effect.provide(colored)),
  );

  it.effect("a ticket idle for an hour gives its colour up at the hourly trim", () =>
    Effect.gen(function* () {
      const log = yield* Log.Log;
      const agents = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
      for (const agent of agents) {
        yield* log.info("x", { agentId: agent });
      }
      const first = yield* printed;
      expect(new Set(agents.map((agent, index) => ticket(first[index], agent))).size).toBe(10);
      yield* TestClock.adjust("30 minutes");
      for (const agent of agents.filter((other) => other !== "C")) {
        yield* log.info("y", { agentId: agent });
      }
      yield* TestClock.adjust("31 minutes");
      yield* log.info("z", { agentId: "K" });
      const lines = yield* printed;
      expect(ticket(lines.at(-1), "K")).toBe(ticket(first[2], "C"));
    }).pipe(Effect.provide(colored)),
  );

  it.effect(
    "a ticket back after an idle hour takes a new colour; one seen within the hour keeps its own (unhappy)",
    () =>
      Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.info("a", { agentId: "A" });
        yield* log.info("b", { agentId: "B" });
        yield* TestClock.adjust("50 minutes");
        yield* log.info("a", { agentId: "A" });
        yield* TestClock.adjust("11 minutes");
        yield* log.info("b", { agentId: "B" });
        yield* log.info("a", { agentId: "A" });
        const lines = yield* printed;
        expect(ticket(lines[4], "A")).toBe(ticket(lines[0], "A"));
        expect(ticket(lines[3], "B")).not.toBe(ticket(lines[1], "B"));
      }).pipe(Effect.provide(colored)),
  );
});
