import { Cause, Effect, Option, Schedule, Schema } from "effect";
import * as Automation from "@oligarchy/db/automation";
import * as DbErrors from "@oligarchy/db/errors";
import * as Servers from "@oligarchy/db/servers";
import * as Tests from "@oligarchy/db/tests";
import * as Linear from "@oligarchy/linear/client";
import * as ExternalFailure from "@oligarchy/log/external-failure";
import * as Log from "@oligarchy/log/log";
import * as Render from "@oligarchy/log/render";
import * as Enqueue from "./enqueue.ts";

const POLL_INTERVAL = "30 seconds";
// The first poll only saves the ticket. Each later poll that finds the same
// updatedAt counts one round. Three rounds is ninety seconds with no move and
// no edit; then the webhook is not coming. An edit or a departure starts over.
const ROUNDS_BEFORE_MOVE = 3;

const isDatabaseError = Schema.is(DbErrors.DatabaseError);

// A pending row is the queue. Anything else the unique index kept is named by its status.
const already = (
  action: Automation.AutomationAction,
  status: Automation.AutomationJobRow["status"],
): string => `${action} already ${status === "pending" ? "queued" : status}`;

// Drizzle buries the reason (ECONNREFUSED etc.) in the cause; its own message is the failed SQL.
const detail = (error: unknown): string =>
  isDatabaseError(error)
    ? Render.errorDetail(ExternalFailure.causeOf(error))
    : Render.errorDetail(error);

type Sighting = {
  readonly rounds: number;
  readonly updatedAt: string;
};

type Held = Sighting & {
  readonly settled: boolean;
};

// A ping is a poll that found the ticket unchanged; the watch acts at ROUNDS_BEFORE_MOVE.
const pings = (rounds: number): string => `${String(rounds)}/${String(ROUNDS_BEFORE_MOVE)} pings`;

type Seen = {
  readonly ticket: Linear.LinearBacklogTicket;
  readonly rounds: number;
  readonly settled: boolean;
};

// A handled ticket has its job for this snapshot and waits for an edit or a departure.
const tracking = (watch: string, seen: ReadonlyArray<Seen>): string =>
  `${watch} watch tracking out of bounds tickets; ${seen
    .map(
      ({ ticket, rounds, settled }) =>
        `${ticket.identifier} ${pings(rounds)}${settled ? " (handled)" : ""}`,
    )
    .join(", ")}`;

// The result is looked up first, so a missing one, retried every poll and logged once per
// snapshot, never says it is being processed. Then that result is enqueued, through the same
// insert as POST /linear. An enqueue that lands and then loses the process leaves the ticket
// in Backlog; the next poll finds the duplicate and moves it. The pair stays interruptible: a
// torn enqueue and move is that recovery, and a hung Linear request must not hold shutdown. A
// ticket with no body is still queued.
const processBacklog = Effect.fn("processBacklog")(function* (
  ticket: Linear.LinearBacklogTicket,
  rounds: number,
) {
  const log = yield* Log.Log;
  const linear = yield* Linear.Linear;
  const tests = yield* Tests.TestStore;
  const automation = yield* Automation.AutomationStore;
  const found = yield* tests.findResultByLinearId(ticket.identifier);
  if (Option.isNone(found)) {
    if (rounds === ROUNDS_BEFORE_MOVE) {
      yield* log.info("backlog watch left the ticket in Backlog; no result", {
        location: Log.Locations.automation,
        agentId: ticket.identifier,
      });
    }
    return "missing";
  }
  const definition = yield* tests.definitionName(found.value.definitionId);
  const action = Enqueue.queuedAction("drive", definition);
  yield* log.info(
    `backlog watch processing out of bounds ticket; ${pings(rounds)}; queueing ${action} and moving it to Automation Needed`,
    { location: Log.Locations.automation, agentId: ticket.identifier },
  );
  const placed = yield* Enqueue.enqueueResult(found.value.id, action);
  const adopted = placed.result;
  return yield* Effect.gen(function* () {
    // Label before the move. A miss leaves the ticket in Backlog; the next poll tries again.
    if (yield* automation.hasPending(found.value.id, placed.action)) {
      yield* linear.markReady(ticket.identifier);
    }
    const team = yield* linear.teamId;
    const states = yield* linear.stateIds(team);
    yield* linear.moveIssue(ticket, states.automationNeeded);
    const note =
      placed.result === "queued"
        ? `queued ${placed.action}`
        : already(placed.action, placed.status);
    yield* log.info(`backlog watch moved to Automation Needed; ${note}`, {
      location: Log.Locations.automation,
      agentId: ticket.identifier,
    });
    return adopted;
  }).pipe(
    // Keep the landed enqueue when the label or the move fails, so a new job still spends the check.
    Effect.catch((error) =>
      log
        .error(`backlog watch failed: ${detail(error)}`, {
          location: Log.Locations.automation,
          agentId: ticket.identifier,
          cause: error,
        })
        .pipe(Effect.as(adopted)),
    ),
  );
});

