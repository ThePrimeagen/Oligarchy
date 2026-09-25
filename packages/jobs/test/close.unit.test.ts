import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import * as DbErrors from "@oligarchy/db/errors";
import * as LinearErrors from "@oligarchy/linear/errors";
import * as TestingLinear from "@oligarchy/testing/linear";
import * as TestingStores from "@oligarchy/testing/stores";
import * as Close from "../src/close.ts";
import * as H from "./harness.ts";

const moves = (h: H.Harness) => h.linear.calls.map((call) => call.method);

const refusal = (operation: string) =>
  LinearErrors.LinearError.make({ operation, message: `linear: ${operation} refused` });

const dbFailure = (operation: string) =>
  DbErrors.DatabaseError.make({
    operation,
    message: `Failed query: ${operation}`,
    cause: new Error("connection reset"),
  });

describe("Close.close happy path", () => {
  it.effect("a drive that ran to its end is completed, its ready label cleared, and its ticket moved to Needs Review", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "passed" });
      const action = H.seedAction(h.automation, { status: "running" });
      const closed = yield* Close.close(action, { status: "completed", reason: null }).pipe(
        Effect.provide(h.layer),
      );
      expect(closed).toBe(true);
      expect(h.automation.jobs[0]).toMatchObject({ status: "completed", reason: null });
      expect(h.linear.calls).toEqual([
        { method: "clearReady", identifier: H.TICKET },
        { method: "moveToNeedsReview", identifier: H.TICKET },
      ]);
      expect(h.log.lines).toEqual([
        {
          level: "info",
          text: "drive completed",
          location: "automation",
          agentId: undefined,
          cause: undefined,
        },
      ]);
    }),
  );

  it.effect("a diagnose that succeeded moves the ticket by its verdict and leaves the ready label alone", () =>
    Effect.gen(function* () {
      const failed = H.harness();
      H.seedResult(failed.tests, { status: "failed", sessionId: H.SESSION });
      failed.verdicts.set(H.SESSION, "failed");
      const judged = H.seedAction(failed.automation, { action: "diagnose", status: "running" });
      yield* Close.close(judged, { status: "succeeded", reason: null }).pipe(
        Effect.provide(failed.layer),
      );
      expect(failed.linear.calls).toEqual([{ method: "moveToFailed", identifier: H.TICKET }]);
      expect(failed.log.texts()).toEqual(["diagnose succeeded"]);

      const passed = H.harness();
      H.seedResult(passed.tests, { status: "passed", sessionId: H.SESSION });
      passed.verdicts.set(H.SESSION, "passed");
      const approved = H.seedAction(passed.automation, { action: "diagnose", status: "running" });
      yield* Close.close(approved, { status: "succeeded", reason: null }).pipe(
        Effect.provide(passed.layer),
      );
      expect(passed.linear.calls).toEqual([{ method: "moveToSucceeded", identifier: H.TICKET }]);
    }),
  );

  it.effect("an errored drive errors its result and moves the ticket to Errored with the reason", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "running" });
      const action = H.seedAction(h.automation, { status: "running" });
      yield* Close.close(action, { status: "errored", reason: "opencode exited 1" }).pipe(
        Effect.provide(h.layer),
      );
      expect(h.automation.jobs[0]).toMatchObject({ status: "errored", reason: "opencode exited 1" });
      expect(h.tests.results[0]).toMatchObject({ status: "errored", reason: "opencode exited 1" });
      expect(h.linear.calls).toEqual([
        { method: "clearReady", identifier: H.TICKET },
        {
          method: "moveToErrored",
          identifier: H.TICKET,
          message: "drive errored; opencode exited 1",
        },
      ]);
      expect(h.log.lines.map((line) => [line.level, line.text])).toEqual([
        ["error", "drive errored; opencode exited 1"],
      ]);
    }),
  );

  it.effect("an aborted mint clears its ready label and leaves the ticket where it is", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "running" });
      const action = H.seedAction(h.automation, { action: "mint", status: "running" });
      yield* Close.close(action, { status: "aborted", reason: "shutting down" }).pipe(
        Effect.provide(h.layer),
      );
      expect(h.automation.jobs[0]).toMatchObject({ status: "aborted", reason: "shutting down" });
      expect(h.linear.calls).toEqual([{ method: "clearReady", identifier: H.TICKET }]);
      expect(h.log.texts()).toEqual(["mint aborted"]);
    }),
  );

  it.effect("a row write that fails twice lands on the third attempt with nothing reported", () =>
    Effect.gen(function* () {
      const failure = dbFailure("finishAutomationJob");
      let attempts = 0;
      const held: { store?: TestingStores.FakeAutomationStore } = {};
      const automation = TestingStores.fakeAutomationStore({
        finish: (id, status, reason) =>
          Effect.suspend(() => {
            attempts += 1;
            const row = held.store?.jobs.find((job) => job.id === id);
            if (attempts < 3 || row === undefined) {
              return Effect.fail(failure);
            }
            row.status = status;
            row.reason = reason;
            return Effect.succeed(true);
          }),
      });
      held.store = automation;
      const h = H.harness({ automation });
      H.seedResult(h.tests, { status: "passed" });
      const action = H.seedAction(h.automation, { status: "running" });
      const closed = yield* Close.close(action, { status: "completed", reason: null }).pipe(
        Effect.provide(h.layer),
      );
      expect(closed).toBe(true);
      expect(attempts).toBe(3);
      expect(h.log.texts()).toEqual(["drive completed"]);
    }),
  );
});

