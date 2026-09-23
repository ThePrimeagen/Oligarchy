import { Cause, Effect, Option, Result, Schedule, Schema, Scope } from "effect";
import * as Linear from "../ctrl/linear.ts";
import * as Automation from "../db/automation.ts";
import * as Servers from "../db/servers.ts";
import * as SetupRequests from "../db/setup-requests.ts";
import * as Tests from "../db/tests.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";
import * as AutomationClient from "./client.ts";
import * as Prompts from "./prompts.ts";
import * as Ready from "./ready.ts";

const DISPATCH_INTERVAL = "5 seconds";
const ABORT_TIMEOUT = "10 seconds";

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

// The automation server that owned the row is gone. That is the harness, the same way a qemu
// server restart errors the sessions it left, not a run that failed.
const restarted: Outcome = {
  status: "errored",
  reason: "automation server restarted",
};

const succeeded: Outcome = { status: "succeeded", reason: null };

const failedFrom = (cause: Cause.Cause<unknown>): Outcome => ({
  status: "failed",
  reason: Render.errorDetail(Cause.squash(cause)),
});

// The harness could not place the job, so the run never started.
const erroredFrom = (cause: Cause.Cause<unknown>): Outcome => ({
  status: "errored",
  reason: Render.errorDetail(Cause.squash(cause)),
});

// The line, and the error Sentry groups on, for an automation client answering 404 about a job
// the database has running: every one is reported, from dispatch and from POST /abort.
export const reportJobNotFound = Effect.fn("reportJobNotFound")(function* (
  jobId: string,
  url: string,
  ticket: string,
  cause: Errors.AutomationClientError,
) {
  const log = yield* Log.Log;
  const error = Errors.JobNotFound.make({ jobId, url, cause });
  yield* log.error(`JobNotFound: ${error.message}`, {
    location: Log.Locations.automation,
    agentId: ticket,
    cause: error,
  });
});

type Placement = {
  readonly url: string;
  readonly serverId: string;
  readonly prompt: string;
  readonly ticket: string;
};

type PlaceResult =
  | { readonly _tag: "placed"; readonly placement: Placement }
  | {
      readonly _tag: "deferred";
      readonly continueTick: boolean;
      readonly line: string;
      readonly agentId: string;
    }
  | { readonly _tag: "unavailable"; readonly continueTick: boolean };

// Build the prompt and take a client slot, the client reserving a guest too when the job is a
// drive. The row stays pending. /run is not waited here: a reserved job starts in its own fiber
// so the next pending row can reserve on this tick. A full client or one whose guest is not
// minted is the fleet's ordinary answer; anything else is logged and the next client is asked.
const place = Effect.fn("place")(function* (
  job: Automation.AutomationJobRow,
  clients: ReadonlyArray<Servers.LiveServer>,
  model: string,
) {
  const tests = yield* Tests.TestStore;
  const setups = yield* SetupRequests.SetupRequestStore;
  const log = yield* Log.Log;
  const result = yield* tests.findResult(job.resultId);
  if (Option.isNone(result) || result.value.linearId === null) {
    return yield* Errors.AutomationClientError.make({ message: "no Linear ticket" });
  }
  const ticket = result.value.linearId;
  const prompt =
    job.action === "diagnose"
      ? yield* Prompts.diagnose(ticket, job.resultId, model)
      : yield* Prompts.drive(ticket, model);
  // A drive resumes the run's iso. A mint boots fresh. A missing row reserves fresh rather
  // than failing a drive the definition lookup cannot see.
  const resume =
    job.action === "drive" ? yield* tests.resumeIso(job.resultId) : Option.none<string>();
  // A mint's guest has to be the server the setup lock named. No pin, no reserve.
  const pinned =
    job.action === "mint" ? yield* setups.serverForResult(job.resultId) : Option.none<string>();
  if (job.action === "mint" && Option.isNone(pinned)) {
    return yield* Errors.AutomationClientError.make({
      message: `mint ${ticket} has no pinned server`,
    });
  }
  let sawCapacity = false;
  let sawSetup = false;
  let sawUnexpected = false;
  for (const client of clients) {
    const reserved = yield* Effect.result(
      AutomationClient.reserve(
        client.url,
        ticket,
        job.action,
        Option.getOrUndefined(resume),
        Option.getOrUndefined(pinned),
      ),
    );
    if (Result.isSuccess(reserved)) {
      const placed: PlaceResult = {
        _tag: "placed",
        placement: { url: client.url, serverId: client.id, prompt, ticket },
      };
      return placed;
    }
    if (reserved.failure.status === 409) {
      sawSetup = true;
      continue;
    }
    if (reserved.failure.status === 503) {
      sawCapacity = true;
      continue;
    }
    sawUnexpected = true;
    yield* log.error(`reserve failed; ${client.url}`, {
      location: Log.Locations.automation,
      agentId: ticket,
      cause: reserved.failure.cause ?? reserved.failure,
    });
  }
  // A mint stays first in the queue. Its own refusal must not end the tick, or a drive
  // behind it never gets a turn. Setup needed stops the tick: the guest is not ready.
  const continueTick = job.action === "mint";
  if (sawUnexpected) {
    const unavailable: PlaceResult = { _tag: "unavailable", continueTick };
    return unavailable;
  }
  if (sawSetup) {
    const deferred: PlaceResult = {
      _tag: "deferred",
      continueTick: false,
      line: "deferred; setup needed",
      agentId: ticket,
    };
    return deferred;
  }
  const deferred: PlaceResult = {
    _tag: "deferred",
    continueTick: sawCapacity && continueTick,
    line: continueTick ? "deferred; mint at capacity" : "deferred; at capacity",
    agentId: ticket,
  };
  return deferred;
});

