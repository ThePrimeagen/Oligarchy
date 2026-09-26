import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import * as Find from "../src/find.ts";
import * as H from "./harness.ts";

const OTHER_RESULT = "33333333-3333-4333-8333-333333333333";

describe("Find.byTicket", () => {
  it.effect("answers the job behind a ticket", () =>
    Effect.gen(function* () {
      const h = H.harness();
      const job = H.seedResult(h.tests);
      const found = yield* Find.byTicket(H.TICKET).pipe(Effect.provide(h.layer));
      expect(found).toEqual(Option.some(job));
    }),
  );

  it.effect("an unknown ticket is none (unhappy)", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests);
      const found = yield* Find.byTicket("OLI-99").pipe(Effect.provide(h.layer));
      expect(found).toEqual(Option.none());
    }),
  );
});

describe("Find.ofAction", () => {
  it.effect("answers the job an action belongs to", () =>
    Effect.gen(function* () {
      const h = H.harness();
      const job = H.seedResult(h.tests);
      const action = H.seedAction(h.automation);
      const found = yield* Find.ofAction(action).pipe(Effect.provide(h.layer));
      expect(found).toEqual(Option.some(job));
    }),
  );

  it.effect("an action whose job is gone is none (unhappy)", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedResult(h.tests);
      const action = H.seedAction(h.automation, { resultId: OTHER_RESULT });
      const found = yield* Find.ofAction(action).pipe(Effect.provide(h.layer));
      expect(found).toEqual(Option.none());
    }),
  );
});

describe("Find.nextPending", () => {
  it.effect("answers the next action in queue order and skips the ids it is given", () =>
    Effect.gen(function* () {
      const h = H.harness();
      const drive = H.seedAction(h.automation);
      const mint = H.seedAction(h.automation, { resultId: OTHER_RESULT, action: "mint" });
      const first = yield* Find.nextPending([]).pipe(Effect.provide(h.layer));
      const second = yield* Find.nextPending([mint.id]).pipe(Effect.provide(h.layer));
      expect(Option.map(first, (action) => action.id)).toEqual(Option.some(mint.id));
      expect(Option.map(second, (action) => action.id)).toEqual(Option.some(drive.id));
    }),
  );

  it.effect("a job with an action running, or every pending id skipped, is none (unhappy)", () =>
    Effect.gen(function* () {
      const h = H.harness();
      H.seedAction(h.automation, { status: "running", serverId: H.CLIENT });
      H.seedAction(h.automation, { action: "diagnose" });
      const busy = yield* Find.nextPending([]).pipe(Effect.provide(h.layer));
      expect(busy).toEqual(Option.none());

      const idle = H.harness();
      const drive = H.seedAction(idle.automation);
      const skipped = yield* Find.nextPending([drive.id]).pipe(Effect.provide(idle.layer));
      expect(skipped).toEqual(Option.none());
    }),
  );
});

describe("Find.status and Find.hasPending", () => {
  it.effect("name the status of a job's action, and whether it waits", () =>
    Effect.gen(function* () {
      const h = H.harness();
      const job = H.seedResult(h.tests);
      H.seedAction(h.automation);
      const status = yield* Find.status(job, "drive").pipe(Effect.provide(h.layer));
      const waiting = yield* Find.hasPending(job, "drive").pipe(Effect.provide(h.layer));
      expect(status).toEqual(Option.some("pending"));
      expect(waiting).toBe(true);
    }),
  );

  it.effect("an action never queued is none, and one running is not pending (unhappy)", () =>
    Effect.gen(function* () {
      const h = H.harness();
      const job = H.seedResult(h.tests);
      H.seedAction(h.automation, { status: "running", serverId: H.CLIENT });
      const unqueued = yield* Find.status(job, "diagnose").pipe(Effect.provide(h.layer));
      const waiting = yield* Find.hasPending(job, "drive").pipe(Effect.provide(h.layer));
      expect(unqueued).toEqual(Option.none());
      expect(waiting).toBe(false);
    }),
  );
});

describe("Find.running and Find.inherited", () => {
  it.effect(
    "running answers a job's action in flight; inherited lists every one, oldest first",
    () =>
      Effect.gen(function* () {
        const h = H.harness();
        const job = H.seedResult(h.tests);
        const drive = H.seedAction(h.automation, { status: "running", serverId: H.CLIENT });
        const other = H.seedAction(h.automation, {
          resultId: OTHER_RESULT,
          status: "running",
          serverId: H.CLIENT,
        });
        H.seedAction(h.automation, { resultId: OTHER_RESULT, action: "diagnose" });
        const running = yield* Find.running(job).pipe(Effect.provide(h.layer));
        const inherited = yield* Find.inherited().pipe(Effect.provide(h.layer));
        expect(running).toEqual(Option.some(drive));
        expect(inherited.map((action) => action.id)).toEqual([drive.id, other.id]);
      }),
  );

  it.effect(
    "a job with nothing in flight is none, and a quiet fleet inherits nothing (unhappy)",
    () =>
      Effect.gen(function* () {
        const h = H.harness();
        const job = H.seedResult(h.tests);
        H.seedAction(h.automation);
        H.seedAction(h.automation, { action: "diagnose", status: "aborted" });
        const running = yield* Find.running(job).pipe(Effect.provide(h.layer));
        const inherited = yield* Find.inherited().pipe(Effect.provide(h.layer));
        expect(running).toEqual(Option.none());
        expect(inherited).toEqual([]);
      }),
  );
});

describe("Find.diagnosable", () => {
  it.effect("a drive or a mint that ran to its end is ready to diagnose", () =>
    Effect.gen(function* () {
      const driven = H.harness();
      const job = H.seedResult(driven.tests);
      H.seedAction(driven.automation, { status: "completed" });
      expect(yield* Find.diagnosable(job).pipe(Effect.provide(driven.layer))).toEqual({
        _tag: "ready",
      });

      const minted = H.harness();
      H.seedAction(minted.automation, { action: "mint", status: "completed" });
      expect(yield* Find.diagnosable(job).pipe(Effect.provide(minted.layer))).toEqual({
        _tag: "ready",
      });
    }),
  );

  it.effect("a drive still pending or running holds the diagnose (unhappy)", () =>
    Effect.gen(function* () {
      for (const status of ["pending", "running"] as const) {
        const h = H.harness();
        const job = H.seedResult(h.tests);
        H.seedAction(h.automation, { status });
        expect(yield* Find.diagnosable(job).pipe(Effect.provide(h.layer)), status).toEqual({
          _tag: "held",
        });
      }
    }),
  );

  it.effect("a drive that ended any other way, or none at all, is never diagnosed (unhappy)", () =>
    Effect.gen(function* () {
      const errored = H.harness();
      const job = H.seedResult(errored.tests);
      H.seedAction(errored.automation, { status: "errored", reason: "opencode exited 1" });
      expect(yield* Find.diagnosable(job).pipe(Effect.provide(errored.layer))).toEqual({
        _tag: "never",
        reason: "not diagnosed; drive errored",
      });

      const aborted = H.harness();
      H.seedAction(aborted.automation, { action: "mint", status: "aborted" });
      expect(yield* Find.diagnosable(job).pipe(Effect.provide(aborted.layer))).toEqual({
        _tag: "never",
        reason: "not diagnosed; mint aborted",
      });

      const judgedOnly = H.harness();
      H.seedAction(judgedOnly.automation, { action: "diagnose", status: "succeeded" });
      expect(yield* Find.diagnosable(job).pipe(Effect.provide(judgedOnly.layer))).toEqual({
        _tag: "never",
        reason: "not diagnosed; no drive",
      });
    }),
  );
});
