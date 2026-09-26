import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer, Option, Scope } from "effect";
import { TestClock } from "effect/testing";
import type * as Automation from "@oligarchy/db/automation";
import * as DbErrors from "@oligarchy/db/errors";
import * as Linear from "@oligarchy/linear/client";
import * as LinearErrors from "@oligarchy/linear/errors";
import * as TestingLinear from "@oligarchy/testing/linear";
import * as TestingStores from "@oligarchy/testing/stores";
import * as Backlog from "../../src/automation-server/backlog.ts";
import * as FakeLog from "../support/log.ts";
import * as Stores from "../support/stores.ts";

const TICKET = "OLI-45";
const OTHER = "OLI-46";
const THIRD = "OLI-47";
const FOURTH = "OLI-48";
const RESULT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_RESULT = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const THIRD_RESULT = "cccccccc-dddd-4eee-8fff-111111111111";
const FOURTH_RESULT = "dddddddd-eeee-4fff-8aaa-222222222222";
const CLIENT_STATS = {
  qemus: 0,
  memory: { totalBytes: 1, usedBytes: 0 },
  cpu: { mean1m: 0, mean2m: 0, mean3m: 0 },
};

// One live automation client, unless `url` names another. The check's budget is this list.
const announceClient = (servers: TestingStores.FakeServerStore, url?: string) => {
  const announced = url ?? `http://127.0.0.1:${String(55333 + servers.servers.length)}`;
  const id = crypto.randomUUID();
  servers.servers.push({ id, url: announced, name: null, type: "automation-client" });
  servers.heartbeats.push({
    url: announced,
    type: "automation-client",
    name: "garage",
    stats: CLIENT_STATS,
  });
  return id;
};
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

