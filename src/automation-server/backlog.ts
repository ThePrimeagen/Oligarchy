import { Cause, Effect, Schedule, Schema } from "effect";
import * as Linear from "../ctrl/linear.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as Enqueue from "./enqueue.ts";

const POLL_INTERVAL = "30 seconds";
// The first poll only saves the ticket. Each later poll that finds the same
// updatedAt counts one round. Three rounds is ninety seconds with no move and
// no edit; then the webhook is not coming. An edit or a departure starts over.
const ROUNDS_BEFORE_MOVE = 3;

const isDatabaseError = Schema.is(Errors.DatabaseError);

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

// Enqueue first, through the same path as POST /linear. An enqueue that lands and then
// loses the process leaves the ticket in Backlog; the next poll finds the duplicate and
// moves it. The pair stays interruptible: a torn enqueue and move is that recovery, and
// a hung Linear request must not hold shutdown. A missing result is retried every poll
// and logged once per snapshot. A ticket with no body is still queued.
const processBacklog = Effect.fn("processBacklog")(function* (
  ticket: Linear.LinearBacklogTicket,
  rounds: number,
) {
  const log = yield* Log.Log;
  const linear = yield* Linear.Linear;
  const placed = yield* Enqueue.enqueueTicket(ticket.identifier, "drive");
  if (placed.result === "missing") {
    if (rounds === ROUNDS_BEFORE_MOVE) {
      yield* log.info("backlog watch left the ticket in Backlog; no result", {
        location: Log.Locations.automation,
        agentId: ticket.identifier,
      });
    }
    return;
  }
  const team = yield* linear.teamId;
  const states = yield* linear.stateIds(team);
  yield* linear.moveIssue(ticket, states.automationNeeded);
  const note =
    placed.result === "queued" ? `queued ${placed.action}` : `${placed.action} already queued`;
  yield* log.info(`backlog watch moved to Automation Needed; ${note}`, {
    location: Log.Locations.automation,
    agentId: ticket.identifier,
  });
});

// The ticket stays in Automation Needed while the drive runs, so the caller settles a landed
// enqueue until the snapshot changes. A missing result is retried every poll and logged once.
const processAutomationNeeded = Effect.fn("processAutomationNeeded")(function* (
  ticket: Linear.LinearBacklogTicket,
  rounds: number,
) {
  const log = yield* Log.Log;
  const placed = yield* Enqueue.enqueueTicket(ticket.identifier, "drive");
  if (placed.result === "missing") {
    if (rounds === ROUNDS_BEFORE_MOVE) {
      yield* log.info("automation needed watch left the ticket in Automation Needed; no result", {
        location: Log.Locations.automation,
        agentId: ticket.identifier,
      });
    }
    return false;
  }
  const line =
    placed.result === "queued"
      ? `automation needed watch queued ${placed.action}`
      : `automation needed watch; ${placed.action} already queued`;
  yield* log.info(line, {
    location: Log.Locations.automation,
    agentId: ticket.identifier,
  });
  return true;
});

// Needs Review stays a diagnose, including for the mint definition. The ticket stays in the
// column while that job runs, so the caller settles a landed enqueue until the snapshot changes.
const processNeedsReview = Effect.fn("processNeedsReview")(function* (
  ticket: Linear.LinearBacklogTicket,
  rounds: number,
) {
  const log = yield* Log.Log;
  const placed = yield* Enqueue.enqueueTicket(ticket.identifier, "diagnose");
  if (placed.result === "missing") {
    if (rounds === ROUNDS_BEFORE_MOVE) {
      yield* log.info("needs review watch left the ticket in Needs Review; no result", {
        location: Log.Locations.automation,
        agentId: ticket.identifier,
      });
    }
    return false;
  }
  const line =
    placed.result === "queued"
      ? `needs review watch queued ${placed.action}`
      : `needs review watch; ${placed.action} already queued`;
  yield* log.info(line, {
    location: Log.Locations.automation,
    agentId: ticket.identifier,
  });
  return true;
});

