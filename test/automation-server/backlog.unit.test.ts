import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer, Option, Scope } from "effect";
import { TestClock } from "effect/testing";
import * as Backlog from "../../src/automation-server/backlog.ts";
import * as Linear from "../../src/ctrl/linear.ts";
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

// The loop in a scope of its own, so a test can close it. Each poll copies `board`: a move
// splices the ticket out, and the next query is what no longer lists it. Mutating the array
// the poll is walking would skip the ticket after it.
const start = (
  board: Array<Linear.LinearBacklogTicket>,
  moveIssue?: Linear.LinearService["moveIssue"],
) =>
  Effect.gen(function* () {
    const stores = Stores.fakeStores();
    const log = FakeLog.fakeLog();
    const moved: Array<Move> = [];
    const recordMove: Linear.LinearService["moveIssue"] = (issue, stateId) =>
      Effect.sync(() => {
        moved.push({ issueId: issue.id, identifier: issue.identifier, stateId });
        const index = board.findIndex((item) => item.identifier === issue.identifier);
        if (index !== -1) {
          board.splice(index, 1);
        }
      });
    const linear = FakeLinear.fakeLinear({
      overrides: {
        listBacklog: Effect.sync(() => [...board]),
        moveIssue: moveIssue ?? recordMove,
      },
    });
    const scope = yield* Scope.make();
    yield* Backlog.watch().pipe(
      Effect.provide(Layer.mergeAll(stores.layer, linear.layer, log.layer)),
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
        const { stores, log, moved } = yield* start(board);
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
            text: "backlog watch moved to Automation Needed; queued drive",
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
      const board = [ticket(TICKET, SEEN)];
      const { stores, moved, log } = yield* start(board);
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
      expect(FakeLog.texts(log)).toEqual(["backlog watch moved to Automation Needed; queued mint"]);
    }),
  );

  it.effect("adopts each ticket on its own rounds, leaving a newer one in the backlog", () =>
    Effect.gen(function* () {
      const board = [ticket(TICKET, SEEN)];
      const { stores, moved } = yield* start(board);
      seedResult(stores.tests, TICKET);
      seedResult(stores.tests, OTHER, OTHER_RESULT);
      yield* TestClock.adjust("59 seconds");
      board.push(ticket(OTHER, SEEN));
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
      const board = [ticket(TICKET, SEEN)];
      const { stores, moved } = yield* start(board);
      seedResult(stores.tests, TICKET);
      yield* TestClock.adjust("59 seconds");
      board[0] = ticket(TICKET, EDITED);
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
      const board = [ticket(TICKET, SEEN)];
      const { stores, moved } = yield* start(board);
      seedResult(stores.tests, TICKET);
      yield* TestClock.adjust("59 seconds");
      board.length = 0;
      yield* TestClock.adjust("1 second");
      board.push(ticket(TICKET, SEEN));
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
        const board = [ticket(TICKET, SEEN)];
        const { stores, moved, log } = yield* start(board);
        yield* TestClock.adjust("90 seconds");
        expect(moved).toEqual([]);
        expect(stores.automation.jobs).toEqual([]);
        expect(FakeLog.texts(log)).toEqual(["backlog watch left the ticket in Backlog; no result"]);
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
      const board = [ticket(TICKET, SEEN)];
      const { stores, moved, log } = yield* start(board);
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
        "backlog watch moved to Automation Needed; drive already queued",
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
            moveIssue: (issue, stateId) =>
              Effect.sync(() => {
                moved.push({ issueId: issue.id, identifier: issue.identifier, stateId });
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
      const board = [ticket(TICKET, SEEN)];
      const { stores, log } = yield* start(board, (issue, stateId) =>
        Effect.suspend(() => {
          if (fail) {
            return Effect.fail(refused);
          }
          moved.push({ issueId: issue.id, identifier: issue.identifier, stateId });
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
        text: `backlog watch failed: linear: moving ${TICKET} failed`,
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

type Column = "listAutomationNeeded" | "listNeedsReview";

// Same clock as the backlog watch. These columns stay listed after a successful enqueue: the
// webhook does not move them, and neither does the watch.
const startColumn = (column: Column, board: Array<Linear.LinearBacklogTicket>) =>
  Effect.gen(function* () {
    const stores = Stores.fakeStores();
    const log = FakeLog.fakeLog();
    const moved: Array<Move> = [];
    const linear = FakeLinear.fakeLinear({
      overrides: {
        [column]: Effect.sync(() => [...board]),
        moveIssue: (issue, stateId) =>
          Effect.sync(() => {
            moved.push({ issueId: issue.id, identifier: issue.identifier, stateId });
          }),
      },
    });
    const scope = yield* Scope.make();
    yield* Backlog.watch().pipe(
      Effect.provide(Layer.mergeAll(stores.layer, linear.layer, log.layer)),
      Scope.provide(scope),
    );
    return { stores, log, moved, linear, scope };
  });

const mintDefinition = {
  id: 1,
  name: "mint",
  description: "install",
  instruction: "boot",
  proof: "desktop",
  createdAt: new Date(0),
};

describe("automation needed watch happy path", () => {
  it.effect(
    "queues a drive after three unchanged rounds and does not queue it again while the ticket stays",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { stores, log, moved } = yield* startColumn("listAutomationNeeded", board);
        seedResult(stores.tests, TICKET);
        yield* TestClock.adjust("60 seconds");
        expect(stores.automation.jobs).toEqual([]);
        expect(moved).toEqual([]);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
        ]);
        expect(moved).toEqual([]);
        expect(FakeLog.texts(log)).toEqual(["automation needed watch queued drive"]);
        yield* TestClock.adjust("60 seconds");
        expect(stores.automation.jobs).toHaveLength(1);
        expect(FakeLog.texts(log)).toEqual(["automation needed watch queued drive"]);
      }),
  );

  it.effect("queues mint when the Automation Needed ticket's result is the mint definition", () =>
    Effect.gen(function* () {
      const board = [ticket(TICKET, SEEN)];
      const { stores, moved, log } = yield* startColumn("listAutomationNeeded", board);
      stores.tests.definitions.push(mintDefinition);
      seedResult(stores.tests, TICKET);
      yield* TestClock.adjust("90 seconds");
      expect(stores.automation.jobs).toEqual([
        expect.objectContaining({ resultId: RESULT, action: "mint", status: "pending" }),
      ]);
      expect(moved).toEqual([]);
      expect(FakeLog.texts(log)).toEqual(["automation needed watch queued mint"]);
    }),
  );

  it.effect(
    "a pending drive is the queue row, so the watch does not enqueue again and says nothing",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { stores, moved, log } = yield* startColumn("listAutomationNeeded", board);
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
        expect(stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
        ]);
        expect(moved).toEqual([]);
        expect(FakeLog.texts(log)).toEqual([]);
        yield* TestClock.adjust("60 seconds");
        expect(stores.automation.jobs).toHaveLength(1);
        expect(log.lines).toHaveLength(0);
      }),
  );

  it.effect("a pending mint is the queue row, so the watch does not enqueue another mint", () =>
    Effect.gen(function* () {
      const board = [ticket(TICKET, SEEN)];
      const { stores, log } = yield* startColumn("listAutomationNeeded", board);
      stores.tests.definitions.push(mintDefinition);
      seedResult(stores.tests, TICKET);
      stores.automation.jobs.push({
        id: "00000000-0000-4000-8000-000000000001",
        resultId: RESULT,
        action: "mint",
        status: "pending",
        reason: null,
        serverId: null,
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
      });
      yield* TestClock.adjust("90 seconds");
      expect(stores.automation.jobs).toEqual([
        expect.objectContaining({ resultId: RESULT, action: "mint", status: "pending" }),
      ]);
      expect(FakeLog.texts(log)).toEqual([]);
      yield* TestClock.adjust("60 seconds");
      expect(stores.automation.jobs).toHaveLength(1);
      expect(log.lines).toHaveLength(0);
    }),
  );
});

describe("needs review watch happy path", () => {
  it.effect("queues a diagnose after three unchanged rounds and does not move the ticket", () =>
    Effect.gen(function* () {
      const board = [ticket(TICKET, SEEN)];
      const { stores, log, moved } = yield* startColumn("listNeedsReview", board);
      seedResult(stores.tests, TICKET);
      yield* TestClock.adjust("60 seconds");
      expect(stores.automation.jobs).toEqual([]);
      yield* TestClock.adjust("30 seconds");
      expect(stores.automation.jobs).toEqual([
        expect.objectContaining({ resultId: RESULT, action: "diagnose", status: "pending" }),
      ]);
      expect(moved).toEqual([]);
      expect(FakeLog.texts(log)).toEqual(["needs review watch queued diagnose"]);
      yield* TestClock.adjust("30 seconds");
      expect(stores.automation.jobs).toHaveLength(1);
      expect(log.lines).toHaveLength(1);
    }),
  );

  it.effect(
    "queues diagnose, not mint, when the Needs Review ticket's result is the mint definition",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { stores, log } = yield* startColumn("listNeedsReview", board);
        stores.tests.definitions.push(mintDefinition);
        seedResult(stores.tests, TICKET);
        yield* TestClock.adjust("90 seconds");
        expect(stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "diagnose", status: "pending" }),
        ]);
        expect(FakeLog.texts(log)).toEqual(["needs review watch queued diagnose"]);
      }),
  );
});