describe("Close.close unhappy path", () => {
  it.effect("a row write that fails three times is one line, answers false, and moves nothing", () =>
    Effect.gen(function* () {
      const failure = dbFailure("finishAutomationJob");
      const finish = H.failing(failure);
      const h = H.harness({
        automation: TestingStores.fakeAutomationStore({ finish: () => finish.effect }),
      });
      H.seedResult(h.tests, { status: "passed" });
      const action = H.seedAction(h.automation, { status: "running" });
      const closed = yield* Close.close(action, { status: "completed", reason: null }).pipe(
        Effect.provide(h.layer),
      );
      expect(closed).toBe(false);
      expect(finish.counter.attempts).toBe(3);
      expect(h.automation.jobs[0]?.status).toBe("running");
      expect(h.linear.calls).toEqual([]);
      expect(h.log.lines).toEqual([
        {
          level: "error",
          text: `close write failed; ${action.id} should be completed`,
          location: "automation",
          agentId: undefined,
          cause: failure,
        },
      ]);
    }),
  );

  it.effect("a ticket that will not move after three attempts is one line and the row stays closed", () =>
    Effect.gen(function* () {
      const refused = refusal("moveToNeedsReview");
      const move = H.failing(refused);
      const h = H.harness({
        linear: TestingLinear.fakeLinear({ overrides: { moveToNeedsReview: () => move.effect } }),
      });
      H.seedResult(h.tests, { status: "passed" });
      const action = H.seedAction(h.automation, { status: "running" });
      const closed = yield* Close.close(action, { status: "completed", reason: null }).pipe(
        Effect.provide(h.layer),
      );
      expect(closed).toBe(true);
      expect(move.counter.attempts).toBe(3);
      expect(h.automation.jobs[0]?.status).toBe("completed");
      expect(h.log.lines.filter((line) => line.level === "error")).toEqual([
        {
          level: "error",
          text: "move to Needs Review failed: linear: moveToNeedsReview refused",
          location: "automation",
          agentId: H.TICKET,
          cause: refused,
        },
      ]);
    }),
  );

  it.effect("a second close of a closed row answers false and moves nothing", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "passed" });
      const action = H.seedAction(h.automation, { status: "aborted", reason: "aborted" });
      const closed = yield* Close.close(action, { status: "completed", reason: null }).pipe(
        Effect.provide(h.layer),
      );
      expect(closed).toBe(false);
      expect(h.automation.jobs[0]).toMatchObject({ status: "aborted", reason: "aborted" });
      expect(h.linear.calls).toEqual([]);
      expect(h.log.lines).toEqual([]);
    }),
  );

  it.effect("an action without a ticket closes its row and moves nothing", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "running", linearId: null });
      const action = H.seedAction(h.automation, { status: "running" });
      yield* Close.close(action, { status: "errored", reason: "no Linear ticket" }).pipe(
        Effect.provide(h.layer),
      );
      expect(h.automation.jobs[0]).toMatchObject({ status: "errored", reason: "no Linear ticket" });
      expect(h.tests.results[0]?.status).toBe("errored");
      expect(h.linear.calls).toEqual([]);
      expect(h.log.texts()).toEqual(["drive errored; no Linear ticket"]);
    }),
  );

  it.effect("a diagnose with no session, or a session with no verdict, is a line and no move", () =>
    Effect.gen(function* () {
      const unrun = H.harness();
      H.seedResult(unrun.tests, { status: "failed" });
      const first = H.seedAction(unrun.automation, { action: "diagnose", status: "running" });
      yield* Close.close(first, { status: "succeeded", reason: null }).pipe(
        Effect.provide(unrun.layer),
      );
      expect(unrun.linear.calls).toEqual([]);
      expect(unrun.log.lines.filter((line) => line.level === "error")).toEqual([
        expect.objectContaining({
          text: `diagnose verdict missing; ${H.RESULT}`,
          agentId: H.TICKET,
        }),
      ]);

      const unjudged = H.harness();
      H.seedResult(unjudged.tests, { status: "failed", sessionId: H.SESSION });
      const second = H.seedAction(unjudged.automation, { action: "diagnose", status: "running" });
      yield* Close.close(second, { status: "succeeded", reason: null }).pipe(
        Effect.provide(unjudged.layer),
      );
      expect(unjudged.linear.calls).toEqual([]);
      expect(unjudged.log.lines.filter((line) => line.level === "error")).toEqual([
        expect.objectContaining({ text: `diagnose verdict missing; ${H.SESSION}` }),
      ]);
    }),
  );

  it.effect("a verdict read that fails three times is one line and no move", () =>
    Effect.gen(function* () {
      const failure = dbFailure("getDiagnosis");
      const read = H.failing(failure);
      const h = H.harness({ getDiagnosis: () => read.effect });
      H.seedResult(h.tests, { status: "failed", sessionId: H.SESSION });
      const action = H.seedAction(h.automation, { action: "diagnose", status: "running" });
      yield* Close.close(action, { status: "succeeded", reason: null }).pipe(
        Effect.provide(h.layer),
      );
      expect(read.counter.attempts).toBe(3);
      expect(h.automation.jobs[0]?.status).toBe("succeeded");
      expect(h.linear.calls).toEqual([]);
      expect(h.log.lines.filter((line) => line.level === "error")).toEqual([
        {
          level: "error",
          text: `diagnose verdict read failed; ${H.SESSION}: connection reset`,
          location: "automation",
          agentId: H.TICKET,
          cause: failure,
        },
      ]);
    }),
  );
});

