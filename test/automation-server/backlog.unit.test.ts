import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as Backlog from "../../src/automation-server/backlog.ts";
import * as Linear from "../../src/ctrl/linear.ts";
import * as Log from "../../src/observability/log.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeLinear from "../support/fake-linear.ts";
import * as FakeLog from "../support/log.ts";
import * as Stores from "../support/stores.ts";

const TICKET = "OLI-45";
const OTHER = "OLI-46";
const RESULT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_RESULT = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const RUN = "11111111-1111-4111-8111-111111111111";
const SEEN = "2026-09-22T13:00:00.000Z";
const EDITED = "2026-09-22T13:01:00.000Z";

type Move = {
  readonly issueId: string;
  readonly identifier: string;
  readonly stateId: string;
};

const ticket = (identifier: string, updatedAt: string): Linear.LinearBacklogTicket => ({
  id: `issue-${identifier}`,
  identifier,
  title: identifier,
  url: `https://linear.app/issue/${identifier}`,
  updatedAt,
});

const seedResult = (tests: Stores.FakeTestStore, linearId: string, resultId = RESULT) => {
  tests.results.push({
    id: resultId,
    runId: RUN,
    definitionId: 1,
    sessionId: null,
    model: null,
    linearId,
    status: "pending",
    reason: null,
    createdAt: new Date(),
    finishedAt: null,
  });
};

// The loop in a scope of its own, so a test can close it. `backlog` is read on every poll.
const start = (
  backlog: () => ReadonlyArray<Linear.LinearBacklogTicket>,
  moveIssue?: Linear.LinearService["moveIssue"],
) =>
  Effect.gen(function* () {
    const stores = Stores.fakeStores();
    const log = FakeLog.fakeLog();
    const moved: Array<Move> = [];
    const recordMove: Linear.LinearService["moveIssue"] = (issueId, identifier, stateId) =>
      Effect.sync(() => {
        moved.push({ issueId, identifier, stateId });
      });
    const linear = FakeLinear.fakeLinear({
      overrides: {
        listBacklog: Effect.suspend(() => Effect.succeed(backlog())),
        moveIssue: moveIssue ?? recordMove,
      },
    });
    const scope = yield* Scope.make();
    yield* Backlog.watch().pipe(
      Effect.provide(
        Layer.mergeAll(
          stores.layer,
          linear.layer,
          log.layer,
          Layer.succeed(Log.ProcessAttribution)(Log.AutomationProcessAttribution),
        ),
      ),
      Scope.provide(scope),
    );
    return { stores, log, moved, linear, scope };
  });

const automationNeeded = (identifier: string): Move => ({
  issueId: `issue-${identifier}`,
  identifier,
  stateId: FakeLinear.STATES.automationNeeded,
});