// A driver's last act is ./ctrl test-results. Until then its result is pending or running.
const isOpen = (status: string): boolean => status === "pending" || status === "running";

// What the job made of a /run that answered 200. An open result is the run: the driver quit.
// A missing row is a defect, and a database error reading it fails this effect.
const judge = Effect.fn("judge")(function* (job: Automation.AutomationJobRow) {
  const tests = yield* Tests.TestStore;
  // A diagnose is judged by nothing here: the result was closed before it was queued.
  if (job.action === "diagnose") {
    return succeeded;
  }
  const after = yield* tests.findResult(job.resultId);
  if (Option.isNone(after)) {
    return yield* Effect.die(new Error(`judge: result ${job.resultId} vanished during the drive`));
  }
  if (isOpen(after.value.status)) {
    const open: Outcome = {
      status: "failed",
      reason: `driver exited; result ${job.resultId} is ${after.value.status}`,
    };
    return open;
  }
  return succeeded;
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
  if (outcome.status === "errored") {
    yield* log.error(`${job.action} errored; ${outcome.reason}`, attr);
    return;
  }
  yield* log.error(`${job.action} failed; ${outcome.reason}`, attr);
});

// True when this call closed the row. Three attempts at the write; a row that still will not
// close stays running for an operator to mark, and the line names the status it should have.
const closeJob = Effect.fn("closeJob")(function* (
  job: Automation.AutomationJobRow,
  outcome: Outcome,
) {
  const store = yield* Automation.AutomationStore;
  const log = yield* Log.Log;
  const written = yield* store
    .finish(job.id, outcome.status, outcome.reason)
    .pipe(Effect.retry(Schedule.recurs(2)), Effect.result);
  if (Result.isFailure(written)) {
    yield* log.error(`close write failed; ${job.id} should be ${outcome.status}`, {
      location: Log.Locations.automation,
      cause: written.failure,
    });
    return false;
  }
  // abort may have closed the row first
  if (!written.success) {
    return false;
  }
  yield* logOutcome(job, outcome);
  // Ready means a pending drive or mint. A diagnose was never labeled. A placement that
  // could not reserve does not close.
  if (job.action === "diagnose") {
    return true;
  }
  const tests = yield* Tests.TestStore;
  const result = yield* tests.findResult(job.resultId);
  if (Option.isSome(result) && result.value.linearId !== null) {
    yield* Ready.release(result.value.linearId);
  }
  return true;
});

// Ten seconds: an automation client that never answers must not hold dispatch. The timeout
// races on its own fibers, so it lands inside the tick's uninterruptible region too.
const abortAt = (url: string, ticket: string) =>
  AutomationClient.abort(url, ticket).pipe(
    Effect.timeoutOrElse({
      duration: ABORT_TIMEOUT,
      orElse: () =>
        Errors.AutomationClientError.make({
          message: `automation client: POST ${url}/abort failed: no answer within ${ABORT_TIMEOUT}`,
        }),
    }),
  );