// The ticket stays in Automation Needed while the drive runs, so the caller settles a landed
// enqueue until the snapshot changes. A pending job is that wait already: the row holds the
// fulfilled work until claim, and another insert would only rediscover it. A drive that is
// running or has run is settled unlabeled and without a line: the unique index allows no
// second drive, and the worker logs how each drive ends. A missing result is retried every
// poll and logged once.
const processAutomationNeeded = Effect.fn("processAutomationNeeded")(function* (
  ticket: Linear.LinearBacklogTicket,
  rounds: number,
) {
  const log = yield* Log.Log;
  const linear = yield* Linear.Linear;
  const tests = yield* Tests.TestStore;
  const automation = yield* Automation.AutomationStore;
  const found = yield* tests.findResultByLinearId(ticket.identifier);
  if (Option.isNone(found)) {
    if (rounds === ROUNDS_BEFORE_MOVE) {
      yield* log.info("automation needed watch left the ticket in Automation Needed; no result", {
        location: Log.Locations.automation,
        agentId: ticket.identifier,
      });
    }
    return "missing";
  }
  const definition = yield* tests.definitionName(found.value.definitionId);
  // Same action enqueue would insert. A pending diagnose is a different job.
  const action = Enqueue.queuedAction("drive", definition);
  const status = yield* automation.jobStatus(found.value.id, action);
  if (Option.isSome(status)) {
    if (status.value === "pending") {
      yield* log.info(
        `automation needed watch processing out of bounds ticket; ${pings(rounds)}; ${action} already pending, labeling it ready`,
        { location: Log.Locations.automation, agentId: ticket.identifier },
      );
      yield* linear.markReady(ticket.identifier);
    }
    // Settled, and it does not spend this check's one new job.
    return "duplicate";
  }
  yield* log.info(
    `automation needed watch processing out of bounds ticket; ${pings(rounds)}; queueing ${action}`,
    { location: Log.Locations.automation, agentId: ticket.identifier },
  );
  const placed = yield* Enqueue.enqueueResult(found.value.id, action);
  const line =
    placed.result === "queued"
      ? `automation needed watch queued ${placed.action}`
      : `automation needed watch; ${already(placed.action, placed.status)}`;
  yield* log.info(line, {
    location: Log.Locations.automation,
    agentId: ticket.identifier,
  });
  // A new row is pending. A duplicate of a finished row is not, and stays unlabeled.
  // Returning settles this snapshot. The label is what a restart uses.
  if (placed.result === "queued") {
    yield* linear.markReady(ticket.identifier);
  }
  return placed.result;
});

// Needs Review stays a diagnose, including for the mint definition. The ticket stays in the
// column while that job runs, so the caller settles a landed enqueue until the snapshot changes.
// The result is looked up first for the same reason as the backlog's. A diagnose already queued
// or run is settled without a line, as a drive is in Automation Needed.
const processNeedsReview = Effect.fn("processNeedsReview")(function* (
  ticket: Linear.LinearBacklogTicket,
  rounds: number,
) {
  const log = yield* Log.Log;
  const tests = yield* Tests.TestStore;
  const automation = yield* Automation.AutomationStore;
  const found = yield* tests.findResultByLinearId(ticket.identifier);
  if (Option.isNone(found)) {
    if (rounds === ROUNDS_BEFORE_MOVE) {
      yield* log.info("needs review watch left the ticket in Needs Review; no result", {
        location: Log.Locations.automation,
        agentId: ticket.identifier,
      });
    }
    return "missing";
  }
  if (Option.isSome(yield* automation.jobStatus(found.value.id, "diagnose"))) {
    return "duplicate";
  }
  yield* log.info(
    `needs review watch processing out of bounds ticket; ${pings(rounds)}; queueing diagnose`,
    { location: Log.Locations.automation, agentId: ticket.identifier },
  );
  const placed = yield* Enqueue.enqueueResult(found.value.id, "diagnose");
  const line =
    placed.result === "queued"
      ? `needs review watch queued ${placed.action}`
      : `needs review watch; ${already(placed.action, placed.status)}`;
  yield* log.info(line, {
    location: Log.Locations.automation,
    agentId: ticket.identifier,
  });
  return placed.result;
});

