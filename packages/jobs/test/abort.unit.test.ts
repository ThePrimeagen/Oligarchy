import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as DbErrors from "@oligarchy/db/errors";
import * as LinearErrors from "@oligarchy/linear/errors";
import * as TestingLinear from "@oligarchy/testing/linear";
import * as TestingStores from "@oligarchy/testing/stores";
import * as Abort from "../src/abort.ts";
import * as JobsErrors from "../src/errors.ts";
import * as H from "./harness.ts";

describe("Abort.abort happy path", () => {
  it.effect("aborts the pending drive, clears its ready label, then moves the ticket to Aborted", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests);
      H.seedAction(h.automation);
      yield* Abort.abort(H.TICKET, "drive").pipe(Effect.provide(h.layer));
      expect(h.automation.jobs[0]).toMatchObject({ status: "aborted", reason: "aborted" });
      expect(h.linear.calls).toEqual([
        { method: "clearReady", identifier: H.TICKET },
        { method: "moveToAborted", identifier: H.TICKET },
      ]);
      expect(h.log.lines).toEqual([
        {
          level: "info",
          text: "aborted pending drive",
          location: "automation",
          agentId: H.TICKET,
          cause: undefined,
        },
      ]);
    }),
  );

  it.effect("aborts the pending diagnose named while the drive runs on, and labels nothing", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests);
      H.seedAction(h.automation, { status: "running", serverId: H.CLIENT });
      H.seedAction(h.automation, { action: "diagnose" });
      yield* Abort.abort(H.TICKET, "diagnose").pipe(Effect.provide(h.layer));
      expect(h.automation.jobs.map((job) => job.status)).toEqual(["running", "aborted"]);
      expect(h.linear.calls).toEqual([{ method: "moveToAborted", identifier: H.TICKET }]);
      expect(h.log.texts()).toEqual(["aborted pending diagnose"]);
    }),
  );
});

describe("Abort.abort unhappy path", () => {
  it.effect("a ticket with no job, or a job with nothing pending, is NoPendingAction and nothing moves", () =>
    Effect.gen(function* () {
      const unknown = H.harness();
      const missing = yield* Abort.abort(H.TICKET, "drive").pipe(
        Effect.provide(unknown.layer),
        Effect.flip,
      );
      expect(missing).toEqual(JobsErrors.NoPendingAction.make({ ticket: H.TICKET, action: "drive" }));
      expect(missing.message).toBe(`ticket "${H.TICKET}" has no drive to abort`);
      expect(unknown.linear.calls).toEqual([]);

      const running = H.harness();
      H.seedResult(running.tests);
      H.seedAction(running.automation, { status: "running", serverId: H.CLIENT });
      const refused = yield* Abort.abort(H.TICKET, "drive").pipe(
        Effect.provide(running.layer),
        Effect.flip,
      );
      expect(refused._tag).toBe("NoPendingAction");
      expect(running.automation.jobs[0]?.status).toBe("running");
      expect(running.linear.calls).toEqual([]);
      expect(running.log.lines).toEqual([]);
    }),
  );

  it.effect("a ticket that will not move after three attempts is one line and the row stays aborted", () =>
    Effect.gen(function* () {
      const refused = LinearErrors.LinearError.make({
        operation: "moveToAborted",
        message: "linear: moveToAborted refused",
      });
      const move = H.failing(refused);
      const h = H.harness({
        linear: TestingLinear.fakeLinear({ overrides: { moveToAborted: () => move.effect } }),
      });
      H.seedResult(h.tests);
      H.seedAction(h.automation);
      yield* Abort.abort(H.TICKET, "drive").pipe(Effect.provide(h.layer));
      expect(move.counter.attempts).toBe(3);
      expect(h.automation.jobs[0]?.status).toBe("aborted");
      expect(h.log.lines.filter((line) => line.level === "error")).toEqual([
        {
          level: "error",
          text: "move to Aborted failed: linear: moveToAborted refused",
          location: "automation",
          agentId: H.TICKET,
          cause: refused,
        },
      ]);
    }),
  );

  it.effect("a row write that fails is that error and nothing moves", () =>
    Effect.gen(function* () {
      const failure = DbErrors.DatabaseError.make({
        operation: "abortPendingAutomationJob",
        message: "Failed query: update",
        cause: new Error("connection reset"),
      });
      const h = H.harness({
        automation: TestingStores.fakeAutomationStore({ abortPending: () => Effect.fail(failure) }),
      });
      H.seedResult(h.tests);
      const error = yield* Abort.abort(H.TICKET, "drive").pipe(Effect.provide(h.layer), Effect.flip);
      expect(error).toBe(failure);
      expect(h.linear.calls).toEqual([]);
    }),
  );
});

describe("Abort.running happy path", () => {
  it.effect("closes the running drive aborted, clears its ready label, then moves the ticket to Aborted", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "running" });
      const action = H.seedAction(h.automation, { status: "running", serverId: H.CLIENT });
      const closed = yield* Abort.running(H.TICKET, action).pipe(Effect.provide(h.layer));
      expect(closed).toBe(true);
      expect(h.automation.jobs[0]).toMatchObject({ status: "aborted", reason: "aborted" });
      expect(h.linear.calls).toEqual([
        { method: "clearReady", identifier: H.TICKET },
        { method: "moveToAborted", identifier: H.TICKET },
      ]);
      expect(h.log.lines).toEqual([]);
    }),
  );
});

describe("Abort.running unhappy path", () => {
  it.effect("a row that closed some other way first answers false and nothing moves", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "passed" });
      const action = H.seedAction(h.automation, { status: "completed", serverId: H.CLIENT });
      const closed = yield* Abort.running(H.TICKET, action).pipe(Effect.provide(h.layer));
      expect(closed).toBe(false);
      expect(h.automation.jobs[0]?.status).toBe("completed");
      expect(h.linear.calls).toEqual([]);
    }),
  );
});
