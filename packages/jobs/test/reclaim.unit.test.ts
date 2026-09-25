import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as DbErrors from "@oligarchy/db/errors";
import * as LinearErrors from "@oligarchy/linear/errors";
import * as TestingLinear from "@oligarchy/testing/linear";
import * as TestingStores from "@oligarchy/testing/stores";
import * as Reclaim from "../src/reclaim.ts";
import * as H from "./harness.ts";

const RESTARTED = "automation server restarted";

type Stop = { readonly url: string; readonly ticket: string; readonly status: string | undefined };

// The app's stop at the automation client, recording what it was asked and the row's status then.
const recordingStop = (h: H.Harness, onStop: () => void = () => undefined) => {
  const stops: Array<Stop> = [];
  return {
    stops,
    stop: (url: string, ticket: string) =>
      Effect.sync(() => {
        stops.push({ url, ticket, status: h.automation.jobs[0]?.status });
        onStop();
      }),
  };
};

const dbFailure = (operation: string) =>
  DbErrors.DatabaseError.make({
    operation,
    message: `Failed query: ${operation}`,
    cause: new Error("connection reset"),
  });

describe("Reclaim.reclaim happy path", () => {
  it.effect(
    "a drive or mint whose result its driver closed is completed and moved to Needs Review, and nothing is stopped",
    () =>
      Effect.gen(function* () {
        for (const action of ["drive", "mint"] as const) {
          const h = H.harness();
          H.seedResult(h.tests, { status: "failed" });
          h.clients.set(H.CLIENT, H.CLIENT_URL);
          const row = H.seedAction(h.automation, { action, status: "running", serverId: H.CLIENT });
          const client = recordingStop(h);
          yield* Reclaim.reclaim(row, client.stop).pipe(Effect.provide(h.layer));
          expect(client.stops, action).toEqual([]);
          expect(h.automation.jobs[0], action).toMatchObject({ status: "completed", reason: null });
          expect(h.linear.calls, action).toEqual([
            { method: "clearReady", identifier: H.TICKET },
            { method: "moveToNeedsReview", identifier: H.TICKET },
          ]);
          expect(h.log.texts(), action).toEqual([`${action} completed`]);
        }
      }),
  );

  it.effect(
    "a drive closed on a session the qemu server errored is errored with the session's reason",
    () =>
      Effect.gen(function* () {
        const h = H.harness();
        H.seedResult(h.tests, { status: "passed", sessionId: H.SESSION });
        h.sessions.set(H.SESSION, H.session(H.SESSION, "errored", "qemu exited 137"));
        const row = H.seedAction(h.automation, { status: "running", serverId: H.CLIENT });
        const client = recordingStop(h);
        yield* Reclaim.reclaim(row, client.stop).pipe(Effect.provide(h.layer));
        const reason = `session ${H.SESSION} errored; qemu exited 137`;
        expect(client.stops).toEqual([]);
        expect(h.automation.jobs[0]).toMatchObject({ status: "errored", reason });
        expect(h.tests.results[0]).toMatchObject({ status: "errored", reason });
        expect(h.linear.calls).toContainEqual({
          method: "moveToErrored",
          identifier: H.TICKET,
          message: `drive errored; ${reason}`,
        });
      }),
  );

  it.effect(
    "any other drive is stopped at its client first, then errored restarted and moved to Errored",
    () =>
      Effect.gen(function* () {
        const h = H.harness();
        H.seedResult(h.tests, { status: "running" });
        h.clients.set(H.CLIENT, H.CLIENT_URL);
        const row = H.seedAction(h.automation, { status: "running", serverId: H.CLIENT });
        const client = recordingStop(h);
        yield* Reclaim.reclaim(row, client.stop).pipe(Effect.provide(h.layer));
        expect(client.stops).toEqual([{ url: H.CLIENT_URL, ticket: H.TICKET, status: "running" }]);
        expect(h.automation.jobs[0]).toMatchObject({ status: "errored", reason: RESTARTED });
        expect(h.tests.results[0]).toMatchObject({ status: "errored", reason: RESTARTED });
        expect(h.linear.calls).toEqual([
          { method: "clearReady", identifier: H.TICKET },
          { method: "moveToErrored", identifier: H.TICKET, message: `drive errored; ${RESTARTED}` },
        ]);
        expect(h.log.texts()).toEqual([`drive errored; ${RESTARTED}`]);
      }),
  );

  it.effect(
    "a diagnose is stopped and errored, though its result was closed before it was queued",
    () =>
      Effect.gen(function* () {
        const h = H.harness();
        H.seedResult(h.tests, { status: "failed" });
        h.clients.set(H.CLIENT, H.CLIENT_URL);
        const row = H.seedAction(h.automation, {
          action: "diagnose",
          status: "running",
          serverId: H.CLIENT,
        });
        const client = recordingStop(h);
        yield* Reclaim.reclaim(row, client.stop).pipe(Effect.provide(h.layer));
        expect(client.stops).toEqual([{ url: H.CLIENT_URL, ticket: H.TICKET, status: "running" }]);
        expect(h.automation.jobs[0]).toMatchObject({ status: "errored", reason: RESTARTED });
        expect(h.tests.results[0]?.status).toBe("failed");
        expect(h.linear.calls).toEqual([
          {
            method: "moveToErrored",
            identifier: H.TICKET,
            message: `diagnose errored; ${RESTARTED}`,
          },
        ]);
      }),
  );
});