describe("Close.judge happy path", () => {
  it.effect("a drive whose result its driver closed is completed, and a diagnose is succeeded", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "failed", sessionId: H.SESSION });
      h.sessions.set(H.SESSION, H.session(H.SESSION, "succeeded"));
      const drive = H.seedAction(h.automation, { status: "running" });
      const diagnose = H.seedAction(h.automation, { action: "diagnose", status: "running" });
      expect(yield* Close.judge(drive).pipe(Effect.provide(h.layer))).toEqual({
        status: "completed",
        reason: null,
      });
      expect(yield* Close.judge(diagnose).pipe(Effect.provide(h.layer))).toEqual({
        status: "succeeded",
        reason: null,
      });
    }),
  );
});

describe("Close.judge unhappy path", () => {
  it.effect("a result its driver left open is errored, naming the status it was left in", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "running" });
      const action = H.seedAction(h.automation, { status: "running" });
      expect(yield* Close.judge(action).pipe(Effect.provide(h.layer))).toEqual({
        status: "errored",
        reason: `driver exited; result ${H.RESULT} is running`,
      });
    }),
  );

  it.effect("a session the qemu server errored errors the drive, whatever verdict was written", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "passed", sessionId: H.SESSION });
      h.sessions.set(H.SESSION, H.session(H.SESSION, "errored", "qemu server restarted"));
      const action = H.seedAction(h.automation, { status: "running" });
      expect(yield* Close.judge(action).pipe(Effect.provide(h.layer))).toEqual({
        status: "errored",
        reason: `session ${H.SESSION} errored; qemu server restarted`,
      });

      h.sessions.set(H.SESSION, H.session(H.SESSION, "errored"));
      expect(yield* Close.judge(action).pipe(Effect.provide(h.layer))).toEqual({
        status: "errored",
        reason: `session ${H.SESSION} errored`,
      });
    }),
  );

  it.effect("a result that vanished during the drive is a defect", () =>
    Effect.gen(function* () {
      const h = H.harness();
      const action = H.seedAction(h.automation, { status: "running" });
      const exit = yield* Close.judge(action).pipe(Effect.provide(h.layer), Effect.exit);
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    }),
  );
});

