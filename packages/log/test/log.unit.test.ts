import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import {
  Cause,
  Deferred,
  Effect,
  ErrorReporter,
  Fiber,
  Layer,
  type LogLevel,
  References,
  type Scope,
} from "effect";
import { TestClock, TestConsole } from "effect/testing";
import * as Errors from "../src/errors.ts";
import * as Log from "../src/log.ts";
import type * as Render from "../src/render.ts";

const AGENT_ID = "OLI-61";
const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";

const ESC = String.fromCharCode(27);
const sgr = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const plain = (line: unknown): string => String(line).replace(sgr, "");
const consoleLines = Effect.map(TestConsole.logLines, (lines) => lines.map(plain));

type Reported = {
  readonly error: Error;
  readonly severity: LogLevel.Severity;
  readonly annotations: Readonly<Record<string, unknown>>;
};

// Every report the log forwards to the current reporters, with the annotations Sentry would tag.
const collect = () => {
  const reported: Array<Reported> = [];
  const reporter = ErrorReporter.make(({ error, severity, fiber }) => {
    reported.push({ error, severity, annotations: fiber.getRef(References.CurrentLogAnnotations) });
  });
  return { reported, layer: ErrorReporter.layer([reporter]) };
};

type Offered = { readonly line: Render.Line; readonly row: Log.LogRow };

// A sink that keeps what it is offered and lets the test hold its flush; it is handed the
// `write` and `report` the log would otherwise use, so the test can prove both reach it.
const recording = (gate: Deferred.Deferred<void>) => {
  const offered: Array<Offered> = [];
  const built: Array<{
    readonly write: (line: Render.Line) => Effect.Effect<void>;
    readonly report: (cause: Cause.Cause<unknown>) => Effect.Effect<void>;
  }> = [];
  const factory = (
    write: (line: Render.Line) => Effect.Effect<void>,
    report: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
  ): Effect.Effect<Log.Sink, never, Scope.Scope> =>
    Effect.sync(() => {
      built.push({ write, report });
      return {
        offer: (line, row) =>
          Effect.sync(() => {
            offered.push({ line, row });
          }),
        flush: Deferred.await(gate),
      };
    });
  return { offered, built, layer: Log.Log.layer(factory) };
};

describe("Log.layer(sink)", () => {
  it.effect(
    "builds the sink once and hands it every line with its row, in call order, writing nothing itself",
    () =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const sink = recording(gate);
        yield* Effect.gen(function* () {
          const log = yield* Log.Log;
          yield* log.info("one", { agentId: AGENT_ID, location: SESSION_ID });
          yield* log.warning("two");
          yield* log.error("three", { skipSentry: true });
        }).pipe(Effect.provide(sink.layer));
        expect(sink.built).toHaveLength(1);
        expect(sink.offered.map((offer) => offer.row)).toEqual([
          { text: "one", level: "info", location: SESSION_ID, agentId: AGENT_ID },
          { text: "two", level: "warning", location: null, agentId: null },
          { text: "three", level: "error", location: null, agentId: null },
        ]);
        expect(sink.offered[0]?.line).toMatchObject({
          text: "one",
          level: "info",
          location: SESSION_ID,
          agentId: AGENT_ID,
        });
        expect(sink.offered[0]?.line.color).toBeDefined();
        expect(sink.offered[1]?.line).toEqual({ text: "two", level: "warning" });
        expect(yield* consoleLines).toEqual([]);
      }),
  );

  it.effect(
    "the sink's write puts a rendered line on stdout and its report reaches the current reporters",
    () =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const sink = recording(gate);
        const reporter = collect();
        yield* Effect.gen(function* () {
          yield* Log.Log;
          const [handles] = sink.built;
          expect(handles).toBeDefined();
          yield* (
            handles?.write({ text: "db: log insert failed: pool ended", level: "error" }) ??
              Effect.void
          );
          yield* handles?.report(Cause.die(new Error("pool ended"))) ?? Effect.void;
        }).pipe(Effect.provide(sink.layer.pipe(Layer.provide(reporter.layer))));
        expect(yield* consoleLines).toEqual(["[ERROR] [global] db: log insert failed: pool ended"]);
        expect(reporter.reported).toHaveLength(1);
        expect(reporter.reported[0]?.error.message).toBe("pool ended");
      }),
  );

  it.effect("flush waits for the sink's flush", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const sink = recording(gate);
      yield* Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.info("slow");
        const flushing = yield* Effect.forkChild(log.flush);
        yield* Effect.yieldNow;
        expect(flushing.pollUnsafe()).toBeUndefined();
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(flushing);
      }).pipe(Effect.provide(sink.layer));
    }),
  );

  it.effect(
    "layerStdout writes each line at once, keeps no rows, and flushes immediately (unhappy)",
    () =>
      Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.info("hello", { agentId: AGENT_ID });
        expect(yield* consoleLines).toEqual(["[INFO] [OLI-61] hello"]);
        yield* log.warning("follower dropped; 64 events behind");
        expect(yield* consoleLines).toEqual([
          "[INFO] [OLI-61] hello",
          "[WARN] [global] follower dropped; 64 events behind",
        ]);
        yield* log.flush;
      }).pipe(Effect.provide(Log.Log.layerStdout)),
  );
});

describe("Log Sentry policy", () => {
  it.effect("error reports the cause with session and agent tags", () =>
    Effect.gen(function* () {
      const reporter = collect();
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
      const reporter = collect();
      const cause = new Error("connect ECONNREFUSED 127.0.0.1:5432");
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
      expect(report?.error.cause).toMatchObject({ message: cause.message });
      expect(yield* consoleLines).toEqual([
        "[FATAL] [global] proxy: database unreachable: connect ECONNREFUSED 127.0.0.1:5432",
      ]);
    }),
  );

  it.effect("error with skipSentry reports nothing (unhappy)", () =>
    Effect.gen(function* () {
      const reporter = collect();
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
      const reporter = collect();
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
      const reporter = collect();
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
      const reporter = collect();
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

  it.effect(
    "colours are off unless the process turns them on: an unattributed line stays readable (unhappy)",
    () =>
      Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.error("database unavailable", { skipSentry: true });
        yield* log.info("listening", { agentId: AGENT_ID, location: SESSION_ID });
        const lines = yield* printed;
        expect(lines).toEqual([
          "[ERROR] [global] database unavailable",
          `[INFO] [OLI-61] ${SESSION_ID}: listening`,
        ]);
        expect(lines.join("")).not.toContain(ESC);
      }).pipe(Effect.provide(Log.Log.layerStdout)),
  );
});
