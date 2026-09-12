import { Cause, Effect, Option, Result, Schedule, Schema } from "effect";
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

const execute = Effect.fn("execute")(function* (
  job: Automation.AutomationJobRow,
  clients: ReadonlyArray<Servers.LiveServer>,
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
      ? yield* Prompts.drive(ticket)
      : yield* Prompts.diagnose(ticket, job.resultId);
  let lastCapacity: string | undefined;
  for (const client of clients) {
    const reserved = yield* Effect.result(AutomationClient.reserve(client.url, ticket));
    if (Result.isSuccess(reserved)) {
      if (client.id !== job.serverId) {
        yield* store.assign(job.id, client.id);
      }
      yield* log.info(`dispatching ${job.action}; ${client.url}`, {
        location: Log.Locations.automation,
        agentId: ticket,
      });
      const ran = yield* Effect.result(AutomationClient.run(client.url, prompt, ticket));
      if (Result.isFailure(ran)) {
        if (ran.failure.status === 503) {
          return yield* Errors.AtCapacity.make({
            message: ran.failure.message,
            agentId: ticket,
          });
        }
        return yield* Effect.fail(ran.failure);
      }
      return yield* Effect.void;
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

// One job at a time. A tick with no live client does not claim. Reserve runs against every
// live client; a 503 from all of them, or from /run after a reserve, puts the row back to
// pending so the queue is unchanged.
// Claim is uninterruptible so a shutdown cannot leave a pending row half-taken; the HTTP wait
// is restored so SIGTERM aborts an in-flight job; finish and unclaim are uninterruptible so
// the write lands. A tick that fails is one error line; the next tick runs.
export const dispatch = Effect.fn("dispatch")(function* () {
  const servers = yield* Servers.ServerStore;
  const store = yield* Automation.AutomationStore;
  const log = yield* Log.Log;

  const tick = Effect.fn("tick")(function* () {
    const live = yield* servers.listLiveServers("automation-client");
    const chosen = live[0];
    if (chosen === undefined) {
      return;
    }
    yield* Effect.uninterruptibleMask((restore) =>
      store.claim(chosen.id).pipe(
        Effect.flatMap((maybe) => {
          if (Option.isNone(maybe)) {
            return Effect.void;
          }
          const job = maybe.value;
          return restore(execute(job, live)).pipe(
            Effect.matchCause({
              onSuccess: (): Outcome | { readonly deferred: true; readonly agentId?: string } => ({
                status: "succeeded",
                reason: null,
              }),
              onFailure: (
                cause,
              ): Outcome | { readonly deferred: true; readonly agentId?: string } => {
                const error = Cause.squash(cause);
                return isAtCapacity(error)
                  ? Object.assign(
                      { deferred: true as const },
                      error.agentId === undefined ? undefined : { agentId: error.agentId },
                    )
                  : outcomeFrom(cause);
              },
            }),
            Effect.flatMap((outcome) =>
              Effect.gen(function* () {
                if ("deferred" in outcome) {
                  const restored = yield* store.unclaim(job.id);
                  if (restored) {
                    yield* log.info(
                      "deferred; at capacity",
                      outcome.agentId === undefined
                        ? { location: Log.Locations.automation }
                        : { location: Log.Locations.automation, agentId: outcome.agentId },
                    );
                  }
                  return;
                }
                const closed = yield* store.finish(job.id, outcome.status, outcome.reason);
                // abort may have closed the row first
                if (closed) {
                  yield* logOutcome(job, outcome);
                }
              }),
            ),
          );
        }),
      ),
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
