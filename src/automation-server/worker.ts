import { Cause, Effect, Option, Schedule, Schema } from "effect";
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
  url: string,
  model: string,
) {
  const tests = yield* Tests.TestStore;
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
  yield* log.info(`dispatching ${job.action}; ${url}; ${model}`, {
    location: Log.Locations.automation,
    agentId: ticket,
  });
  yield* AutomationClient.run(url, prompt, model);
  // A driver's last act is ./ctrl test-results; opencode exiting 0 with the result still open is
  // an agent that quit early, and the job says so rather than reading as a run. A diagnose is
  // judged by nothing here: the result was closed before it was queued.
  const after = job.action === "drive" ? yield* tests.findResult(job.resultId) : Option.none();
  if (
    Option.isSome(after) &&
    (after.value.status === "pending" || after.value.status === "running")
  ) {
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

// One job at a time, to the first live automation-client, every one run as `model`. A tick with
// no live client does not claim. Claim is uninterruptible so a shutdown cannot leave a pending
// row half-taken; the HTTP wait is restored so SIGTERM aborts an in-flight job; finish is
// uninterruptible so the write lands. A tick that fails is one error line; the next tick runs.
export const dispatch = Effect.fn("dispatch")(function* (model: string) {
  const servers = yield* Servers.ServerStore;
  const store = yield* Automation.AutomationStore;
  const log = yield* Log.Log;

  const tick = Effect.fn("tick")(function* () {
    const live = yield* servers.listLiveServers("automation-client");
    const url = live[0];
    if (url === undefined) {
      return;
    }
    yield* Effect.uninterruptibleMask((restore) =>
      store.claim().pipe(
        Effect.flatMap((maybe) => {
          if (Option.isNone(maybe)) {
            return Effect.void;
          }
          const job = maybe.value;
          return restore(execute(job, url, model)).pipe(
            Effect.matchCause({
              onSuccess: (): Outcome => ({ status: "succeeded", reason: null }),
              onFailure: outcomeFrom,
            }),
            Effect.flatMap((outcome) =>
              Effect.gen(function* () {
                const closed = yield* store.finish(job.id, outcome.status, outcome.reason);
                if (!closed) {
                  return yield* Effect.die(
                    new Error(`finishAutomationJob: ${job.id} was not running`),
                  );
                }
                return yield* logOutcome(job, outcome);
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