describe("backlog watch happy path", () => {
  it.effect(
    "saves a backlog ticket and, after three unchanged thirty-second rounds, moves it to Automation Needed and queues its drive",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { stores, log, moved } = yield* start(() => board);
        seedResult(stores.tests, TICKET);
        expect(stores.automation.jobs).toEqual([]);
        expect(moved).toEqual([]);
        // Two rounds later it is still only saved: sixty seconds is not the ninety.
        yield* TestClock.adjust("60 seconds");
        expect(stores.automation.jobs).toEqual([]);
        expect(moved).toEqual([]);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
        ]);
        expect(moved).toEqual([automationNeeded(TICKET)]);
        expect(log.lines).toEqual([
          {
            level: "info",
            text: `backlog watch moved ${TICKET} to Automation Needed; queued drive`,
            location: "automation",
            agentId: TICKET,
            skipSentry: false,
            cause: undefined,
          },
        ]);
      }),
  );

  it.effect("queues mint, not drive, when the backlog ticket's result is the mint definition", () =>
    Effect.gen(function* () {
      const { stores, moved, log } = yield* start(() => [ticket(TICKET, SEEN)]);
      stores.tests.definitions.push({
        id: 1,
        name: "mint",
        description: "install",
        instruction: "boot",
        proof: "desktop",
        createdAt: new Date(0),
      });
      seedResult(stores.tests, TICKET);
      yield* TestClock.adjust("90 seconds");
      expect(stores.automation.jobs).toEqual([
        expect.objectContaining({ resultId: RESULT, action: "mint", status: "pending" }),
      ]);
      expect(moved).toEqual([automationNeeded(TICKET)]);
      expect(FakeLog.texts(log)).toEqual([
        `backlog watch moved ${TICKET} to Automation Needed; queued mint`,
      ]);
    }),
  );

  it.effect("adopts each ticket on its own rounds, leaving a newer one in the backlog", () =>
    Effect.gen(function* () {
      let board = [ticket(TICKET, SEEN)];
      const { stores, moved } = yield* start(() => board);
      seedResult(stores.tests, TICKET);
      seedResult(stores.tests, OTHER, OTHER_RESULT);
      yield* TestClock.adjust("59 seconds");
      board = [ticket(TICKET, SEEN), ticket(OTHER, SEEN)];
      yield* TestClock.adjust("31 seconds");
      expect(moved).toEqual([automationNeeded(TICKET)]);
      expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([RESULT]);
      yield* TestClock.adjust("60 seconds");
      expect(moved).toEqual([automationNeeded(TICKET), automationNeeded(OTHER)]);
      expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([RESULT, OTHER_RESULT]);
    }),
  );
});

