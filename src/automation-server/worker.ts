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

const execute = Effect.fn("execute")(function* (job: Automation.AutomationJobRow, url: string) {
  const tests = yield* Tests.TestStore;
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
  yield* log.info(`dispatching ${job.action}; ${url}`, {
    location: Log.Locations.automation,
    agentId: ticket,
  });
  return yield* AutomationClient.run(url, prompt);
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

// One job at a time, to the first live automation-client. A tick with no live client does not
// claim. Claim is uninterruptible so a shutdown cannot leave a pending row half-taken; the HTTP
// wait is restored so SIGTERM aborts an in-flight job; finish is uninterruptible so the write
// lands. A tick that fails is one error line; the next tick runs.
export const dispatch = Effect.fn("dispatch")(function* () {
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
          return restore(execute(job, url)).pipe(
            Effect.matchCause({
              onSuccess: (): Outcome => ({ status: "succeeded", reason: null }),
              onFailure: outcomeFrom,
            }),
            Effect.flatMap((outcome) =>
              logOutcome(job, outcome).pipe(
                Effect.andThen(store.finish(job.id, outcome.status, outcome.reason)),
              ),
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
