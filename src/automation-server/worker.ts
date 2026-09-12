import { Cause, Effect, Option, Result, Schedule, Schema, Scope } from "effect";
import * as Automation from "../db/automation.ts";
import * as Servers from "../db/servers.ts";
import * as Tests from "../db/tests.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as AutomationClient from "./client.ts";
import * as Prompts from "./prompts.ts";

const DISPATCH_INTERVAL = "5 seconds";

const isDatabaseError = Schema.is(Errors.DatabaseError);
const isAtCapacity = Schema.is(Errors.AtCapacity);

const detail = (error: unknown): string =>
  isDatabaseError(error)
    ? Render.errorDetail(ExternalFailure.causeOf(error))
    : Render.errorDetail(error);

type Outcome = {
  readonly status: Automation.FinishStatus;
  readonly reason: string | null;
};

const aborted: Outcome = {
  status: "aborted",
  reason: "automation server shutting down",
};

const outcomeFrom = (cause: Cause.Cause<unknown>): Outcome =>
  Cause.hasInterruptsOnly(cause)
    ? aborted
    : { status: "failed", reason: Render.errorDetail(Cause.squash(cause)) };

type Placement = {
  readonly url: string;
  readonly prompt: string;
  readonly ticket: string;
};

// Build the prompt and take a client slot. /run is not waited here: a reserved job
// starts in its own fiber so the next pending row can reserve on this tick.
const place = Effect.fn("place")(function* (
  job: Automation.AutomationJobRow,
  clients: ReadonlyArray<Servers.LiveServer>,
  model: string,
) {
  const tests = yield* Tests.TestStore;
  const store = yield* Automation.AutomationStore;
  const log = yield* Log.Log;
  const result = yield* tests.findResult(job.resultId);
  if (Option.isNone(result) || result.value.linearId === null) {
    return yield* Errors.AutomationClientError.make({ message: "no Linear ticket" });
  }
  const ticket = result.value.linearId;
  const prompt =
    job.action === "drive"
      ? yield* Prompts.drive(ticket, model)
      : yield* Prompts.diagnose(ticket, job.resultId, model);
  let lastCapacity: string | undefined;
  for (const client of clients) {
    const reserved = yield* Effect.result(AutomationClient.reserve(client.url, ticket));
    if (Result.isSuccess(reserved)) {
      if (client.id !== job.serverId) {
        yield* store.assign(job.id, client.id);
      }
      yield* log.info(`dispatching ${job.action}; ${client.url}; ${model}`, {
        location: Log.Locations.automation,
        agentId: ticket,
      });
      const placement: Placement = { url: client.url, prompt, ticket };
      return placement;
    }
    if (reserved.failure.status === 503) {
      lastCapacity = reserved.failure.message;
      continue;
    }
    return yield* Effect.fail(reserved.failure);
  }
  return yield* Errors.AtCapacity.make({
    message: lastCapacity ?? "at capacity",
    agentId: ticket,
  });
});

const perform = Effect.fn("perform")(function* (
  job: Automation.AutomationJobRow,
  placement: Placement,
  model: string,
) {
  const tests = yield* Tests.TestStore;
  yield* AutomationClient.run(placement.url, placement.prompt, placement.ticket, model);
  // A diagnose is judged by nothing here: the result was closed before it was queued.
  if (job.action === "diagnose") {
    return yield* Effect.void;
  }
  // A driver's last act is ./ctrl test-results; opencode exiting 0 with the result still open
  // is an agent that quit early, and the job says so rather than reading as a run.
  const after = yield* tests.findResult(job.resultId);
  if (Option.isNone(after)) {
    return yield* Effect.die(
      new Error(`perform: result ${job.resultId} vanished during the drive`),
    );
  }
  if (after.value.status === "pending" || after.value.status === "running") {
    return yield* Errors.AutomationClientError.make({
      message: `driver exited; result ${job.resultId} is ${after.value.status}`,
    });
  }
  return yield* Effect.void;
});

const logOutcome = Effect.fn("logOutcome")(function* (
  job: Automation.AutomationJobRow,
  outcome: Outcome,
) {
  const log = yield* Log.Log;
  const attr = { location: Log.Locations.automation };
  if (outcome.status === "succeeded") {
    yield* log.info(`${job.action} succeeded`, attr);
    return;
  }
  if (outcome.status === "aborted") {
    yield* log.info(`${job.action} aborted`, attr);
    return;
  }
  yield* log.error(`${job.action} failed; ${outcome.reason}`, attr);
});