const seedResult = (tests: TestingStores.FakeTestStore, linearId: string, resultId = RESULT) => {
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

const seedJob = (
  automation: TestingStores.FakeAutomationStore,
  resultId: string,
  action: Automation.AutomationAction,
  status: Automation.AutomationJobRow["status"],
) => {
  automation.jobs.push({
    id: crypto.randomUUID(),
    resultId,
    action,
    status,
    reason: null,
    serverId: null,
    createdAt: new Date(),
    startedAt: null,
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
    const linear = TestingLinear.fakeLinear({
      overrides: {
        listBacklog: Effect.sync(() => [...board]),
        moveIssue: moveIssue ?? recordMove,
      },
    });
    announceClient(stores.servers);
    const scope = yield* Scope.make();
    yield* Backlog.watch().pipe(
      Effect.provide(Layer.mergeAll(stores.layer, linear.layer, log.layer)),
      Scope.provide(scope),
    );
    return { stores, log, moved, linear, scope };
  });

const ready = (identifier: string) => ({ method: "markReady" as const, identifier });

const automationNeeded = (identifier: string): Move => ({
  issueId: `issue-${identifier}`,
  identifier,
  stateId: TestingLinear.STATES.automationNeeded,
});

// Every poll writes one tracking line per column that lists a ticket. `acted` is everything else:
// what the watch did to a ticket, and what failed.
const TRACKING = " watch tracking out of bounds tickets; ";
const tracked = (log: FakeLog.FakeLog): ReadonlyArray<string> =>
  FakeLog.texts(log).filter((text) => text.includes(TRACKING));
const acted = (log: FakeLog.FakeLog): ReadonlyArray<string> =>
  FakeLog.texts(log).filter((text) => !text.includes(TRACKING));
const errors = (log: FakeLog.FakeLog): ReadonlyArray<FakeLog.Line> =>
  log.lines.filter((line) => line.level === "error");

const trackingLine = (text: string): FakeLog.Line => ({
  level: "info",
  text,
  location: "automation",
  agentId: "automation",
  skipSentry: false,
  cause: undefined,
});

describe("backlog watch happy path", () => {
  it.effect(
    "saves a backlog ticket and, after three unchanged thirty-second rounds, moves it to Automation Needed and queues its drive",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { stores, log, moved, linear } = yield* start(board);
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
        expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([ready(TICKET)]);
        expect(log.lines).toEqual([
          trackingLine("backlog watch tracking out of bounds tickets; OLI-45 0/3 pings"),
          trackingLine("backlog watch tracking out of bounds tickets; OLI-45 1/3 pings"),
          trackingLine("backlog watch tracking out of bounds tickets; OLI-45 2/3 pings"),
          trackingLine("backlog watch tracking out of bounds tickets; OLI-45 3/3 pings"),
          {
            level: "info",
            text: "backlog watch processing out of bounds ticket; 3/3 pings; queueing drive and moving it to Automation Needed",
            location: "automation",
            agentId: TICKET,
            skipSentry: false,
            cause: undefined,
          },
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

  it.effect("logs every backlog ticket it tracks, with its pings, on every poll", () =>
    Effect.gen(function* () {
      const board = [ticket(TICKET, SEEN)];
      const { log } = yield* start(board);
      yield* TestClock.adjust("29 seconds");
      board.push(ticket(OTHER, SEEN));
      yield* TestClock.adjust("31 seconds");
      expect(log.lines).toEqual([
        trackingLine("backlog watch tracking out of bounds tickets; OLI-45 0/3 pings"),
        trackingLine(
          "backlog watch tracking out of bounds tickets; OLI-45 1/3 pings, OLI-46 0/3 pings",
        ),
        trackingLine(
          "backlog watch tracking out of bounds tickets; OLI-45 2/3 pings, OLI-46 1/3 pings",
        ),
      ]);
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

  it.effect(
    "kicks off one ripe backlog ticket per thirty-second check and leaves the next ticket for the next check",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN), ticket(OTHER, SEEN)];
        const { stores, moved } = yield* start(board);
        seedResult(stores.tests, TICKET);
        seedResult(stores.tests, OTHER, OTHER_RESULT);
        yield* TestClock.adjust("90 seconds");
        expect(moved).toEqual([automationNeeded(TICKET)]);
        expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([RESULT]);
        yield* TestClock.adjust("30 seconds");
        expect(moved).toEqual([automationNeeded(TICKET), automationNeeded(OTHER)]);
        expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([RESULT, OTHER_RESULT]);
      }),
  );

  it.effect(
    "a ripe backlog ticket is the one job, and a ripe Needs Review ticket waits for the next check",
    () =>
      Effect.gen(function* () {
        const backlog = [ticket(TICKET, SEEN)];
        const review = [ticket(OTHER, SEEN)];
        const stores = Stores.fakeStores();
        const log = FakeLog.fakeLog();
        const moved: Array<Move> = [];
        const linear = TestingLinear.fakeLinear({
          overrides: {
            listBacklog: Effect.sync(() => [...backlog]),
            listNeedsReview: Effect.sync(() => [...review]),
            moveIssue: (issue, stateId) =>
              Effect.sync(() => {
                moved.push({ issueId: issue.id, identifier: issue.identifier, stateId });
                const index = backlog.findIndex((item) => item.identifier === issue.identifier);
                if (index !== -1) {
                  backlog.splice(index, 1);
                }
              }),
          },
        });
        seedResult(stores.tests, TICKET);
        seedResult(stores.tests, OTHER, OTHER_RESULT);
        announceClient(stores.servers);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(Layer.mergeAll(stores.layer, linear.layer, log.layer)),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("90 seconds");
        expect(moved).toEqual([automationNeeded(TICKET)]);
        expect(stores.automation.jobs.map((job) => job.action)).toEqual(["drive"]);
        yield* TestClock.adjust("30 seconds");
        expect(moved).toEqual([automationNeeded(TICKET)]);
        expect(stores.automation.jobs.map((job) => job.action)).toEqual(["drive", "diagnose"]);
      }),
  );

  it.effect(
    "a ripe Automation Needed ticket is the one job, and a ripe Needs Review ticket waits for the next check",
    () =>
      Effect.gen(function* () {
        const needed = [ticket(TICKET, SEEN)];
        const review = [ticket(OTHER, SEEN)];
        const stores = Stores.fakeStores();
        const log = FakeLog.fakeLog();
        const linear = TestingLinear.fakeLinear({
          overrides: {
            listAutomationNeeded: Effect.sync(() => [...needed]),
            listNeedsReview: Effect.sync(() => [...review]),
          },
        });
        seedResult(stores.tests, TICKET);
        seedResult(stores.tests, OTHER, OTHER_RESULT);
        announceClient(stores.servers);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(Layer.mergeAll(stores.layer, linear.layer, log.layer)),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("90 seconds");
        expect(stores.automation.jobs.map((job) => job.action)).toEqual(["drive"]);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs.map((job) => job.action)).toEqual(["drive", "diagnose"]);
      }),
  );

  it.effect(
    "an already queued backlog ticket does not spend the check, so the next ripe ticket is the one new job",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN), ticket(OTHER, SEEN)];
        const { stores, moved } = yield* start(board);
        seedResult(stores.tests, TICKET);
        seedResult(stores.tests, OTHER, OTHER_RESULT);
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
        expect(moved).toEqual([automationNeeded(TICKET), automationNeeded(OTHER)]);
        expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([RESULT, OTHER_RESULT]);
      }),
  );

  it.effect(
    "kicks off one ripe ticket per live client and leaves the rest for the next check",
    () =>
      Effect.gen(function* () {
        const board = [
          ticket(TICKET, SEEN),
          ticket(OTHER, SEEN),
          ticket(THIRD, SEEN),
          ticket(FOURTH, SEEN),
        ];
        const { stores, moved } = yield* start(board);
        announceClient(stores.servers);
        announceClient(stores.servers);
        seedResult(stores.tests, TICKET);
        seedResult(stores.tests, OTHER, OTHER_RESULT);
        seedResult(stores.tests, THIRD, THIRD_RESULT);
        seedResult(stores.tests, FOURTH, FOURTH_RESULT);
        yield* TestClock.adjust("90 seconds");
        expect(moved.map((item) => item.identifier)).toEqual([TICKET, OTHER, THIRD]);
        expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([
          RESULT,
          OTHER_RESULT,
          THIRD_RESULT,
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(moved.map((item) => item.identifier)).toEqual([TICKET, OTHER, THIRD, FOURTH]);
        expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([
          RESULT,
          OTHER_RESULT,
          THIRD_RESULT,
          FOURTH_RESULT,
        ]);
      }),
  );

  it.effect(
    "no live client kicks off nothing and says nothing, and a client that appears is used on the next check with the pings the ticket has",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const stores = Stores.fakeStores();
        const log = FakeLog.fakeLog();
        const moved: Array<Move> = [];
        const linear = TestingLinear.fakeLinear({
          overrides: {
            listBacklog: Effect.sync(() => [...board]),
            moveIssue: (issue, stateId) =>
              Effect.sync(() => {
                moved.push({ issueId: issue.id, identifier: issue.identifier, stateId });
                board.length = 0;
              }),
          },
        });
        seedResult(stores.tests, TICKET);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(Layer.mergeAll(stores.layer, linear.layer, log.layer)),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("90 seconds");
        expect(moved).toEqual([]);
        expect(stores.automation.jobs).toEqual([]);
        expect(acted(log)).toEqual([]);
        expect(tracked(log).at(-1)).toBe(
          "backlog watch tracking out of bounds tickets; OLI-45 3/3 pings",
        );
        announceClient(stores.servers);
        yield* TestClock.adjust("30 seconds");
        expect(moved).toEqual([automationNeeded(TICKET)]);
        expect(stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
        ]);
        expect(acted(log)).toEqual([
          "backlog watch processing out of bounds ticket; 4/3 pings; queueing drive and moving it to Automation Needed",
          "backlog watch moved to Automation Needed; queued drive",
        ]);
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
    "an edit starts a ticket's pings over, and a ticket that leaves drops out of the tracking line",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN), ticket(OTHER, SEEN)];
        const { log } = yield* start(board);
        yield* TestClock.adjust("30 seconds");
        board.splice(0, 2, ticket(TICKET, EDITED));
        yield* TestClock.adjust("30 seconds");
        board.length = 0;
        yield* TestClock.adjust("30 seconds");
        expect(tracked(log)).toEqual([
          "backlog watch tracking out of bounds tickets; OLI-45 0/3 pings, OLI-46 0/3 pings",
          "backlog watch tracking out of bounds tickets; OLI-45 1/3 pings, OLI-46 1/3 pings",
          "backlog watch tracking out of bounds tickets; OLI-45 0/3 pings",
        ]);
        expect(acted(log)).toEqual([]);
      }),
  );

  it.effect(
    "no result leaves the ticket in the backlog without processing it, and a result that appears later is adopted on the next poll",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { stores, moved, log } = yield* start(board);
        yield* TestClock.adjust("90 seconds");
        expect(moved).toEqual([]);
        expect(stores.automation.jobs).toEqual([]);
        expect(acted(log)).toEqual(["backlog watch left the ticket in Backlog; no result"]);
        seedResult(stores.tests, TICKET);
        yield* TestClock.adjust("30 seconds");
        expect(moved).toEqual([automationNeeded(TICKET)]);
        expect(stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
        ]);
        expect(acted(log)).toEqual([
          "backlog watch left the ticket in Backlog; no result",
          "backlog watch processing out of bounds ticket; 4/3 pings; queueing drive and moving it to Automation Needed",
          "backlog watch moved to Automation Needed; queued drive",
        ]);
      }),
  );

  it.effect("a drive already queued still moves the ticket (duplicate)", () =>
    Effect.gen(function* () {
      const board = [ticket(TICKET, SEEN)];
      const { stores, moved, log, linear } = yield* start(board);
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
      expect(acted(log)).toEqual([
        "backlog watch processing out of bounds ticket; 3/3 pings; queueing drive and moving it to Automation Needed",
        "backlog watch moved to Automation Needed; drive already queued",
      ]);
      expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([ready(TICKET)]);
    }),
  );

  it.effect(
    "a failed Linear poll is one error line, keeps the rounds already saved, and the next polls still run",
    () =>
      Effect.gen(function* () {
        const refused = LinearErrors.LinearError.make({
          operation: "listBacklog",
          message: "linear: request failed",
        });
        let fail = false;
        const stores = Stores.fakeStores();
        const log = FakeLog.fakeLog();
        const moved: Array<Move> = [];
        const linear = TestingLinear.fakeLinear({
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
        announceClient(stores.servers);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(Layer.mergeAll(stores.layer, linear.layer, log.layer)),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("30 seconds");
        fail = true;
        yield* TestClock.adjust("30 seconds");
        // The failed poll saw no tickets, so it tracks none.
        expect(log.lines).toEqual([
          trackingLine("backlog watch tracking out of bounds tickets; OLI-45 0/3 pings"),
          trackingLine("backlog watch tracking out of bounds tickets; OLI-45 1/3 pings"),
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
      const refused = LinearErrors.LinearError.make({
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
      expect(errors(log)).toEqual([
        expect.objectContaining({
          level: "error",
          text: `backlog watch failed: linear: moving ${TICKET} failed`,
          location: "automation",
          agentId: TICKET,
          cause: refused,
        }),
      ]);
      fail = false;
      yield* TestClock.adjust("30 seconds");
      expect(moved).toEqual([automationNeeded(TICKET)]);
      expect(stores.automation.jobs).toHaveLength(1);
      expect(acted(log)).toEqual([
        "backlog watch processing out of bounds ticket; 3/3 pings; queueing drive and moving it to Automation Needed",
        `backlog watch failed: linear: moving ${TICKET} failed`,
        "backlog watch processing out of bounds ticket; 4/3 pings; queueing drive and moving it to Automation Needed",
        "backlog watch moved to Automation Needed; drive already queued",
      ]);
    }),
  );

  it.effect(
    "a ready label that fails leaves the ticket in Backlog, and the next poll labels and moves it",
    () =>
      Effect.gen(function* () {
        const refused = LinearErrors.LinearError.make({
          operation: "markReady",
          message: `linear: labeling ${TICKET} ready failed`,
        });
        let fail = true;
        const board = [ticket(TICKET, SEEN)];
        const stores = Stores.fakeStores();
        const log = FakeLog.fakeLog();
        const steps: Array<string> = [];
        const linear = TestingLinear.fakeLinear({
          overrides: {
            listBacklog: Effect.sync(() => [...board]),
            markReady: () =>
              fail
                ? Effect.fail(refused)
                : Effect.sync(() => {
                    steps.push("ready");
                  }),
            moveIssue: () =>
              Effect.sync(() => {
                steps.push("move");
              }),
          },
        });
        seedResult(stores.tests, TICKET);
        announceClient(stores.servers);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(Layer.mergeAll(stores.layer, linear.layer, log.layer)),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("90 seconds");
        expect(stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
        ]);
        expect(steps).toEqual([]);
        expect(errors(log)).toEqual([
          expect.objectContaining({
            level: "error",
            text: `backlog watch failed: linear: labeling ${TICKET} ready failed`,
            location: "automation",
            agentId: TICKET,
            cause: refused,
          }),
        ]);
        fail = false;
        yield* TestClock.adjust("30 seconds");
        expect(steps).toEqual(["ready", "move"]);
        expect(stores.automation.jobs).toHaveLength(1);
        expect(acted(log)).toEqual([
          "backlog watch processing out of bounds ticket; 3/3 pings; queueing drive and moving it to Automation Needed",
          `backlog watch failed: linear: labeling ${TICKET} ready failed`,
          "backlog watch processing out of bounds ticket; 4/3 pings; queueing drive and moving it to Automation Needed",
          "backlog watch moved to Automation Needed; drive already queued",
        ]);
      }),
  );

  it.effect(
    "no result does not spend the check: the next ticket is the one job, and a third waits",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN), ticket(OTHER, SEEN), ticket(THIRD, SEEN)];
        const { stores, moved, log } = yield* start(board);
        seedResult(stores.tests, OTHER, OTHER_RESULT);
        seedResult(stores.tests, THIRD, THIRD_RESULT);
        yield* TestClock.adjust("90 seconds");
        expect(moved).toEqual([automationNeeded(OTHER)]);
        expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([OTHER_RESULT]);
        expect(log.lines.filter((line) => line.agentId !== "automation")).toEqual([
          expect.objectContaining({
            text: "backlog watch left the ticket in Backlog; no result",
            agentId: TICKET,
          }),
          expect.objectContaining({
            text: "backlog watch processing out of bounds ticket; 3/3 pings; queueing drive and moving it to Automation Needed",
            agentId: OTHER,
          }),
          expect.objectContaining({
            text: "backlog watch moved to Automation Needed; queued drive",
            agentId: OTHER,
          }),
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(moved).toEqual([automationNeeded(OTHER), automationNeeded(THIRD)]);
        expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([
          OTHER_RESULT,
          THIRD_RESULT,
        ]);
        expect(board.map((item) => item.identifier)).toEqual([TICKET]);
      }),
  );

  it.effect(
    "a failed enqueue does not spend the check: the next ticket is the one job, and a third waits",
    () =>
      Effect.gen(function* () {
        const refused = DbErrors.DatabaseError.make({
          operation: "findResultByLinearId",
          message: "Failed query: select",
          cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        });
        const tests = TestingStores.fakeTestStore(
          {},
          {
            findResultByLinearId: (linearId) =>
              Effect.suspend(() =>
                linearId === TICKET
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
        const automation = TestingStores.fakeAutomationStore();
        const servers = TestingStores.fakeServerStore();
        const log = FakeLog.fakeLog();
        announceClient(servers);
        const board = [ticket(TICKET, SEEN), ticket(OTHER, SEEN), ticket(THIRD, SEEN)];
        const moved: Array<Move> = [];
        const linear = TestingLinear.fakeLinear({
          overrides: {
            listBacklog: Effect.sync(() => [...board]),
            moveIssue: (issue, stateId) =>
              Effect.sync(() => {
                moved.push({ issueId: issue.id, identifier: issue.identifier, stateId });
                const index = board.findIndex((item) => item.identifier === issue.identifier);
                if (index !== -1) {
                  board.splice(index, 1);
                }
              }),
          },
        });
        seedResult(tests, TICKET);
        seedResult(tests, OTHER, OTHER_RESULT);
        seedResult(tests, THIRD, THIRD_RESULT);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(
            Layer.mergeAll(tests.layer, automation.layer, servers.layer, linear.layer, log.layer),
          ),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("90 seconds");
        expect(automation.jobs.map((job) => job.resultId)).toEqual([OTHER_RESULT]);
        expect(moved).toEqual([automationNeeded(OTHER)]);
        // The lookup failed before the watch did anything to the ticket, so it never says it
        // is processing it.
        expect(log.lines.filter((line) => line.agentId === TICKET)).toEqual([
          expect.objectContaining({
            level: "error",
            text: "backlog watch failed: connect ECONNREFUSED 127.0.0.1:5432",
            location: "automation",
            agentId: TICKET,
            cause: refused,
          }),
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(automation.jobs.map((job) => job.resultId)).toEqual([OTHER_RESULT, THIRD_RESULT]);
        expect(moved).toEqual([automationNeeded(OTHER), automationNeeded(THIRD)]);
      }),
  );

  it.effect(
    "a failed move spends the check, so a second ripe ticket is not queued until the next check",
    () =>
      Effect.gen(function* () {
        const refused = LinearErrors.LinearError.make({
          operation: "moveIssue",
          message: `linear: moving ${TICKET} failed`,
        });
        let fail = true;
        const board = [ticket(TICKET, SEEN), ticket(OTHER, SEEN)];
        const moved: Array<Move> = [];
        const { stores, log } = yield* start(board, (issue, stateId) =>
          Effect.suspend(() => {
            if (fail && issue.identifier === TICKET) {
              return Effect.fail(refused);
            }
            moved.push({ issueId: issue.id, identifier: issue.identifier, stateId });
            const index = board.findIndex((item) => item.identifier === issue.identifier);
            if (index !== -1) {
              board.splice(index, 1);
            }
            return Effect.void;
          }),
        );
        seedResult(stores.tests, TICKET);
        seedResult(stores.tests, OTHER, OTHER_RESULT);
        yield* TestClock.adjust("90 seconds");
        expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([RESULT]);
        expect(moved).toEqual([]);
        expect(errors(log)).toEqual([
          expect.objectContaining({
            level: "error",
            text: `backlog watch failed: linear: moving ${TICKET} failed`,
            location: "automation",
            agentId: TICKET,
            cause: refused,
          }),
        ]);
        fail = false;
        yield* TestClock.adjust("30 seconds");
        expect(moved.map((item) => item.identifier)).toEqual([TICKET, OTHER]);
        expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([RESULT, OTHER_RESULT]);
      }),
  );

  it.effect("stops polling when its scope closes", () =>
    Effect.gen(function* () {
      let polls = 0;
      const stores = Stores.fakeStores();
      const log = FakeLog.fakeLog();
      const linear = TestingLinear.fakeLinear({
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
    const linear = TestingLinear.fakeLinear({
      overrides: {
        [column]: Effect.sync(() => [...board]),
        moveIssue: (issue, stateId) =>
          Effect.sync(() => {
            moved.push({ issueId: issue.id, identifier: issue.identifier, stateId });
          }),
      },
    });
    announceClient(stores.servers);
    const scope = yield* Scope.make();
    yield* Backlog.watch().pipe(
      Effect.provide(Layer.mergeAll(stores.layer, linear.layer, log.layer)),
      Scope.provide(scope),
    );
    return { stores, log, moved, linear, scope };
  });

// Retention deletes TICKET's result right after the watch reads it, so any later lookup is empty.
const startDeleting = (column: "listBacklog" | Column, board: Array<Linear.LinearBacklogTicket>) =>
  Effect.gen(function* () {
    const tests = TestingStores.fakeTestStore(
      {},
      {
        findResultByLinearId: (linearId) =>
          Effect.sync(() => {
            const index = tests.results.findIndex((row) => row.linearId === linearId);
            return Option.fromUndefinedOr(
              index === -1 ? undefined : tests.results.splice(index, 1)[0],
            );
          }),
      },
    );
    const automation = TestingStores.fakeAutomationStore();
    const servers = TestingStores.fakeServerStore();
    const log = FakeLog.fakeLog();
    const moved: Array<Move> = [];
    const linear = TestingLinear.fakeLinear({
      overrides: {
        [column]: Effect.sync(() => [...board]),
        moveIssue: (issue, stateId) =>
          Effect.sync(() => {
            moved.push({ issueId: issue.id, identifier: issue.identifier, stateId });
            const index = board.findIndex((item) => item.identifier === issue.identifier);
            if (index !== -1) {
              board.splice(index, 1);
            }
          }),
      },
    });
    seedResult(tests, TICKET);
    announceClient(servers);
    const scope = yield* Scope.make();
    yield* Backlog.watch().pipe(
      Effect.provide(
        Layer.mergeAll(tests.layer, automation.layer, servers.layer, linear.layer, log.layer),
      ),
      Scope.provide(scope),
    );
    return { tests, automation, log, moved, linear };
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
        const { stores, log, moved, linear } = yield* startColumn("listAutomationNeeded", board);
        seedResult(stores.tests, TICKET);
        yield* TestClock.adjust("60 seconds");
        expect(stores.automation.jobs).toEqual([]);
        expect(moved).toEqual([]);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
        ]);
        expect(moved).toEqual([]);
        expect(acted(log)).toEqual([
          "automation needed watch processing out of bounds ticket; 3/3 pings; queueing drive",
          "automation needed watch queued drive",
        ]);
        expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([ready(TICKET)]);
        yield* TestClock.adjust("60 seconds");
        expect(stores.automation.jobs).toHaveLength(1);
        expect(acted(log)).toEqual([
          "automation needed watch processing out of bounds ticket; 3/3 pings; queueing drive",
          "automation needed watch queued drive",
        ]);
        expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([ready(TICKET)]);
        expect(tracked(log)).toEqual([
          "automation needed watch tracking out of bounds tickets; OLI-45 0/3 pings",
          "automation needed watch tracking out of bounds tickets; OLI-45 1/3 pings",
          "automation needed watch tracking out of bounds tickets; OLI-45 2/3 pings",
          "automation needed watch tracking out of bounds tickets; OLI-45 3/3 pings",
          "automation needed watch tracking out of bounds tickets; OLI-45 4/3 pings (handled)",
          "automation needed watch tracking out of bounds tickets; OLI-45 5/3 pings (handled)",
        ]);
      }),
  );

  it.effect(
    "queues one ripe Automation Needed ticket per thirty-second check and the next ticket on the next check",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN), ticket(OTHER, SEEN)];
        const { stores } = yield* startColumn("listAutomationNeeded", board);
        seedResult(stores.tests, TICKET);
        seedResult(stores.tests, OTHER, OTHER_RESULT);
        yield* TestClock.adjust("90 seconds");
        expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([RESULT]);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([RESULT, OTHER_RESULT]);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs).toHaveLength(2);
      }),
  );

  it.effect(
    "an already queued Automation Needed ticket does not spend the check, so the next ripe ticket is queued",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN), ticket(OTHER, SEEN)];
        const { stores, log, linear } = yield* startColumn("listAutomationNeeded", board);
        seedResult(stores.tests, TICKET);
        seedResult(stores.tests, OTHER, OTHER_RESULT);
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
        expect(stores.automation.jobs.map((job) => job.resultId)).toEqual([RESULT, OTHER_RESULT]);
        const lines = [
          "automation needed watch processing out of bounds ticket; 3/3 pings; drive already pending, labeling it ready",
          "automation needed watch processing out of bounds ticket; 3/3 pings; queueing drive",
          "automation needed watch queued drive",
        ];
        expect(acted(log)).toEqual(lines);
        expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([
          ready(TICKET),
          ready(OTHER),
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs).toHaveLength(2);
        expect(acted(log)).toEqual(lines);
      }),
  );

  it.effect(
    "a pending drive is the queue row, so the watch only labels it ready and says so, once",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { stores, moved, log, linear } = yield* startColumn("listAutomationNeeded", board);
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
        const lines = [
          "automation needed watch processing out of bounds ticket; 3/3 pings; drive already pending, labeling it ready",
        ];
        expect(acted(log)).toEqual(lines);
        expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([ready(TICKET)]);
        yield* TestClock.adjust("60 seconds");
        expect(stores.automation.jobs).toHaveLength(1);
        expect(acted(log)).toEqual(lines);
        expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([ready(TICKET)]);
      }),
  );

  it.effect("a pending mint is the queue row, so the watch does not enqueue another mint", () =>
    Effect.gen(function* () {
      const board = [ticket(TICKET, SEEN)];
      const { stores, log, linear } = yield* startColumn("listAutomationNeeded", board);
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
      const lines = [
        "automation needed watch processing out of bounds ticket; 3/3 pings; mint already pending, labeling it ready",
      ];
      expect(acted(log)).toEqual(lines);
      expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([ready(TICKET)]);
      yield* TestClock.adjust("60 seconds");
      expect(stores.automation.jobs).toHaveLength(1);
      expect(acted(log)).toEqual(lines);
      expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([ready(TICKET)]);
    }),
  );
});

