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
  readonly settled: boolean;
};

// Backlog is the one column the webhook never queues: the watch enqueues and moves it to
// Automation Needed. The other two columns are the webhook's own states, so the watch only
// enqueues, and a landed enqueue settles until the snapshot changes — the ticket is supposed
// to stay there while the job runs.
type Column = {
  readonly label: "backlog watch" | "automation needed watch" | "needs review watch";
  readonly place: "Backlog" | "Automation Needed" | "Needs Review";
  readonly action: "drive" | "diagnose";
  readonly move: boolean;
};

const BACKLOG = {
  label: "backlog watch",
  place: "Backlog",
  action: "drive",
  move: true,
} as const satisfies Column;

const AUTOMATION_NEEDED = {
  label: "automation needed watch",
  place: "Automation Needed",
  action: "drive",
  move: false,
} as const satisfies Column;

const NEEDS_REVIEW = {
  label: "needs review watch",
  place: "Needs Review",
  action: "diagnose",
  move: false,
} as const satisfies Column;

// Enqueue first, through the same path as POST /linear. An enqueue that lands and then
// loses the process leaves the ticket where it was; the next poll finds the duplicate and,
// for Backlog, moves it. The pair stays interruptible: a torn enqueue and move is that
// recovery, and a hung Linear request must not hold shutdown. A missing result is retried
// every poll and logged once per snapshot. A ticket with no body is still queued.
const adopt = Effect.fn("adoptStale")(function* (
  column: Column,
  ticket: Linear.LinearBacklogTicket,
  rounds: number,
) {
  const log = yield* Log.Log;
  const placed = yield* Enqueue.enqueueTicket(ticket.identifier, column.action);
  if (placed.result === "missing") {
    if (rounds === ROUNDS_BEFORE_MOVE) {
      yield* log.info(`${column.label} left the ticket in ${column.place}; no result`, {
        location: Log.Locations.automation,
        agentId: ticket.identifier,
      });
    }
    return false;
  }
  if (column.move) {
    const linear = yield* Linear.Linear;
    const team = yield* linear.teamId;
    const states = yield* linear.stateIds(team);
    yield* linear.moveIssue(ticket, states.automationNeeded);
    const note =
      placed.result === "queued" ? `queued ${placed.action}` : `${placed.action} already queued`;
    yield* log.info(`${column.label} moved to Automation Needed; ${note}`, {
      location: Log.Locations.automation,
      agentId: ticket.identifier,
    });
    // Not settled: the move is what takes it off the list, and a move that did not is retried.
    return false;
  }
  const line =
    placed.result === "queued"
      ? `${column.label} queued ${placed.action}`
      : `${column.label}; ${placed.action} already queued`;
  yield* log.info(line, {
    location: Log.Locations.automation,
    agentId: ticket.identifier,
  });
  return true;
});

const watchColumn = (
  list: Effect.Effect<ReadonlyArray<Linear.LinearBacklogTicket>, Errors.LinearError>,
  column: Column,
) =>
  Effect.gen(function* () {
    const log = yield* Log.Log;
    const sightings = new Map<string, Sighting>();

    const tick = Effect.gen(function* () {
      const tickets = yield* list.pipe(
        Effect.catch((error) =>
          log
            .error(`${column.label} failed: ${detail(error)}`, {
              location: Log.Locations.automation,
              agentId: Log.AutomationAgentId,
              cause: error,
            })
            .pipe(Effect.as(undefined)),
        ),
      );
      // A failed poll keeps the rounds already saved and leaves the other columns alone.
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
        // One poison ticket must not starve the rest of this poll. A defect still fails the tick.
        const done = yield* adopt(column, ticket, rounds).pipe(
          Effect.catch((error) =>
            log
              .error(`${column.label} failed: ${detail(error)}`, {
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
        return log.error(`${column.label} failed: ${detail(error)}`, {
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
  const linear = yield* Linear.Linear;
  yield* watchColumn(linear.listBacklog, BACKLOG);
  yield* watchColumn(linear.listAutomationNeeded, AUTOMATION_NEEDED);
  yield* watchColumn(linear.listNeedsReview, NEEDS_REVIEW);
});
