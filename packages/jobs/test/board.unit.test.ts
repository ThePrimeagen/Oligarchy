import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import * as DbErrors from "@oligarchy/db/errors";
import * as Linear from "@oligarchy/linear/client";
import * as TestingStores from "@oligarchy/testing/stores";
import * as Board from "../src/board.ts";
import * as H from "./harness.ts";

describe("Board.actionFor happy path", () => {
  it.effect("Automation Needed is a drive and Needs Review is a diagnose", () =>
    Effect.gen(function* () {
      const h = H.harness();
      h.tests.definitions.push(H.definition(1, "boot"));
      const job = H.seedResult(h.tests);
      const needed = yield* Board.actionFor(Linear.AUTOMATION_NEEDED_STATE, job).pipe(
        Effect.provide(h.layer),
      );
      const review = yield* Board.actionFor(Linear.NEEDS_REVIEW_STATE, job).pipe(
        Effect.provide(h.layer),
      );
      expect(needed).toEqual(Option.some("drive"));
      expect(review).toEqual(Option.some("diagnose"));
    }),
  );

  it.effect("Automation Needed for the mint definition is a mint, and Needs Review stays a diagnose", () =>
    Effect.gen(function* () {
      const h = H.harness();
      h.tests.definitions.push(H.definition(1, "mint"));
      const job = H.seedResult(h.tests);
      const needed = yield* Board.actionFor(Linear.AUTOMATION_NEEDED_STATE, job).pipe(
        Effect.provide(h.layer),
      );
      const review = yield* Board.actionFor(Linear.NEEDS_REVIEW_STATE, job).pipe(
        Effect.provide(h.layer),
      );
      const moved = yield* Board.driveOrMint(job).pipe(Effect.provide(h.layer));
      expect(needed).toEqual(Option.some("mint"));
      expect(review).toEqual(Option.some("diagnose"));
      expect(moved).toBe("mint");
    }),
  );
});

describe("Board.actionFor unhappy path", () => {
  it.effect("any other column is no action", () =>
    Effect.gen(function* () {
      const h = H.harness();
      h.tests.definitions.push(H.definition(1, "boot"));
      const job = H.seedResult(h.tests);
      for (const column of [
        Linear.BACKLOG_STATE,
        Linear.IN_PROGRESS_STATE,
        Linear.IN_REVIEW_STATE,
        Linear.SUCCEEDED_STATE,
        "Done",
      ]) {
        const action = yield* Board.actionFor(column, job).pipe(Effect.provide(h.layer));
        expect(action, column).toEqual(Option.none());
      }
    }),
  );

  it.effect("a result whose definition is gone is a drive, not a mint", () =>
    Effect.gen(function* () {
      const h = H.harness();
      const job = H.seedResult(h.tests, { definitionId: 99 });
      const action = yield* Board.driveOrMint(job).pipe(Effect.provide(h.layer));
      expect(action).toBe("drive");
    }),
  );
});

describe("Board.enqueue happy path", () => {
  it.effect("inserts the pending action for the job and answers queued", () =>
    Effect.gen(function* () {
      const h = H.harness();
      const job = H.seedResult(h.tests);
      const placed = yield* Board.enqueue(job, "drive").pipe(Effect.provide(h.layer));
      expect(placed).toEqual({ result: "queued", action: "drive" });
      expect(h.automation.jobs).toEqual([
        expect.objectContaining({ resultId: H.RESULT, action: "drive", status: "pending" }),
      ]);
    }),
  );
});

describe("Board.enqueue unhappy path", () => {
  it.effect("a second insert for the same result and action is named by the status the index kept", () =>
    Effect.gen(function* () {
      const h = H.harness();
      const job = H.seedResult(h.tests);
      H.seedAction(h.automation, { status: "running" });
      const placed = yield* Board.enqueue(job, "drive").pipe(Effect.provide(h.layer));
      expect(placed).toEqual({ result: "duplicate", action: "drive", status: "running" });
      expect(h.automation.jobs).toHaveLength(1);
    }),
  );

  it.effect("an insert that fails for any other reason fails with that error", () =>
    Effect.gen(function* () {
      const failure = DbErrors.DatabaseError.make({
        operation: "enqueueAutomationJob",
        message: "Failed query: insert",
        cause: new Error("connection reset"),
      });
      const h = H.harness({
        automation: TestingStores.fakeAutomationStore({ enqueue: () => Effect.fail(failure) }),
      });
      const job = H.seedResult(h.tests);
      const error = yield* Board.enqueue(job, "drive").pipe(Effect.provide(h.layer), Effect.flip);
      expect(error).toBe(failure);
    }),
  );
});
