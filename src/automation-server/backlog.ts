import { Cause, Effect, Schedule, Schema } from "effect";
import * as Linear from "../ctrl/linear.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as Enqueue from "./enqueue.ts";

const POLL_INTERVAL = "30 seconds";
// The first poll only saves the ticket. Each later poll that finds the same
// backlog snapshot counts one round. Three rounds is ninety seconds with no
// move and no edit; then the webhook is not coming.
const ROUNDS_BEFORE_MOVE = 3;

const isDatabaseError = Schema.is(Errors.DatabaseError);

const detail = (error: unknown): string =>
  isDatabaseError(error)
    ? Render.errorDetail(ExternalFailure.causeOf(error))
    : Render.errorDetail(error);

type Sighting = {
  readonly rounds: number;
  readonly updatedAt: string;
  readonly id: string;
};

// Enqueue first. A move that lands and then loses the process still leaves the
// ticket in Backlog, and the next poll finds the duplicate and moves it. Moving
// first would drop a ticket the webhook never queues out of this watch.
const adopt = Effect.fn("adoptBacklog")(function* (ticket: Linear.LinearBacklogTicket) {
  const log = yield* Log.Log;
  const linear = yield* Linear.Linear;
  const placed = yield* Enqueue.enqueueTicket(ticket.identifier, "drive");
  if (placed.result === "missing") {
    yield* log.info(`backlog watch left ${ticket.identifier}; no result`, {
      location: Log.Locations.automation,
      agentId: ticket.identifier,
    });
    return false;
  }
  const team = yield* linear.teamId;
  const states = yield* linear.stateIds(team);
  yield* linear.moveIssue(ticket.id, ticket.identifier, states.automationNeeded);
  const note =
    placed.result === "queued" ? `queued ${placed.action}` : `${placed.action} already queued`;
  yield* log.info(`backlog watch moved ${ticket.identifier} to Automation Needed; ${note}`, {
    location: Log.Locations.automation,
    agentId: ticket.identifier,
  });
  return true;
});

// Every thirty seconds, the Oligarchy backlog. A ticket is remembered by its
// identifier. Three rounds of the same updatedAt, and it is moved to Automation
// Needed and queued the way POST /linear would have queued that move. An edit
// or a departure starts the count over. A tick that fails is one error line.
export const watch = Effect.fn("watchBacklog")(function* () {
  const linear = yield* Linear.Linear;
  const log = yield* Log.Log;
  const sightings = new Map<string, Sighting>();

  const tick = Effect.gen(function* () {
    const tickets = yield* linear.listBacklog;
    const present = new Set<string>();
    for (const ticket of tickets) {
      present.add(ticket.identifier);
      const prev = sightings.get(ticket.identifier);
      const same =
        prev !== undefined && prev.updatedAt === ticket.updatedAt && prev.id === ticket.id;
      const rounds = same ? prev.rounds + 1 : 0;
      if (rounds < ROUNDS_BEFORE_MOVE) {
        sightings.set(ticket.identifier, {
          rounds,
          updatedAt: ticket.updatedAt,
          id: ticket.id,
        });
        continue;
      }
      const moved = yield* adopt(ticket).pipe(
        Effect.uninterruptible,
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          const error = Cause.squash(cause);
          return log
            .error(`backlog watch failed for ${ticket.identifier}: ${detail(error)}`, {
              location: Log.Locations.automation,
              agentId: ticket.identifier,
              cause: error,
            })
            .pipe(Effect.as(false));
        }),
      );
      if (moved) {
        sightings.delete(ticket.identifier);
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