// A defect in one column logs and the other columns of this check still run. An interrupt
// still shuts the loop down.
const guard = <E, R>(label: string, tick: Effect.Effect<void, E, R>) =>
  tick.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      const error = Cause.squash(cause);
      return Effect.gen(function* () {
        const log = yield* Log.Log;
        yield* log.error(`${label} watch failed: ${detail(error)}`, {
          location: Log.Locations.automation,
          agentId: Log.AutomationAgentId,
          cause: error,
        });
      });
    }),
  );

export const watch = Effect.fn("watchBoard")(function* () {
  const linear = yield* Linear.Linear;
  const log = yield* Log.Log;
  const servers = yield* Servers.ServerStore;
  const backlog = new Map<string, Sighting>();
  const needed = new Map<string, Held>();
  const review = new Map<string, Held>();

  const tick = Effect.gen(function* () {
    // One new job per live automation client. Backlog, then Automation Needed, then
    // Needs Review. A missing result, a duplicate, or a failed enqueue does not spend a slot.
    const listed = yield* servers.listLiveServers("automation-client").pipe(
      Effect.catch((error) =>
        log
          .error(`board watch failed: ${detail(error)}`, {
            location: Log.Locations.automation,
            agentId: Log.AutomationAgentId,
            cause: error,
          })
          .pipe(Effect.as(undefined)),
      ),
    );
    const live = listed ?? [];
    let room = live.length;

    yield* guard(
      "backlog",
      Effect.gen(function* () {
        const tickets = yield* linear.listBacklog.pipe(
          Effect.catch((error) =>
            log
              .error(`backlog watch failed: ${detail(error)}`, {
                location: Log.Locations.automation,
                agentId: Log.AutomationAgentId,
                cause: error,
              })
              .pipe(Effect.as(undefined)),
          ),
        );
        if (tickets === undefined) {
          return;
        }
        // Every sighting is recorded and logged before any ticket is processed, so the tracking
        // line reads first and the lines about what the watch did follow it.
        const present = new Set<string>();
        const seen: Array<Seen> = [];
        for (const ticket of tickets) {
          present.add(ticket.identifier);
          const prev = backlog.get(ticket.identifier);
          const same = prev !== undefined && prev.updatedAt === ticket.updatedAt;
          const rounds = same ? prev.rounds + 1 : 0;
          backlog.set(ticket.identifier, { rounds, updatedAt: ticket.updatedAt });
          seen.push({ ticket, rounds, settled: false });
        }
        if (seen.length > 0) {
          yield* log.info(tracking("backlog", seen), {
            location: Log.Locations.automation,
            agentId: Log.AutomationAgentId,
          });
        }
        for (const { ticket, rounds } of seen) {
          if (room === 0 || rounds < ROUNDS_BEFORE_MOVE) {
            continue;
          }
          // A poison ticket must not spend a slot. The move is what takes a ticket off
          // the list, and a move that did not is retried. A defect still fails the column.
          const outcome = yield* processBacklog(ticket, rounds).pipe(
            Effect.catch((error) =>
              log
                .error(`backlog watch failed: ${detail(error)}`, {
                  location: Log.Locations.automation,
                  agentId: ticket.identifier,
                  cause: error,
                })
                .pipe(Effect.as("failed" as const)),
            ),
          );
          if (outcome === "queued") {
            room -= 1;
          }
        }
        for (const identifier of backlog.keys()) {
          if (!present.has(identifier)) {
            backlog.delete(identifier);
          }
        }
      }),
    );

    yield* guard(
      "automation needed",
      Effect.gen(function* () {
        const tickets = yield* linear.listAutomationNeeded.pipe(
          Effect.catch((error) =>
            log
              .error(`automation needed watch failed: ${detail(error)}`, {
                location: Log.Locations.automation,
                agentId: Log.AutomationAgentId,
                cause: error,
              })
              .pipe(Effect.as(undefined)),
          ),
        );
        if (tickets === undefined) {
          return;
        }
        const present = new Set<string>();
        const seen: Array<Seen> = [];
        for (const ticket of tickets) {
          present.add(ticket.identifier);
          const prev = needed.get(ticket.identifier);
          const same = prev !== undefined && prev.updatedAt === ticket.updatedAt;
          const rounds = same ? prev.rounds + 1 : 0;
          const settled = same && prev.settled;
          needed.set(ticket.identifier, { rounds, updatedAt: ticket.updatedAt, settled });
          seen.push({ ticket, rounds, settled });
        }
        if (seen.length > 0) {
          yield* log.info(tracking("automation needed", seen), {
            location: Log.Locations.automation,
            agentId: Log.AutomationAgentId,
          });
        }
        for (const { ticket, rounds, settled } of seen) {
          if (room === 0 || settled || rounds < ROUNDS_BEFORE_MOVE) {
            continue;
          }
          const outcome = yield* processAutomationNeeded(ticket, rounds).pipe(
            Effect.catch((error) =>
              log
                .error(`automation needed watch failed: ${detail(error)}`, {
                  location: Log.Locations.automation,
                  agentId: ticket.identifier,
                  cause: error,
                })
                .pipe(Effect.as("failed" as const)),
            ),
          );
          if (outcome === "queued" || outcome === "duplicate") {
            needed.set(ticket.identifier, {
              rounds,
              updatedAt: ticket.updatedAt,
              settled: true,
            });
          }
          if (outcome === "queued") {
            room -= 1;
          }
        }
        for (const identifier of needed.keys()) {
          if (!present.has(identifier)) {
            needed.delete(identifier);
          }
        }
      }),
    );

    yield* guard(
      "needs review",
      Effect.gen(function* () {
        const tickets = yield* linear.listNeedsReview.pipe(
          Effect.catch((error) =>
            log
              .error(`needs review watch failed: ${detail(error)}`, {
                location: Log.Locations.automation,
                agentId: Log.AutomationAgentId,
                cause: error,
              })
              .pipe(Effect.as(undefined)),
          ),
        );
        if (tickets === undefined) {
          return;
        }
        const present = new Set<string>();
        const seen: Array<Seen> = [];
        for (const ticket of tickets) {
          present.add(ticket.identifier);
          const prev = review.get(ticket.identifier);
          const same = prev !== undefined && prev.updatedAt === ticket.updatedAt;
          const rounds = same ? prev.rounds + 1 : 0;
          const settled = same && prev.settled;
          review.set(ticket.identifier, { rounds, updatedAt: ticket.updatedAt, settled });
          seen.push({ ticket, rounds, settled });
        }
        if (seen.length > 0) {
          yield* log.info(tracking("needs review", seen), {
            location: Log.Locations.automation,
            agentId: Log.AutomationAgentId,
          });
        }
        for (const { ticket, rounds, settled } of seen) {
          if (room === 0 || settled || rounds < ROUNDS_BEFORE_MOVE) {
            continue;
          }
          const outcome = yield* processNeedsReview(ticket, rounds).pipe(
            Effect.catch((error) =>
              log
                .error(`needs review watch failed: ${detail(error)}`, {
                  location: Log.Locations.automation,
                  agentId: ticket.identifier,
                  cause: error,
                })
                .pipe(Effect.as("failed" as const)),
            ),
          );
          if (outcome === "queued" || outcome === "duplicate") {
            review.set(ticket.identifier, {
              rounds,
              updatedAt: ticket.updatedAt,
              settled: true,
            });
          }
          if (outcome === "queued") {
            room -= 1;
          }
        }
        for (const identifier of review.keys()) {
          if (!present.has(identifier)) {
            review.delete(identifier);
          }
        }
      }),
    );
  });

  yield* tick.pipe(
    Effect.repeat(Schedule.spaced(POLL_INTERVAL)),
    Effect.forkScoped({ startImmediately: true }),
  );
});