describe("Reclaim.reclaim unhappy path", () => {
  it.effect(
    "no client recorded, the client forgotten, or no ticket: nothing is stopped and the row is errored",
    () =>
      Effect.gen(function* () {
        const unplaced = H.harness();
        H.seedResult(unplaced.tests, { status: "running" });
        const first = H.seedAction(unplaced.automation, { status: "running" });
        const none = recordingStop(unplaced);
        yield* Reclaim.reclaim(first, none.stop).pipe(Effect.provide(unplaced.layer));
        expect(none.stops).toEqual([]);
        expect(unplaced.automation.jobs[0]).toMatchObject({ status: "errored", reason: RESTARTED });
        expect(unplaced.linear.calls.map((call) => call.method)).toEqual([
          "clearReady",
          "moveToErrored",
        ]);

        const forgotten = H.harness();
        H.seedResult(forgotten.tests, { status: "running" });
        const second = H.seedAction(forgotten.automation, {
          status: "running",
          serverId: H.CLIENT,
        });
        const gone = recordingStop(forgotten);
        yield* Reclaim.reclaim(second, gone.stop).pipe(Effect.provide(forgotten.layer));
        expect(gone.stops).toEqual([]);
        expect(forgotten.automation.jobs[0]).toMatchObject({
          status: "errored",
          reason: RESTARTED,
        });

        const unticketed = H.harness();
        H.seedResult(unticketed.tests, { status: "running", linearId: null });
        unticketed.clients.set(H.CLIENT, H.CLIENT_URL);
        const third = H.seedAction(unticketed.automation, {
          status: "running",
          serverId: H.CLIENT,
        });
        const blind = recordingStop(unticketed);
        yield* Reclaim.reclaim(third, blind.stop).pipe(Effect.provide(unticketed.layer));
        expect(blind.stops).toEqual([]);
        expect(unticketed.automation.jobs[0]).toMatchObject({
          status: "errored",
          reason: RESTARTED,
        });
        expect(unticketed.linear.calls).toEqual([]);
      }),
  );

  it.effect("a job someone else closed during the stop is not errored or moved", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests, { status: "running" });
      h.clients.set(H.CLIENT, H.CLIENT_URL);
      const row = H.seedAction(h.automation, { status: "running", serverId: H.CLIENT });
      const client = recordingStop(h, () => {
        row.status = "aborted";
        row.reason = "aborted";
      });
      yield* Reclaim.reclaim(row, client.stop).pipe(Effect.provide(h.layer));
      expect(client.stops).toHaveLength(1);
      expect(h.automation.jobs[0]).toMatchObject({ status: "aborted", reason: "aborted" });
      expect(h.linear.calls).toEqual([]);
      expect(h.log.lines).toEqual([]);
    }),
  );

  it.effect("a row that will not close is one line, left running, and not moved", () =>
    Effect.gen(function* () {
      const failure = dbFailure("finishAutomationJob");
      const finish = H.failing(failure);
      const h = H.harness({
        automation: TestingStores.fakeAutomationStore({ finish: () => finish.effect }),
      });
      H.seedResult(h.tests, { status: "running" });
      const row = H.seedAction(h.automation, { status: "running" });
      yield* Reclaim.reclaim(row, recordingStop(h).stop).pipe(Effect.provide(h.layer));
      expect(finish.counter.attempts).toBe(3);
      expect(h.automation.jobs[0]?.status).toBe("running");
      expect(h.linear.calls).toEqual([]);
      expect(h.log.lines).toEqual([
        {
          level: "error",
          text: `close write failed; ${row.id} should be errored`,
          location: "automation",
          agentId: undefined,
          cause: failure,
        },
      ]);
    }),
  );

  it.effect("a ticket that will not move is one line and the row stays errored", () =>
    Effect.gen(function* () {
      const refused = LinearErrors.LinearError.make({
        operation: "moveToErrored",
        message: "linear: no state named Errored",
      });
      const move = H.failing(refused);
      const h = H.harness({
        linear: TestingLinear.fakeLinear({ overrides: { moveToErrored: () => move.effect } }),
      });
      H.seedResult(h.tests, { status: "running" });
      const row = H.seedAction(h.automation, { status: "running" });
      yield* Reclaim.reclaim(row, recordingStop(h).stop).pipe(Effect.provide(h.layer));
      expect(move.counter.attempts).toBe(3);
      expect(h.automation.jobs[0]).toMatchObject({ status: "errored", reason: RESTARTED });
      expect(h.log.lines.filter((line) => line.text.startsWith("move to Errored"))).toEqual([
        {
          level: "error",
          text: "move to Errored failed: linear: no state named Errored",
          location: "automation",
          agentId: H.TICKET,
          cause: refused,
        },
      ]);
    }),
  );

  it.effect("a result lookup that fails is that error, and the row is left running", () =>
    Effect.gen(function* () {
      const failure = dbFailure("findResult");
      const h = H.harness({
        tests: TestingStores.fakeTestStore({}, { findResult: () => Effect.fail(failure) }),
      });
      const row = H.seedAction(h.automation, { status: "running" });
      const error = yield* Reclaim.reclaim(row, recordingStop(h).stop).pipe(
        Effect.provide(h.layer),
        Effect.flip,
      );
      expect(error).toBe(failure);
      expect(h.automation.jobs[0]?.status).toBe("running");
      expect(h.linear.calls).toEqual([]);
    }),
  );
});