describe("automation needed and needs review watch unhappy path", () => {
  it.effect("an edit resets the Automation Needed rounds", () =>
    Effect.gen(function* () {
      const board = [ticket(TICKET, SEEN)];
      const { stores, moved } = yield* startColumn("listAutomationNeeded", board);
      seedResult(stores.tests, TICKET);
      yield* TestClock.adjust("59 seconds");
      board[0] = ticket(TICKET, EDITED);
      yield* TestClock.adjust("61 seconds");
      expect(stores.automation.jobs).toEqual([]);
      expect(moved).toEqual([]);
      yield* TestClock.adjust("60 seconds");
      expect(stores.automation.jobs).toEqual([
        expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
      ]);
    }),
  );

  it.effect("a ticket that leaves Needs Review is forgotten, and coming back starts over", () =>
    Effect.gen(function* () {
      const board = [ticket(TICKET, SEEN)];
      const { stores } = yield* startColumn("listNeedsReview", board);
      seedResult(stores.tests, TICKET);
      yield* TestClock.adjust("59 seconds");
      board.length = 0;
      yield* TestClock.adjust("1 second");
      board.push(ticket(TICKET, SEEN));
      yield* TestClock.adjust("90 seconds");
      expect(stores.automation.jobs).toEqual([]);
      yield* TestClock.adjust("30 seconds");
      expect(stores.automation.jobs).toEqual([
        expect.objectContaining({ resultId: RESULT, action: "diagnose", status: "pending" }),
      ]);
    }),
  );

  it.effect(
    "no result leaves the Automation Needed ticket, logs once, and a result that appears later is queued once",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { stores, moved, log } = yield* startColumn("listAutomationNeeded", board);
        yield* TestClock.adjust("90 seconds");
        expect(moved).toEqual([]);
        expect(stores.automation.jobs).toEqual([]);
        expect(FakeLog.texts(log)).toEqual([
          "automation needed watch left the ticket in Automation Needed; no result",
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(FakeLog.texts(log)).toEqual([
          "automation needed watch left the ticket in Automation Needed; no result",
        ]);
        seedResult(stores.tests, TICKET);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs).toHaveLength(1);
        expect(FakeLog.texts(log)).toEqual([
          "automation needed watch left the ticket in Automation Needed; no result",
          "automation needed watch queued drive",
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs).toHaveLength(1);
        expect(log.lines).toHaveLength(2);
      }),
  );

  it.effect(
    "a failed drive is not waiting, so the watch records the duplicate and does not insert",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { stores, moved, log } = yield* startColumn("listAutomationNeeded", board);
        seedResult(stores.tests, TICKET);
        stores.automation.jobs.push({
          id: "00000000-0000-4000-8000-000000000001",
          resultId: RESULT,
          action: "drive",
          status: "failed",
          reason: "drive failed",
          serverId: null,
          createdAt: new Date(),
          startedAt: new Date(),
          finishedAt: new Date(),
        });
        yield* TestClock.adjust("90 seconds");
        expect(stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "failed" }),
        ]);
        expect(moved).toEqual([]);
        expect(FakeLog.texts(log)).toEqual(["automation needed watch; drive already queued"]);
        yield* TestClock.adjust("60 seconds");
        expect(stores.automation.jobs).toHaveLength(1);
        expect(log.lines).toHaveLength(1);
      }),
  );

  it.effect("a pending diagnose is not the drive, so the watch still queues the drive", () =>
    Effect.gen(function* () {
      const board = [ticket(TICKET, SEEN)];
      const { stores, log } = yield* startColumn("listAutomationNeeded", board);
      seedResult(stores.tests, TICKET);
      stores.automation.jobs.push({
        id: "00000000-0000-4000-8000-000000000001",
        resultId: RESULT,
        action: "diagnose",
        status: "pending",
        reason: null,
        serverId: null,
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
      });
      yield* TestClock.adjust("90 seconds");
      expect(stores.automation.jobs).toEqual([
        expect.objectContaining({ resultId: RESULT, action: "diagnose", status: "pending" }),
        expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
      ]);
      expect(FakeLog.texts(log)).toEqual(["automation needed watch queued drive"]);
    }),
  );

  it.effect(
    "a pending-job lookup that fails is one error line, and the next poll still queues",
    () =>
      Effect.gen(function* () {
        const refused = Errors.DatabaseError.make({
          operation: "hasPendingAutomationJob",
          message: "Failed query: select from automation_jobs",
          cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        });
        let fail = true;
        const tests = Stores.fakeTestStore();
        const automation = Stores.fakeAutomationStore({
          hasPending: () => (fail ? Effect.fail(refused) : Effect.succeed(false)),
        });
        const log = FakeLog.fakeLog();
        const linear = FakeLinear.fakeLinear({
          overrides: {
            listAutomationNeeded: Effect.sync(() => [ticket(TICKET, SEEN)]),
          },
        });
        seedResult(tests, TICKET);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(Layer.mergeAll(tests.layer, automation.layer, linear.layer, log.layer)),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("90 seconds");
        expect(automation.jobs).toEqual([]);
        expect(log.lines[0]).toMatchObject({
          level: "error",
          text: "automation needed watch failed: connect ECONNREFUSED 127.0.0.1:5432",
          location: "automation",
          agentId: TICKET,
          cause: refused,
        });
        fail = false;
        yield* TestClock.adjust("30 seconds");
        expect(automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
        ]);
        expect(FakeLog.texts(log)).toEqual([
          "automation needed watch failed: connect ECONNREFUSED 127.0.0.1:5432",
          "automation needed watch queued drive",
        ]);
      }),
  );

  it.effect(
    "a failed Automation Needed poll keeps the rounds already saved, and Needs Review still queues",
    () =>
      Effect.gen(function* () {
        const refused = Errors.LinearError.make({
          operation: "listAutomationNeeded",
          message: "linear: request failed",
        });
        let fail = false;
        const stores = Stores.fakeStores();
        const log = FakeLog.fakeLog();
        const automationBoard = [ticket(TICKET, SEEN)];
        const reviewBoard = [ticket(OTHER, SEEN)];
        const linear = FakeLinear.fakeLinear({
          overrides: {
            listAutomationNeeded: Effect.suspend(() =>
              fail ? Effect.fail(refused) : Effect.succeed([...automationBoard]),
            ),
            listNeedsReview: Effect.sync(() => [...reviewBoard]),
          },
        });
        seedResult(stores.tests, TICKET);
        seedResult(stores.tests, OTHER, OTHER_RESULT);
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
            text: "automation needed watch failed: linear: request failed",
            location: "automation",
            agentId: "automation",
            skipSentry: false,
            cause: refused,
          },
        ]);
        fail = false;
        // The failed poll did not reset Automation Needed, and it did not delay Needs Review:
        // this next poll is review's third round and automation's second.
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs.map((job) => job.action)).toEqual(["diagnose"]);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([OTHER_RESULT, RESULT]);
        expect(stores.automation.jobs.map((job) => job.action)).toEqual(["diagnose", "drive"]);
      }),
  );

  it.effect(
    "a failed enqueue keeps the ticket unsettled and retries the enqueue on the next poll",
    () =>
      Effect.gen(function* () {
        const refused = Errors.DatabaseError.make({
          operation: "findResultByLinearId",
          message: "Failed query: select",
          cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        });
        let fail = true;
        const tests = Stores.fakeTestStore(
          {},
          {
            findResultByLinearId: (linearId) =>
              Effect.suspend(() =>
                fail
                  ? Effect.fail(refused)
                  : Effect.sync(() =>
                      Option.fromUndefinedOr(
                        tests.results.find(
                          (row) => row.linearId !== null && row.linearId === linearId,
                        ),
                      ),
                    ),
              ),
          },
        );
        const automation = Stores.fakeAutomationStore();
        const log = FakeLog.fakeLog();
        const board = [ticket(TICKET, SEEN)];
        const linear = FakeLinear.fakeLinear({
          overrides: {
            listAutomationNeeded: Effect.sync(() => [...board]),
          },
        });
        seedResult(tests, TICKET);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(Layer.mergeAll(tests.layer, automation.layer, linear.layer, log.layer)),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("90 seconds");
        expect(automation.jobs).toEqual([]);
        expect(log.lines[0]).toMatchObject({
          level: "error",
          text: "automation needed watch failed: connect ECONNREFUSED 127.0.0.1:5432",
          location: "automation",
          agentId: TICKET,
          cause: refused,
        });
        fail = false;
        yield* TestClock.adjust("30 seconds");
        expect(automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(automation.jobs).toHaveLength(1);
      }),
  );
});