describe("Close.fail happy path", () => {
  it.effect("errors a drive's result, then moves its ticket to Errored with the reason", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "running" });
      const action = H.seedAction(h.automation, { status: "errored", reason: "DATABASE FAILURE" });
      yield* Close.fail(action, H.TICKET, "DATABASE FAILURE").pipe(Effect.provide(h.layer));
      expect(h.tests.results[0]).toMatchObject({ status: "errored", reason: "DATABASE FAILURE" });
      expect(h.linear.calls).toEqual([
        {
          method: "moveToErrored",
          identifier: H.TICKET,
          message: "drive errored; DATABASE FAILURE",
        },
      ]);
      expect(h.log.lines).toEqual([]);
    }),
  );

  it.effect("leaves the result a diagnose was judging alone", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "failed" });
      const action = H.seedAction(h.automation, { action: "diagnose", status: "errored" });
      yield* Close.fail(action, H.TICKET, "opencode exited 1").pipe(Effect.provide(h.layer));
      expect(h.tests.results[0]?.status).toBe("failed");
      expect(h.linear.calls).toEqual([
        {
          method: "moveToErrored",
          identifier: H.TICKET,
          message: "diagnose errored; opencode exited 1",
        },
      ]);
    }),
  );
});

describe("Close.fail unhappy path", () => {
  it.effect("a result write that fails three times is one line and the ticket still moves", () =>
    Effect.gen(function* () {
      const failure = dbFailure("errorResult");
      const write = H.failing(failure);
      const h = H.harness({
        tests: TestingStores.fakeTestStore({}, { errorResult: () => write.effect }),
      });
      H.seedResult(h.tests, { status: "running" });
      const action = H.seedAction(h.automation, { status: "errored" });
      yield* Close.fail(action, H.TICKET, "boom").pipe(Effect.provide(h.layer));
      expect(write.counter.attempts).toBe(3);
      expect(moves(h)).toEqual(["moveToErrored"]);
      expect(h.log.lines).toEqual([
        {
          level: "error",
          text: `result errored write failed; ${H.RESULT}: connection reset`,
          location: "automation",
          agentId: H.TICKET,
          cause: failure,
        },
      ]);
    }),
  );

  it.effect("a ticket that will not move after three attempts is one line and the result stays errored", () =>
    Effect.gen(function* () {
      const refused = refusal("moveToErrored");
      const move = H.failing(refused);
      const h = H.harness({
        linear: TestingLinear.fakeLinear({ overrides: { moveToErrored: () => move.effect } }),
      });
      H.seedResult(h.tests, { status: "running" });
      const action = H.seedAction(h.automation, { status: "errored" });
      yield* Close.fail(action, H.TICKET, "boom").pipe(Effect.provide(h.layer));
      expect(move.counter.attempts).toBe(3);
      expect(h.tests.results[0]?.status).toBe("errored");
      expect(h.log.lines).toEqual([
        {
          level: "error",
          text: "move to Errored failed: linear: moveToErrored refused",
          location: "automation",
          agentId: H.TICKET,
          cause: refused,
        },
      ]);
    }),
  );

  it.effect("an action without a ticket errors its result and moves nothing", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "running", linearId: null });
      const action = H.seedAction(h.automation, { status: "errored" });
      yield* Close.fail(action, null, "boom").pipe(Effect.provide(h.layer));
      expect(h.tests.results[0]?.status).toBe("errored");
      expect(h.linear.calls).toEqual([]);
    }),
  );
});