// A shutdown ended the /run wait, and OpenCode outlives a dropped /run, so the automation
// client is asked to stop the job before its row closes aborted. A 404 is an automation client
// holding nothing for a job this process has running: reported, then closed aborted. One that
// fails the stop or does not answer leaves OpenCode unconfirmed: reported, and the row stays
// running, so the next startup stops it and fails it.
const stopAtShutdown = Effect.fn("stopAtShutdown")(function* (
  job: Automation.AutomationJobRow,
  placement: Placement,
) {
  const log = yield* Log.Log;
  const stopped = yield* Effect.result(abortAt(placement.url, placement.ticket));
  if (Result.isFailure(stopped)) {
    if (stopped.failure.status !== 404) {
      yield* log.error(`shutdown abort failed; ${placement.url}`, {
        location: Log.Locations.automation,
        agentId: placement.ticket,
        cause: stopped.failure.cause ?? stopped.failure,
      });
      return;
    }
    yield* reportJobNotFound(job.id, placement.url, placement.ticket, stopped.failure);
  }
  yield* closeJob(job, aborted);
});

// A running row at startup was taken by the automation server that died: the fiber that
// would have closed it went with it. A drive or mint whose result its driver closed has
// finished, and is closed succeeded as that fiber would have closed it. Nothing is asked of
// its automation client and its ticket is not moved: whatever the driver still does after
// closing the result, it does on its own. A diagnose's result was closed before it was
// queued, so it says nothing about the diagnose. Every other row is stopped at the
// automation client that took it, so opencode is killed or the reservation and its qemu slot
// are given back, then errored, and its ticket moved to Failed. A 404 is an automation client
// holding nothing for the ticket, which is reported. One that does not answer is reported and
// the job is errored anyway; nothing asks again. No ticket, no automation client recorded, or
// that client's row gone: nothing to ask. Once the row is closed it is no longer found at the
// next startup, so the close and the Linear move finish even when a shutdown lands between them.
const closeInherited = Effect.fn("closeInherited")(function* (job: Automation.AutomationJobRow) {
  const tests = yield* Tests.TestStore;
  const servers = yield* Servers.ServerStore;
  const linear = yield* Linear.Linear;
  const log = yield* Log.Log;
  const result = yield* tests.findResult(job.resultId);
  if (job.action !== "diagnose" && Option.isSome(result) && !isOpen(result.value.status)) {
    yield* Effect.uninterruptible(closeJob(job, succeeded));
    return;
  }
  const ticket = Option.isSome(result) ? result.value.linearId : null;
  if (ticket !== null && job.serverId !== null) {
    const client = yield* servers.findServer(job.serverId);
    if (Option.isSome(client)) {
      const url = client.value.url;
      yield* abortAt(url, ticket).pipe(
        Effect.catchTag("AutomationClientError", (error) =>
          error.status === 404
            ? reportJobNotFound(job.id, url, ticket, error)
            : log.error(`inherited abort failed; ${url}`, {
                location: Log.Locations.automation,
                agentId: ticket,
                cause: error.cause ?? error,
              }),
        ),
      );
    }
  }
  yield* Effect.uninterruptible(
    Effect.gen(function* () {
      const closed = yield* closeJob(job, restarted);
      if (!closed || ticket === null) {
        return;
      }
      yield* linear.moveToFailed(ticket).pipe(
        Effect.retry(Schedule.recurs(2)),
        Effect.catchTag("LinearError", (error) =>
          log.error(`move to Failed failed: ${detail(error)}`, {
            location: Log.Locations.automation,
            agentId: ticket,
            cause: error,
          }),
        ),
      );
    }),
  );
});

