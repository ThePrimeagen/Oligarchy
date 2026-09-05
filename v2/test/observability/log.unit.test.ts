import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestConsole } from "effect/testing";
import * as Log from "../../src/observability/log.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as Reporter from "../support/reporter.ts";
import * as Stores from "../support/stores.ts";

const AGENT_ID = "OLI-61";
const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";

const ESC = String.fromCharCode(27);
const sgr = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const ticketStart = new RegExp(`^${ESC}\\[37m\\[${ESC}\\[39m(${ESC}\\[[0-9;]+m)`);

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
              yield* log.info(`${agentId} line ${n}`, { agentId, sessionId: SESSION_ID });
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
        sessionId: SESSION_ID,
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
          sessionId: null,
          agentId: null,
        },
      ]);
      expect(yield* consoleLines).toEqual(["[global] warning: follower dropped; 64 events behind"]);
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
        "[global] good 1",
        "[global] bad",
        "[global] good 2",
        "[global] error: db: log insert failed: connect ECONNREFUSED 127.0.0.1:5432",
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
        "[global] x",
        "[global] error: db: log insert failed: pool ended",
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
      expect(yield* consoleLines).toEqual(["[OLI-61] hello"]);
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
          sessionId: SESSION_ID,
          agentId: AGENT_ID,
          cause,
        });
      }).pipe(Effect.provide(Log.Log.layerStdout.pipe(Layer.provide(reporter.layer))));
      expect(reporter.reported).toHaveLength(1);
      const [report] = reporter.reported;
      expect(report?.error.message).toBe("connect ECONNREFUSED");
      expect(report?.annotations).toEqual({
        session_id: SESSION_ID,
        agent_id: AGENT_ID,
        log: "stop cleanup failed: connect ECONNREFUSED",
      });
      expect(yield* consoleLines).toEqual([
        `[OLI-61] ${SESSION_ID}: error: stop cleanup failed: connect ECONNREFUSED`,
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
      expect(yield* consoleLines).toEqual(["[global] error: POST /stop failed: unauthorized"]);
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
      expect(report?.error.name).toBe("@oligarchy/observability/log/LogLine");
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
        yield* log.error("timeout cleanup failed: boom", { sessionId: SESSION_ID });
      }).pipe(Effect.provide(Log.Log.layerStdout.pipe(Layer.provide(reporter.layer))));
      expect(reporter.reported[0]?.severity).toBe("Error");
      expect(reporter.reported[0]?.annotations).toEqual({
        session_id: SESSION_ID,
        log: "timeout cleanup failed: boom",
      });
    }),
  );
});

describe("Log colours", () => {
  const colored = Log.Log.layerStdout.pipe(Layer.provide(Layer.succeed(Log.Colors)(true)));

  const ticket = (line: string): string => ticketStart.exec(line)?.[1] ?? "";

  it.effect("gives two agents different colours and the first agent Rose Pine love", () =>
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.acquireColor("A");
      yield* log.acquireColor("B");
      yield* log.info("a", { agentId: "A" });
      yield* log.info("b", { agentId: "B" });
      yield* log.info("a again", { agentId: "A" });
      const lines = (yield* TestConsole.logLines).map(String);
      expect(ticket(lines[0] ?? "")).toBe("\x1b[38;2;235;111;146m");
      expect(ticket(lines[1] ?? "")).toBe("\x1b[38;2;246;193;119m");
      expect(ticket(lines[2] ?? "")).toBe("\x1b[38;2;235;111;146m");
    }).pipe(Effect.provide(colored)),
  );

  it.effect("releaseColor frees a colour for reuse once the palette is exhausted", () =>
    Effect.gen(function* () {
      const log = yield* Log.Log;
      const agents = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
      for (const agent of agents) {
        yield* log.acquireColor(agent);
        yield* log.info("x", { agentId: agent });
      }
      const lines = (yield* TestConsole.logLines).map(String);
      expect(new Set(lines.map(ticket)).size).toBe(10);
      yield* log.releaseColor("C");
      yield* log.acquireColor("K");
      yield* log.info("y", { agentId: "K" });
      const after = (yield* TestConsole.logLines).map(String);
      expect(ticket(after[10] ?? "")).toBe(ticket(lines[2] ?? ""));
    }).pipe(Effect.provide(colored)),
  );

  it.effect("an agent without a session renders gray global-style brackets", () =>
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.info("hello");
      const lines = (yield* TestConsole.logLines).map(String);
      expect(lines[0]).toBe("\x1b[37m[\x1b[39m\x1b[90mglobal\x1b[39m\x1b[37m] hello\x1b[39m");
    }).pipe(Effect.provide(colored)),
  );

  it.effect("an agent id that never acquired a colour stays gray and takes no palette slot", () =>
    Effect.gen(function* () {
      const log = yield* Log.Log;
      yield* log.error("POST /start failed: nope", { agentId: "OLI-999", skipSentry: true });
      yield* log.acquireColor("A");
      yield* log.info("a", { agentId: "A" });
      const lines = (yield* TestConsole.logLines).map(String);
      expect(ticket(lines[0] ?? "")).toBe("\x1b[90m");
      expect(ticket(lines[1] ?? "")).toBe("\x1b[38;2;235;111;146m");
    }).pipe(Effect.provide(colored)),
  );
});