describe("backlog watch unhappy path", () => {
  it.effect("an edit resets the rounds, so the original ninety seconds does not move it", () =>
    Effect.gen(function* () {
      let updatedAt = SEEN;
      const { stores, moved } = yield* start(() => [ticket(TICKET, updatedAt)]);
      seedResult(stores.tests, TICKET);
      yield* TestClock.adjust("59 seconds");
      updatedAt = EDITED;
      // The edit lands on the second round. Ninety seconds from the start is not three
      // rounds of this new snapshot.
      yield* TestClock.adjust("61 seconds");
      expect(moved).toEqual([]);
      expect(stores.automation.jobs).toEqual([]);
      yield* TestClock.adjust("60 seconds");
      expect(moved).toEqual([automationNeeded(TICKET)]);
      expect(stores.automation.jobs).toEqual([
        expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
      ]);
    }),
  );

  it.effect("a ticket that leaves the backlog is forgotten, and coming back starts over", () =>
    Effect.gen(function* () {
      let board = [ticket(TICKET, SEEN)];
      const { stores, moved } = yield* start(() => board);
      seedResult(stores.tests, TICKET);
      yield* TestClock.adjust("59 seconds");
      board = [];
      yield* TestClock.adjust("1 second");
      board = [ticket(TICKET, SEEN)];
      yield* TestClock.adjust("90 seconds");
      expect(moved).toEqual([]);
      expect(stores.automation.jobs).toEqual([]);
      yield* TestClock.adjust("30 seconds");
      expect(moved).toEqual([automationNeeded(TICKET)]);
    }),
  );

  it.effect(
    "no result leaves the ticket in the backlog, and a result that appears later is adopted on the next poll",
    () =>
      Effect.gen(function* () {
        const { stores, moved, log } = yield* start(() => [ticket(TICKET, SEEN)]);
        yield* TestClock.adjust("90 seconds");
        expect(moved).toEqual([]);
        expect(stores.automation.jobs).toEqual([]);
        expect(FakeLog.texts(log)).toEqual([`backlog watch left ${TICKET}; no result`]);
        seedResult(stores.tests, TICKET);
        yield* TestClock.adjust("30 seconds");
        expect(moved).toEqual([automationNeeded(TICKET)]);
        expect(stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
        ]);
      }),
  );

  it.effect("a drive already queued still moves the ticket (duplicate)", () =>
    Effect.gen(function* () {
      const { stores, moved, log } = yield* start(() => [ticket(TICKET, SEEN)]);
      seedResult(stores.tests, TICKET);
      stores.automation.jobs.push({
        id: "00000000-0000-4000-8000-000000000001",
        resultId: RESULT,
        action: "drive",
        status: "pending",
        reason: null,
        serverId: null,
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
      });
      yield* TestClock.adjust("90 seconds");
      expect(stores.automation.jobs).toHaveLength(1);
      expect(moved).toEqual([automationNeeded(TICKET)]);
      expect(FakeLog.texts(log)).toEqual([
        `backlog watch moved ${TICKET} to Automation Needed; drive already queued`,
      ]);
    }),
  );

  it.effect(
    "a failed Linear poll is one error line, keeps the rounds already saved, and the next polls still run",
    () =>
      Effect.gen(function* () {
        const refused = Errors.LinearError.make({
          operation: "listBacklog",
          message: "linear: request failed",
        });
        let fail = false;
        const stores = Stores.fakeStores();
        const log = FakeLog.fakeLog();
        const moved: Array<Move> = [];
        const linear = FakeLinear.fakeLinear({
          overrides: {
            listBacklog: Effect.suspend(() =>
              fail ? Effect.fail(refused) : Effect.succeed([ticket(TICKET, SEEN)]),
            ),
            moveIssue: (issueId, identifier, stateId) =>
              Effect.sync(() => {
                moved.push({ issueId, identifier, stateId });
              }),
          },
        });
        seedResult(stores.tests, TICKET);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(Layer.mergeAll(stores.layer, linear.layer, log.layer)),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("30 seconds");
        fail = true;
        yield* TestClock.adjust("30 seconds");
        expect(log.lines).toEqual([
          {
            level: "error",
            text: "backlog watch failed: linear: request failed",
            location: "automation",
            agentId: "automation",
            skipSentry: false,
            cause: refused,
          },
        ]);
        fail = false;
        // One successful round was saved before the failure. Two more reach the move;
        // a reset would still be waiting here.
        yield* TestClock.adjust("60 seconds");
        expect(moved).toEqual([automationNeeded(TICKET)]);
        expect(stores.automation.jobs).toHaveLength(1);
      }),
  );

  it.effect("a failed move keeps the queued job and retries the move on the next poll", () =>
    Effect.gen(function* () {
      const refused = Errors.LinearError.make({
        operation: "moveIssue",
        message: `linear: moving ${TICKET} failed`,
      });
      let fail = true;
      const moved: Array<Move> = [];
      const { stores, log } = yield* start(
        () => [ticket(TICKET, SEEN)],
        (issueId, identifier, stateId) =>
          Effect.suspend(() => {
            if (fail) {
              return Effect.fail(refused);
            }
            moved.push({ issueId, identifier, stateId });
            return Effect.void;
          }),
      );
      seedResult(stores.tests, TICKET);
      yield* TestClock.adjust("90 seconds");
      expect(stores.automation.jobs).toEqual([
        expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
      ]);
      expect(moved).toEqual([]);
      expect(log.lines[0]).toMatchObject({
        level: "error",
        text: `backlog watch failed for ${TICKET}: linear: moving ${TICKET} failed`,
        location: "automation",
        agentId: TICKET,
        cause: refused,
      });
      fail = false;
      yield* TestClock.adjust("30 seconds");
      expect(moved).toEqual([automationNeeded(TICKET)]);
      expect(stores.automation.jobs).toHaveLength(1);
    }),
  );

  it.effect("stops polling when its scope closes", () =>
    Effect.gen(function* () {
      let polls = 0;
      const stores = Stores.fakeStores();
      const log = FakeLog.fakeLog();
      const linear = FakeLinear.fakeLinear({
        overrides: {
          listBacklog: Effect.sync(() => {
            polls += 1;
            return [];
          }),
        },
      });
      const scope = yield* Scope.make();
      yield* Backlog.watch().pipe(
        Effect.provide(Layer.mergeAll(stores.layer, linear.layer, log.layer)),
        Scope.provide(scope),
      );
      yield* TestClock.adjust("30 seconds");
      expect(polls).toBe(2);
      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust("90 seconds");
      expect(polls).toBe(2);
      expect(log.lines).toEqual([]);
    }),
  );
});