describe("needs review watch happy path", () => {
  it.effect("queues a diagnose after three unchanged rounds and does not move the ticket", () =>
    Effect.gen(function* () {
      const board = [ticket(TICKET, SEEN)];
      const { stores, log, moved, linear } = yield* startColumn("listNeedsReview", board);
      seedResult(stores.tests, TICKET);
      yield* TestClock.adjust("60 seconds");
      expect(stores.automation.jobs).toEqual([]);
      yield* TestClock.adjust("30 seconds");
      expect(stores.automation.jobs).toEqual([
        expect.objectContaining({ resultId: RESULT, action: "diagnose", status: "pending" }),
      ]);
      expect(moved).toEqual([]);
      const lines = [
        "needs review watch processing out of bounds ticket; 3/3 pings; queueing diagnose",
        "needs review watch queued diagnose",
      ];
      expect(acted(log)).toEqual(lines);
      expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([]);
      yield* TestClock.adjust("30 seconds");
      expect(stores.automation.jobs).toHaveLength(1);
      expect(acted(log)).toEqual(lines);
      expect(tracked(log).at(-1)).toBe(
        "needs review watch tracking out of bounds tickets; OLI-45 4/3 pings (handled)",
      );
    }),
  );

  it.effect(
    "a diagnose that already ran leaves the Needs Review ticket alone, with no line, even after an edit",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { stores, log, moved } = yield* startColumn("listNeedsReview", board);
        seedResult(stores.tests, TICKET);
        seedJob(stores.automation, RESULT, "diagnose", "failed");
        yield* TestClock.adjust("120 seconds");
        expect(stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "diagnose", status: "failed" }),
        ]);
        expect(moved).toEqual([]);
        expect(acted(log)).toEqual([]);
        expect(tracked(log).at(-1)).toBe(
          "needs review watch tracking out of bounds tickets; OLI-45 4/3 pings (handled)",
        );
        board[0] = ticket(TICKET, EDITED);
        yield* TestClock.adjust("150 seconds");
        expect(tracked(log).at(-1)).toBe(
          "needs review watch tracking out of bounds tickets; OLI-45 4/3 pings (handled)",
        );
        expect(tracked(log).at(-5)).toBe(
          "needs review watch tracking out of bounds tickets; OLI-45 0/3 pings",
        );
        expect(stores.automation.jobs).toHaveLength(1);
        expect(acted(log)).toEqual([]);
      }),
  );

  it.effect(
    "a diagnose already pending is left alone and does not spend the check, so the next ripe ticket is queued",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN), ticket(OTHER, SEEN)];
        const { stores, log } = yield* startColumn("listNeedsReview", board);
        seedResult(stores.tests, TICKET);
        seedResult(stores.tests, OTHER, OTHER_RESULT);
        seedJob(stores.automation, RESULT, "diagnose", "pending");
        yield* TestClock.adjust("90 seconds");
        expect(stores.automation.jobs.map((job) => [job.resultId, job.action])).toEqual([
          [RESULT, "diagnose"],
          [OTHER_RESULT, "diagnose"],
        ]);
        expect(
          log.lines
            .filter((line) => !line.text.includes(TRACKING))
            .map((line) => [line.agentId, line.text]),
        ).toEqual([
          [
            OTHER,
            "needs review watch processing out of bounds ticket; 3/3 pings; queueing diagnose",
          ],
          [OTHER, "needs review watch queued diagnose"],
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs).toHaveLength(2);
        expect(tracked(log).at(-1)).toBe(
          "needs review watch tracking out of bounds tickets; OLI-45 4/3 pings (handled), OLI-46 4/3 pings (handled)",
        );
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
        expect(acted(log)).toEqual([
          "automation needed watch left the ticket in Automation Needed; no result",
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(acted(log)).toEqual([
          "automation needed watch left the ticket in Automation Needed; no result",
        ]);
        seedResult(stores.tests, TICKET);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs).toHaveLength(1);
        const lines = [
          "automation needed watch left the ticket in Automation Needed; no result",
          "automation needed watch processing out of bounds ticket; 5/3 pings; queueing drive",
          "automation needed watch queued drive",
        ];
        expect(acted(log)).toEqual(lines);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs).toHaveLength(1);
        expect(acted(log)).toEqual(lines);
      }),
  );

  it.effect(
    "no result leaves the Needs Review ticket, logs once, and a result that appears later is queued once",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { stores, moved, log } = yield* startColumn("listNeedsReview", board);
        yield* TestClock.adjust("90 seconds");
        expect(moved).toEqual([]);
        expect(stores.automation.jobs).toEqual([]);
        expect(acted(log)).toEqual([
          "needs review watch left the ticket in Needs Review; no result",
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(acted(log)).toEqual([
          "needs review watch left the ticket in Needs Review; no result",
        ]);
        seedResult(stores.tests, TICKET);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "diagnose", status: "pending" }),
        ]);
        const lines = [
          "needs review watch left the ticket in Needs Review; no result",
          "needs review watch processing out of bounds ticket; 5/3 pings; queueing diagnose",
          "needs review watch queued diagnose",
        ];
        expect(acted(log)).toEqual(lines);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs).toHaveLength(1);
        expect(acted(log)).toEqual(lines);
      }),
  );

  it.effect(
    "a drive that already failed is left alone and unlabeled, with no line, even after an edit",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { stores, moved, log, linear } = yield* startColumn("listAutomationNeeded", board);
        seedResult(stores.tests, TICKET);
        seedJob(stores.automation, RESULT, "drive", "failed");
        yield* TestClock.adjust("90 seconds");
        expect(stores.automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "failed" }),
        ]);
        expect(moved).toEqual([]);
        expect(acted(log)).toEqual([]);
        expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([]);
        yield* TestClock.adjust("30 seconds");
        expect(tracked(log).at(-1)).toBe(
          "automation needed watch tracking out of bounds tickets; OLI-45 4/3 pings (handled)",
        );
        // An edit starts a new snapshot, so the watch checks again and still has nothing to say.
        board[0] = ticket(TICKET, EDITED);
        yield* TestClock.adjust("150 seconds");
        expect(tracked(log).slice(-5)).toEqual([
          "automation needed watch tracking out of bounds tickets; OLI-45 0/3 pings",
          "automation needed watch tracking out of bounds tickets; OLI-45 1/3 pings",
          "automation needed watch tracking out of bounds tickets; OLI-45 2/3 pings",
          "automation needed watch tracking out of bounds tickets; OLI-45 3/3 pings",
          "automation needed watch tracking out of bounds tickets; OLI-45 4/3 pings (handled)",
        ]);
        expect(stores.automation.jobs).toHaveLength(1);
        expect(acted(log)).toEqual([]);
        expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([]);
      }),
  );

  it.effect(
    "a drive that is running or already ran is left alone and does not spend the check, so a ticket with no drive is queued",
    () =>
      Effect.gen(function* () {
        const board = [
          ticket(TICKET, SEEN),
          ticket(OTHER, SEEN),
          ticket(THIRD, SEEN),
          ticket(FOURTH, SEEN),
        ];
        const { stores, log, linear } = yield* startColumn("listAutomationNeeded", board);
        seedResult(stores.tests, TICKET);
        seedResult(stores.tests, OTHER, OTHER_RESULT);
        seedResult(stores.tests, THIRD, THIRD_RESULT);
        seedResult(stores.tests, FOURTH, FOURTH_RESULT);
        seedJob(stores.automation, RESULT, "drive", "running");
        seedJob(stores.automation, OTHER_RESULT, "drive", "succeeded");
        seedJob(stores.automation, THIRD_RESULT, "drive", "aborted");
        yield* TestClock.adjust("90 seconds");
        expect(stores.automation.jobs.map((job) => [job.resultId, job.status])).toEqual([
          [RESULT, "running"],
          [OTHER_RESULT, "succeeded"],
          [THIRD_RESULT, "aborted"],
          [FOURTH_RESULT, "pending"],
        ]);
        expect(
          log.lines
            .filter((line) => !line.text.includes(TRACKING))
            .map((line) => [line.agentId, line.text]),
        ).toEqual([
          [
            FOURTH,
            "automation needed watch processing out of bounds ticket; 3/3 pings; queueing drive",
          ],
          [FOURTH, "automation needed watch queued drive"],
        ]);
        expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([ready(FOURTH)]);
        yield* TestClock.adjust("30 seconds");
        expect(stores.automation.jobs).toHaveLength(4);
        expect(tracked(log).at(-1)).toBe(
          "automation needed watch tracking out of bounds tickets; OLI-45 4/3 pings (handled), OLI-46 4/3 pings (handled), OLI-47 4/3 pings (handled), OLI-48 4/3 pings (handled)",
        );
      }),
  );

  it.effect("a pending diagnose is not the drive, so the watch still queues the drive", () =>
    Effect.gen(function* () {
      const board = [ticket(TICKET, SEEN)];
      const { stores, log, linear } = yield* startColumn("listAutomationNeeded", board);
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
      expect(acted(log)).toEqual([
        "automation needed watch processing out of bounds ticket; 3/3 pings; queueing drive",
        "automation needed watch queued drive",
      ]);
      expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([ready(TICKET)]);
    }),
  );

  it.effect(
    "a ready label that fails leaves the pending drive unlabeled and the next poll tries again",
    () =>
      Effect.gen(function* () {
        const refused = LinearErrors.LinearError.make({
          operation: "markReady",
          message: "linear: labeling OLI-45 ready failed",
        });
        let fail = true;
        const board = [ticket(TICKET, SEEN)];
        const stores = Stores.fakeStores();
        const log = FakeLog.fakeLog();
        const labeled: Array<string> = [];
        const linear = TestingLinear.fakeLinear({
          overrides: {
            listAutomationNeeded: Effect.sync(() => [...board]),
            markReady: (identifier) =>
              fail
                ? Effect.fail(refused)
                : Effect.sync(() => {
                    labeled.push(identifier);
                  }),
          },
        });
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
        announceClient(stores.servers);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(Layer.mergeAll(stores.layer, linear.layer, log.layer)),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("90 seconds");
        expect(stores.automation.jobs).toHaveLength(1);
        expect(labeled).toEqual([]);
        expect(errors(log)).toEqual([
          expect.objectContaining({
            level: "error",
            text: "automation needed watch failed: linear: labeling OLI-45 ready failed",
            location: "automation",
            agentId: TICKET,
            cause: refused,
          }),
        ]);
        fail = false;
        yield* TestClock.adjust("30 seconds");
        expect(labeled).toEqual([TICKET]);
        expect(stores.automation.jobs).toHaveLength(1);
        yield* TestClock.adjust("30 seconds");
        expect(labeled).toEqual([TICKET]);
        expect(acted(log)).toEqual([
          "automation needed watch processing out of bounds ticket; 3/3 pings; drive already pending, labeling it ready",
          "automation needed watch failed: linear: labeling OLI-45 ready failed",
          "automation needed watch processing out of bounds ticket; 4/3 pings; drive already pending, labeling it ready",
        ]);
      }),
  );

  it.effect(
    "a drive status lookup that fails is one error line, and the next poll still queues",
    () =>
      Effect.gen(function* () {
        const refused = DbErrors.DatabaseError.make({
          operation: "automationJobStatus",
          message: "Failed query: select from automation_jobs",
          cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        });
        let fail = true;
        const tests = TestingStores.fakeTestStore();
        const automation = TestingStores.fakeAutomationStore({
          jobStatus: () => (fail ? Effect.fail(refused) : Effect.succeed(Option.none())),
        });
        const servers = TestingStores.fakeServerStore();
        const log = FakeLog.fakeLog();
        const linear = TestingLinear.fakeLinear({
          overrides: {
            listAutomationNeeded: Effect.sync(() => [ticket(TICKET, SEEN)]),
          },
        });
        seedResult(tests, TICKET);
        announceClient(servers);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(
            Layer.mergeAll(tests.layer, automation.layer, servers.layer, linear.layer, log.layer),
          ),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("90 seconds");
        expect(automation.jobs).toEqual([]);
        expect(errors(log)).toEqual([
          expect.objectContaining({
            level: "error",
            text: "automation needed watch failed: connect ECONNREFUSED 127.0.0.1:5432",
            location: "automation",
            agentId: TICKET,
            cause: refused,
          }),
        ]);
        fail = false;
        yield* TestClock.adjust("30 seconds");
        expect(automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
        ]);
        // The lookup failed before the watch knew what to do, so the first poll never says it
        // is processing the ticket.
        expect(acted(log)).toEqual([
          "automation needed watch failed: connect ECONNREFUSED 127.0.0.1:5432",
          "automation needed watch processing out of bounds ticket; 4/3 pings; queueing drive",
          "automation needed watch queued drive",
        ]);
      }),
  );

  it.effect(
    "a failed Automation Needed poll keeps the rounds already saved, and Needs Review still queues",
    () =>
      Effect.gen(function* () {
        const refused = LinearErrors.LinearError.make({
          operation: "listAutomationNeeded",
          message: "linear: request failed",
        });
        let fail = false;
        const stores = Stores.fakeStores();
        const log = FakeLog.fakeLog();
        const automationBoard = [ticket(TICKET, SEEN)];
        const reviewBoard = [ticket(OTHER, SEEN)];
        const linear = TestingLinear.fakeLinear({
          overrides: {
            listAutomationNeeded: Effect.suspend(() =>
              fail ? Effect.fail(refused) : Effect.succeed([...automationBoard]),
            ),
            listNeedsReview: Effect.sync(() => [...reviewBoard]),
          },
        });
        seedResult(stores.tests, TICKET);
        seedResult(stores.tests, OTHER, OTHER_RESULT);
        announceClient(stores.servers);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(Layer.mergeAll(stores.layer, linear.layer, log.layer)),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("30 seconds");
        fail = true;
        yield* TestClock.adjust("30 seconds");
        // The failed Automation Needed poll tracks nothing; Needs Review still tracks its ticket.
        expect(log.lines).toEqual([
          trackingLine("automation needed watch tracking out of bounds tickets; OLI-45 0/3 pings"),
          trackingLine("needs review watch tracking out of bounds tickets; OLI-46 0/3 pings"),
          trackingLine("automation needed watch tracking out of bounds tickets; OLI-45 1/3 pings"),
          trackingLine("needs review watch tracking out of bounds tickets; OLI-46 1/3 pings"),
          {
            level: "error",
            text: "automation needed watch failed: linear: request failed",
            location: "automation",
            agentId: "automation",
            skipSentry: false,
            cause: refused,
          },
          trackingLine("needs review watch tracking out of bounds tickets; OLI-46 2/3 pings"),
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
        const refused = DbErrors.DatabaseError.make({
          operation: "findResultByLinearId",
          message: "Failed query: select",
          cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        });
        let fail = true;
        const tests = TestingStores.fakeTestStore(
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
        const automation = TestingStores.fakeAutomationStore();
        const servers = TestingStores.fakeServerStore();
        const log = FakeLog.fakeLog();
        announceClient(servers);
        const board = [ticket(TICKET, SEEN)];
        const linear = TestingLinear.fakeLinear({
          overrides: {
            listAutomationNeeded: Effect.sync(() => [...board]),
          },
        });
        seedResult(tests, TICKET);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(
            Layer.mergeAll(tests.layer, automation.layer, servers.layer, linear.layer, log.layer),
          ),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("90 seconds");
        expect(automation.jobs).toEqual([]);
        expect(acted(log)).toEqual([
          "automation needed watch failed: connect ECONNREFUSED 127.0.0.1:5432",
        ]);
        expect(errors(log)).toEqual([
          expect.objectContaining({
            level: "error",
            text: "automation needed watch failed: connect ECONNREFUSED 127.0.0.1:5432",
            location: "automation",
            agentId: TICKET,
            cause: refused,
          }),
        ]);
        fail = false;
        yield* TestClock.adjust("30 seconds");
        expect(automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(automation.jobs).toHaveLength(1);
      }),
  );

  it.effect("the backlog watch queues the result it looked up, without looking it up again", () =>
    Effect.gen(function* () {
      const board = [ticket(TICKET, SEEN)];
      const { tests, automation, log, moved } = yield* startDeleting("listBacklog", board);
      yield* TestClock.adjust("90 seconds");
      expect(tests.results).toEqual([]);
      expect(automation.jobs).toEqual([
        expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
      ]);
      expect(moved).toEqual([automationNeeded(TICKET)]);
      expect(acted(log)).toEqual([
        "backlog watch processing out of bounds ticket; 3/3 pings; queueing drive and moving it to Automation Needed",
        "backlog watch moved to Automation Needed; queued drive",
      ]);
    }),
  );

  it.effect(
    "the automation needed watch queues the result it looked up, without looking it up again",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { tests, automation, log, linear } = yield* startDeleting(
          "listAutomationNeeded",
          board,
        );
        yield* TestClock.adjust("90 seconds");
        expect(tests.results).toEqual([]);
        expect(automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "drive", status: "pending" }),
        ]);
        expect(acted(log)).toEqual([
          "automation needed watch processing out of bounds ticket; 3/3 pings; queueing drive",
          "automation needed watch queued drive",
        ]);
        expect(linear.calls.filter((call) => call.method === "markReady")).toEqual([ready(TICKET)]);
      }),
  );

  it.effect(
    "the needs review watch queues the result it looked up, without looking it up again",
    () =>
      Effect.gen(function* () {
        const board = [ticket(TICKET, SEEN)];
        const { tests, automation, log } = yield* startDeleting("listNeedsReview", board);
        yield* TestClock.adjust("90 seconds");
        expect(tests.results).toEqual([]);
        expect(automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "diagnose", status: "pending" }),
        ]);
        expect(acted(log)).toEqual([
          "needs review watch processing out of bounds ticket; 3/3 pings; queueing diagnose",
          "needs review watch queued diagnose",
        ]);
      }),
  );

  it.effect(
    "a diagnose status lookup that fails is one error line, and the next poll still queues",
    () =>
      Effect.gen(function* () {
        const refused = DbErrors.DatabaseError.make({
          operation: "automationJobStatus",
          message: "Failed query: select from automation_jobs",
          cause: new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        });
        let fail = true;
        const tests = TestingStores.fakeTestStore();
        const automation = TestingStores.fakeAutomationStore({
          jobStatus: () => (fail ? Effect.fail(refused) : Effect.succeed(Option.none())),
        });
        const servers = TestingStores.fakeServerStore();
        const log = FakeLog.fakeLog();
        const linear = TestingLinear.fakeLinear({
          overrides: {
            listNeedsReview: Effect.sync(() => [ticket(TICKET, SEEN)]),
          },
        });
        seedResult(tests, TICKET);
        announceClient(servers);
        const scope = yield* Scope.make();
        yield* Backlog.watch().pipe(
          Effect.provide(
            Layer.mergeAll(tests.layer, automation.layer, servers.layer, linear.layer, log.layer),
          ),
          Scope.provide(scope),
        );
        yield* TestClock.adjust("90 seconds");
        expect(automation.jobs).toEqual([]);
        expect(errors(log)).toEqual([
          expect.objectContaining({
            level: "error",
            text: "needs review watch failed: connect ECONNREFUSED 127.0.0.1:5432",
            location: "automation",
            agentId: TICKET,
            cause: refused,
          }),
        ]);
        fail = false;
        yield* TestClock.adjust("30 seconds");
        expect(automation.jobs).toEqual([
          expect.objectContaining({ resultId: RESULT, action: "diagnose", status: "pending" }),
        ]);
        expect(acted(log)).toEqual([
          "needs review watch failed: connect ECONNREFUSED 127.0.0.1:5432",
          "needs review watch processing out of bounds ticket; 4/3 pings; queueing diagnose",
          "needs review watch queued diagnose",
        ]);
        yield* TestClock.adjust("30 seconds");
        expect(automation.jobs).toHaveLength(1);
      }),
  );
});