// Jobs launch one reservation at a time, round robin from where the last one stopped.
// The next reservation is not sent until this one has answered, so two reservation
// responses are never in flight. The row stays pending until a client has reserved;
// pending -> running names that client. A drive or mint is then moved to In Progress,
// three attempts, and only then does /run start. A diagnose is left for its driver to
// move to In Review. A move that still fails gives the reservation back and errors the
// job: Linear did not move, so the run never started. The move does not hold the next
// reservation, and neither does /run. A 503 or 409
// from a client is ordinary and the next client
// is asked; when none can take the job the row stays pending for a later pass. Any
// other reserve failure is logged and the next client is asked. A mint's own refusal
// does not end the tick. A tick with no live client does not select. The selection and
// the running write are uninterruptible; the HTTP wait is restored so SIGTERM can
// abandon a reserve that has not landed. A tick that fails is one error line; the next
// tick runs. Before the first tick, every running row the last automation server left is
// closed, one at a time: a finished drive or mint succeeded, any other stopped and errored. A
// row that fails is one error line and the next row is tried, and a listing that fails is one
// error line. Dispatch starts either way. A shutdown asks each automation client to stop the
// jobs it runs, all at once, and closes each aborted once its client answers.
export const dispatch = Effect.fn("dispatch")(function* (model: string) {
  const servers = yield* Servers.ServerStore;
  const store = yield* Automation.AutomationStore;
  const log = yield* Log.Log;
  // The /run fibers. Created before the ticks fork, so a shutdown stops the ticks first; its
  // finalizers run at once, so every automation client is asked to stop in the same ten seconds.
  const runs = yield* Scope.fork(yield* Scope.Scope, "parallel");
  // The client the next tick offers a job to first. A client that left the fleet is skipped.
  let nextUrl: string | undefined;

  const tick = Effect.fn("tick")(function* () {
    const live = yield* servers.listLiveServers("automation-client");
    const chosen = live[0];
    if (chosen === undefined) {
      return;
    }
    yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        // Mint jobs this tick already refused. They stay pending and first, but this tick
        // does not select them again; the other jobs still get a turn.
        const skipped: Array<string> = [];
        for (;;) {
          const maybe = yield* store.nextPending(skipped);
          if (Option.isNone(maybe)) {
            return yield* Effect.void;
          }
          const job = maybe.value;
          const start =
            nextUrl === undefined ? -1 : live.findIndex((server) => server.url === nextUrl);
          const at = start < 0 ? 0 : start;
          // place awaits each reservation before the next, including the next job.
          const candidates = live.slice(at).concat(live.slice(0, at));
          const placed = yield* restore(place(job, candidates, model)).pipe(
            Effect.matchCause({
              onSuccess: (result) => result,
              onFailure: (cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? { _tag: "interrupted" as const }
                  : { _tag: "closed" as const, outcome: erroredFrom(cause) },
            }),
          );
          if (placed._tag === "interrupted") {
            return yield* Effect.interrupt;
          }
          if (placed._tag === "deferred") {
            yield* log.info(placed.line, {
              location: Log.Locations.automation,
              agentId: placed.agentId,
            });
            if (placed.continueTick) {
              skipped.push(job.id);
              continue;
            }
            return yield* Effect.void;
          }
          if (placed._tag === "unavailable") {
            if (placed.continueTick) {
              skipped.push(job.id);
              continue;
            }
            return yield* Effect.void;
          }
          if (placed._tag === "closed") {
            const closed = yield* closeJob(job, placed.outcome);
            // A row the close did not write is still pending, and selecting again would find it.
            if (!closed) {
              return yield* Effect.void;
            }
            continue;
          }
          const releaseReservation = (url: string, ticket: string) =>
            abortAt(url, ticket).pipe(
              Effect.catchTag("AutomationClientError", (error) =>
                log.error(`reserve release failed; ${url}`, {
                  location: Log.Locations.automation,
                  agentId: ticket,
                  cause: error,
                }),
              ),
            );
          // Two immediate retries: three attempts, then the reservation is given back.
          // A lost compare-and-swap is not a database failure and is not retried.
          const written = yield* store
            .markRunning(job.id, placed.placement.serverId)
            .pipe(Effect.retry(Schedule.recurs(2)), Effect.result);
          if (Result.isFailure(written)) {
            yield* log.error(`running write failed; ${placed.placement.url}`, {
              location: Log.Locations.automation,
              agentId: placed.placement.ticket,
              cause: written.failure,
            });
            yield* releaseReservation(placed.placement.url, placed.placement.ticket);
            // The reservation is gone. The database failed the harness, so the row is
            // errored, three attempts. A successful write is not logged again.
            yield* store.finish(job.id, "errored", "DATABASE FAILURE").pipe(
              Effect.tapError((error) =>
                log.error(`failure write failed; ${placed.placement.url}`, {
                  location: Log.Locations.automation,
                  agentId: placed.placement.ticket,
                  cause: error,
                }),
              ),
              Effect.retry(Schedule.recurs(2)),
              Effect.catch(() => Effect.void),
            );
            return yield* Effect.void;
          }
          if (!written.success) {
            // The row left pending while the client held the reservation, usually an
            // operator abort. Release it so the slot does not sit until it expires.
            yield* releaseReservation(placed.placement.url, placed.placement.ticket);
            continue;
          }
          const taken = live.findIndex((server) => server.url === placed.placement.url);
          const following = taken < 0 ? undefined : live[(taken + 1) % live.length];
          if (following !== undefined) {
            nextUrl = following.url;
          }
          // The reservation already returned. The move and /run do not hold the next one.
          // The fiber lives on the runs scope so a shutdown interrupts it. It starts
          // uninterruptible: a shutdown that lands before it runs is held until the move
          // or the /run wait, the interruptible parts, so the job is still stopped at its
          // automation client. Once /run answered, a shutdown waits for the result to judge
          // the job. A 409 is a run POST /abort ended: that abort closes the row once the
          // automation client answers it.
          const placement = placed.placement;
          yield* Effect.forkIn(
            Effect.gen(function* () {
              // A diagnose starts from Needs Review. Its driver moves it to In Review.
              if (job.action !== "diagnose") {
                const linear = yield* Linear.Linear;
                const moved = yield* linear.moveToInProgress(placement.ticket).pipe(
                  Effect.retry(Schedule.recurs(2)),
                  Effect.interruptible,
                  Effect.matchCause({
                    onSuccess: () => ({ _tag: "moved" as const }),
                    onFailure: (cause) =>
                      Cause.hasInterruptsOnly(cause)
                        ? { _tag: "interrupted" as const }
                        : { _tag: "failed" as const, cause },
                  }),
                );
                if (moved._tag === "interrupted") {
                  return yield* stopAtShutdown(job, placement);
                }
                if (moved._tag === "failed") {
                  const error = Cause.squash(moved.cause);
                  yield* log.error(`move to In Progress failed; ${placement.url}`, {
                    location: Log.Locations.automation,
                    agentId: placement.ticket,
                    cause: error,
                  });
                  yield* releaseReservation(placement.url, placement.ticket);
                  yield* closeJob(job, { status: "errored", reason: detail(error) });
                  return yield* Effect.void;
                }
              }
              yield* log.info(`dispatching ${job.action}; ${placement.url}; ${model}`, {
                location: Log.Locations.automation,
                agentId: placement.ticket,
              });
              return yield* Effect.interruptible(
                AutomationClient.run(placement.url, placement.prompt, placement.ticket, model),
              ).pipe(
                Effect.andThen(judge(job)),
                Effect.matchCauseEffect({
                  onSuccess: (outcome) => closeJob(job, outcome),
                  onFailure: (cause) => {
                    if (Cause.hasInterruptsOnly(cause)) {
                      return stopAtShutdown(job, placement);
                    }
                    const error = Cause.findErrorOption(cause);
                    // 409 is a run POST /abort ended: that abort closes the row.
                    if (
                      Option.isSome(error) &&
                      error.value._tag === "AutomationClientError" &&
                      error.value.status === 409
                    ) {
                      return Effect.void;
                    }
                    // 500 is the client reporting that the run failed. No answer, any other
                    // status, a database error reading the result, or a vanished row is the harness.
                    if (
                      Option.isSome(error) &&
                      error.value._tag === "AutomationClientError" &&
                      error.value.status === 500
                    ) {
                      return closeJob(job, failedFrom(cause));
                    }
                    return closeJob(job, erroredFrom(cause));
                  },
                }),
              );
            }).pipe(
              Effect.catchCause((cause) => {
                const error = Cause.squash(cause);
                return log.error(`dispatch job failed: ${detail(error)}`, {
                  location: Log.Locations.automation,
                  cause: error,
                });
              }),
            ),
            runs,
            { uninterruptible: true },
          );
        }
      }),
    );
  });

  // An interrupt is a shutdown and stays one. Anything else is one error line.
  const reportFailure =
    (line: string) =>
    <E>(cause: Cause.Cause<E>) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      const error = Cause.squash(cause);
      return log.error(`${line}: ${detail(error)}`, {
        location: Log.Locations.automation,
        cause: error,
      });
    };

  const inherited = Effect.gen(function* () {
    for (const job of yield* store.listRunning()) {
      yield* closeInherited(job).pipe(
        Effect.catchCause(reportFailure(`inherited job cleanup failed; ${job.id}`)),
      );
    }
  }).pipe(Effect.catchCause(reportFailure("inherited jobs check failed")));

  const ticks = tick().pipe(
    Effect.catchCause(reportFailure("dispatch tick failed")),
    Effect.repeat(Schedule.spaced(DISPATCH_INTERVAL)),
  );

  yield* inherited.pipe(Effect.andThen(ticks), Effect.forkScoped({ startImmediately: true }));
});