const watchBacklog = Effect.gen(function* () {
  const linear = yield* Linear.Linear;
  const log = yield* Log.Log;
  const sightings = new Map<string, Sighting>();

  const tick = Effect.gen(function* () {
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
    // A failed poll keeps the rounds already saved.
    if (tickets === undefined) {
      return;
    }
    const present = new Set<string>();
    for (const ticket of tickets) {
      present.add(ticket.identifier);
      const prev = sightings.get(ticket.identifier);
      const same = prev !== undefined && prev.updatedAt === ticket.updatedAt;
      const rounds = same ? prev.rounds + 1 : 0;
      sightings.set(ticket.identifier, { rounds, updatedAt: ticket.updatedAt });
      if (rounds < ROUNDS_BEFORE_MOVE) {
        continue;
      }
      // One poison ticket must not starve the rest of this poll. A defect still fails the tick.
      // Not settled: the move is what takes it off the list, and a move that did not is retried.
      yield* processBacklog(ticket, rounds).pipe(
        Effect.catch((error) =>
          log.error(`backlog watch failed: ${detail(error)}`, {
            location: Log.Locations.automation,
            agentId: ticket.identifier,
            cause: error,
          }),
        ),
      );
    }
    for (const identifier of sightings.keys()) {
      if (!present.has(identifier)) {
        sightings.delete(identifier);
      }
    }
  }).pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      const error = Cause.squash(cause);
      return log.error(`backlog watch failed: ${detail(error)}`, {
        location: Log.Locations.automation,
        agentId: Log.AutomationAgentId,
        cause: error,
      });
    }),
  );

  yield* tick.pipe(
    Effect.repeat(Schedule.spaced(POLL_INTERVAL)),
    Effect.forkScoped({ startImmediately: true }),
  );
});

const watchAutomationNeeded = Effect.gen(function* () {
  const linear = yield* Linear.Linear;
  const log = yield* Log.Log;
  const sightings = new Map<string, Held>();

  const tick = Effect.gen(function* () {
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
    for (const ticket of tickets) {
      present.add(ticket.identifier);
      const prev = sightings.get(ticket.identifier);
      const same = prev !== undefined && prev.updatedAt === ticket.updatedAt;
      const rounds = same ? prev.rounds + 1 : 0;
      const settled = same && prev.settled;
      sightings.set(ticket.identifier, { rounds, updatedAt: ticket.updatedAt, settled });
      if (settled || rounds < ROUNDS_BEFORE_MOVE) {
        continue;
      }
      const done = yield* processAutomationNeeded(ticket, rounds).pipe(
        Effect.catch((error) =>
          log
            .error(`automation needed watch failed: ${detail(error)}`, {
              location: Log.Locations.automation,
              agentId: ticket.identifier,
              cause: error,
            })
            .pipe(Effect.as(false)),
        ),
      );
      if (done) {
        sightings.set(ticket.identifier, { rounds, updatedAt: ticket.updatedAt, settled: true });
      }
    }
    for (const identifier of sightings.keys()) {
      if (!present.has(identifier)) {
        sightings.delete(identifier);
      }
    }
  }).pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      const error = Cause.squash(cause);
      return log.error(`automation needed watch failed: ${detail(error)}`, {
        location: Log.Locations.automation,
        agentId: Log.AutomationAgentId,
        cause: error,
      });
    }),
  );

  yield* tick.pipe(
    Effect.repeat(Schedule.spaced(POLL_INTERVAL)),
    Effect.forkScoped({ startImmediately: true }),
  );
});

const watchNeedsReview = Effect.gen(function* () {
  const linear = yield* Linear.Linear;
  const log = yield* Log.Log;
  const sightings = new Map<string, Held>();

  const tick = Effect.gen(function* () {
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
    for (const ticket of tickets) {
      present.add(ticket.identifier);
      const prev = sightings.get(ticket.identifier);
      const same = prev !== undefined && prev.updatedAt === ticket.updatedAt;
      const rounds = same ? prev.rounds + 1 : 0;
      const settled = same && prev.settled;
      sightings.set(ticket.identifier, { rounds, updatedAt: ticket.updatedAt, settled });
      if (settled || rounds < ROUNDS_BEFORE_MOVE) {
        continue;
      }
      const done = yield* processNeedsReview(ticket, rounds).pipe(
        Effect.catch((error) =>
          log
            .error(`needs review watch failed: ${detail(error)}`, {
              location: Log.Locations.automation,
              agentId: ticket.identifier,
              cause: error,
            })
            .pipe(Effect.as(false)),
        ),
      );
      if (done) {
        sightings.set(ticket.identifier, { rounds, updatedAt: ticket.updatedAt, settled: true });
      }
    }
    for (const identifier of sightings.keys()) {
      if (!present.has(identifier)) {
        sightings.delete(identifier);
      }
    }
  }).pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      const error = Cause.squash(cause);
      return log.error(`needs review watch failed: ${detail(error)}`, {
        location: Log.Locations.automation,
        agentId: Log.AutomationAgentId,
        cause: error,
      });
    }),
  );

  yield* tick.pipe(
    Effect.repeat(Schedule.spaced(POLL_INTERVAL)),
    Effect.forkScoped({ startImmediately: true }),
  );
});

export const watch = Effect.fn("watchBoard")(function* () {
  yield* watchBacklog;
  yield* watchAutomationNeeded;
  yield* watchNeedsReview;
});