const closeJob = Effect.fn("closeJob")(function* (
  job: Automation.AutomationJobRow,
  outcome: Outcome,
) {
  const store = yield* Automation.AutomationStore;
  const closed = yield* store.finish(job.id, outcome.status, outcome.reason);
  // abort may have closed the row first
  if (closed) {
    yield* logOutcome(job, outcome);
  }
});

// Pending jobs are claimed and reserved on this tick until a client accepts none of
// them. A successful reserve starts /run in its own fiber so the next pending job can
// reserve without waiting. Every job runs as `model`. A tick with no live client does
// not claim. A 503 from every client puts that row back to pending so the queue is
// unchanged. Claim is uninterruptible so a shutdown cannot leave a pending row
// half-taken; the HTTP wait is restored so SIGTERM aborts an in-flight job; finish and
// unclaim are uninterruptible so the write lands. A tick that fails is one error line;
// the next tick runs.
export const dispatch = Effect.fn("dispatch")(function* (model: string) {
  const servers = yield* Servers.ServerStore;
  const store = yield* Automation.AutomationStore;
  const log = yield* Log.Log;
  const work = yield* Scope.Scope;

  const tick = Effect.fn("tick")(function* () {
    const live = yield* servers.listLiveServers("automation-client");
    const chosen = live[0];
    if (chosen === undefined) {
      return;
    }
    yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        for (;;) {
          const maybe = yield* store.claim(chosen.id);
          if (Option.isNone(maybe)) {
            return;
          }
          const job = maybe.value;
          const placed = yield* restore(place(job, live, model)).pipe(
            Effect.matchCause({
              onSuccess: (placement) => ({ _tag: "placed" as const, placement }),
              onFailure: (cause) => {
                const error = Cause.squash(cause);
                return isAtCapacity(error)
                  ? Object.assign(
                      { _tag: "deferred" as const },
                      error.agentId === undefined ? undefined : { agentId: error.agentId },
                    )
                  : { _tag: "closed" as const, outcome: outcomeFrom(cause) };
              },
            }),
          );
          if (placed._tag === "deferred") {
            const restored = yield* store.unclaim(job.id);
            if (restored) {
              yield* log.info(
                "deferred; at capacity",
                placed.agentId === undefined
                  ? { location: Log.Locations.automation }
                  : { location: Log.Locations.automation, agentId: placed.agentId },
              );
            }
            return;
          }
          if (placed._tag === "closed") {
            yield* closeJob(job, placed.outcome);
            // An interrupt is a shutdown: do not claim the next pending row.
            if (placed.outcome.status === "aborted") {
              return;
            }
            continue;
          }
          // /run lives on the dispatch scope so a shutdown interrupts every in-flight
          // job, and this tick can reserve the next pending row without waiting.
          // Do not startImmediately: forkIn adds the interrupt finalizer only after
          // that evaluate returns, and /run parks on the HTTP wait.
          yield* Effect.forkIn(
            Effect.uninterruptibleMask((release) =>
              release(perform(job, placed.placement, model)).pipe(
                Effect.matchCause({
                  onSuccess: (): Outcome => ({ status: "succeeded", reason: null }),
                  onFailure: outcomeFrom,
                }),
                Effect.flatMap((outcome) => closeJob(job, outcome)),
                Effect.catchCause((cause) => {
                  if (Cause.hasInterruptsOnly(cause)) {
                    return Effect.void;
                  }
                  const error = Cause.squash(cause);
                  return log.error(`dispatch job failed: ${detail(error)}`, {
                    location: Log.Locations.automation,
                    cause: error,
                  });
                }),
              ),
            ),
            work,
          );
        }
      }),
    );
  });

  yield* tick().pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      const error = Cause.squash(cause);
      return log.error(`dispatch tick failed: ${detail(error)}`, {
        location: Log.Locations.automation,
        cause: error,
      });
    }),
    Effect.repeat(Schedule.spaced(DISPATCH_INTERVAL)),
    Effect.forkScoped({ startImmediately: true }),
  );
});
