import {
  Array as Arr,
  Cause,
  Clock,
  Effect,
  Exit,
  FileSystem,
  Option,
  Ref,
  Schedule,
  Scope,
} from "effect";
import { HttpClient } from "effect/unstable/http";
import * as Config from "../config.ts";
import * as Linear from "../ctrl/linear.ts";
import * as Automation from "../db/automation.ts";
import * as Servers from "../db/servers.ts";
import * as Tests from "../db/tests.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Clients from "./clients.ts";
import * as Prompts from "./prompts.ts";

// Ten seconds: a job waits at most that long past its readiness, and a tick that finds nothing
// costs one indexed query.
export const DISPATCH_INTERVAL = "10 seconds";

const processAttr = {
  location: Log.Locations.automationServer,
  agentId: Log.AutomationAgentId,
} as const;

const jobAttr = (ticket: string) => ({
  location: Log.Locations.automationServer,
  agentId: ticket,
});

export const sweep = Effect.fn("Dispatcher.sweep")(function* (reason: string) {
  const automation = yield* Automation.AutomationStore;
  const log = yield* Log.Log;
  const count = yield* automation.abortRunning(reason);
  if (count > 0) {
    yield* log.info(`${String(count)} jobs aborted; ${reason}`, processAttr);
  }
  return count;
});

// The loop owns every job it claims until the row is closed. Interrupting the loop closes the
// scope its runs live in, which interrupts each run, whose own exit handler closes its row.
export const loop: Effect.Effect<
  void,
  never,
  | Automation.AutomationStore
  | Tests.TestStore
  | Servers.ServerStore
  | Linear.Linear
  | Log.Log
  | Config.AutomationServerConfig
  | HttpClient.HttpClient
  | FileSystem.FileSystem
> = Effect.gen(function* () {
  const automation = yield* Automation.AutomationStore;
  const tests = yield* Tests.TestStore;
  const servers = yield* Servers.ServerStore;
  const log = yield* Log.Log;
  const jobs = yield* Scope.make();
  // Runs in flight per client url: this dispatcher is the only thing that starts runs, so its own
  // count is exact where a client's heartbeat is up to thirty seconds stale.
  const counts = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
  const warned = yield* Ref.make(false);

  // Closes the row, and for a drive that did not succeed, the result the agent was going to close
  // and now never will. Either write failing is one error line; the job is not what is failing.
  const close = (
    job: Automation.AutomationJobRow,
    status: Automation.TerminalStatus,
    reason: string | null,
  ) =>
    Effect.gen(function* () {
      const closed = yield* automation.closeJob(job.id, status, reason).pipe(
        Effect.catch((error) =>
          log
            .error(`db: closing job ${job.id} failed: ${Render.errorDetail(error)}`, {
              ...processAttr,
              cause: error,
            })
            .pipe(Effect.as(false)),
        ),
      );
      if (closed && status !== "succeeded" && job.action === "drive") {
        yield* tests.abortOpenResult(job.resultId, `automation: ${reason ?? status}`).pipe(
          Effect.catch((error) =>
            log
              .error(`db: aborting result ${job.resultId} failed: ${Render.errorDetail(error)}`, {
                ...processAttr,
                cause: error,
              })
              .pipe(Effect.as(false)),
          ),
        );
      }
      return closed;
    });

  const failed = (
    job: Automation.AutomationJobRow,
    who: Log.Attribution,
    reason: string,
    report: { readonly skipSentry?: true; readonly cause?: unknown },
  ) =>
    Effect.gen(function* () {
      yield* close(job, "failed", reason);
      yield* log.error(`job failed; ${job.action}; ${reason}`, { ...who, ...report });
    });

  const taken = (url: string) =>
    Ref.update(counts, (map) => new Map(map).set(url, (map.get(url) ?? 0) + 1));

  const released = (url: string) =>
    Ref.modify(counts, (map) => {
      const n = map.get(url);
      if (n === undefined) {
        return [false, map];
      }
      const next = new Map(map);
      if (n === 1) {
        next.delete(url);
      } else {
        next.set(url, n - 1);
      }
      return [true, next];
    }).pipe(
      Effect.flatMap((known) =>
        known
          ? Effect.void
          : Effect.die(new Error(`released a run on ${url} that was never counted`)),
      ),
    );

  // One run, from the call to the row's close. Shutdown reaches it as an interrupt; anything else
  // that is not the client's answer is a defect of this process, and the row says so.
  const runJob = (job: Automation.AutomationJobRow, ticket: string, url: string, prompt: string) =>
    Effect.gen(function* () {
      const started = yield* Clock.currentTimeMillis;
      yield* Clients.run(url, ticket, prompt).pipe(
        Effect.matchEffect({
          onSuccess: () =>
            Effect.gen(function* () {
              yield* close(job, "succeeded", null);
              const elapsed = (yield* Clock.currentTimeMillis) - started;
              yield* log.info(
                `job succeeded; ${job.action} in ${String(elapsed)}ms`,
                jobAttr(ticket),
              );
            }),
          onFailure: (error) => {
            if (error._tag === "ProxyUnreachable") {
              // The client's answer never came: only this process saw why, so this one reports.
              const reason = `automation client ${url} unreachable: ${Render.errorDetail(error.cause)}`;
              return failed(job, jobAttr(ticket), reason, { cause: error });
            }
            if (error.status === 504) {
              return Effect.gen(function* () {
                yield* close(job, "timed_out", error.message);
                yield* log.error(`job timed out; ${job.action}`, {
                  ...jobAttr(ticket),
                  skipSentry: true,
                });
              });
            }
            // The client logged and reported the failure with its cause; the row gets its message.
            return failed(job, jobAttr(ticket), error.message, { skipSentry: true });
          },
        }),
      );
    }).pipe(
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) {
          return released(url);
        }
        if (Cause.hasInterruptsOnly(exit.cause)) {
          return Effect.gen(function* () {
            yield* released(url);
            if (yield* close(job, "aborted", "automation-server shutdown")) {
              yield* log.info(
                `job aborted; ${job.action}; automation-server shutdown`,
                jobAttr(ticket),
              );
            }
          });
        }
        const error = Cause.squash(exit.cause);
        return Effect.gen(function* () {
          yield* released(url);
          yield* failed(job, jobAttr(ticket), Render.errorDetail(error), { cause: error });
        });
      }),
    );

  // Claimed, and this tick's until a fiber owns it: a failure anywhere in here closes the row.
  const dispatch = (
    job: Automation.AutomationJobRow,
    clients: Arr.NonEmptyReadonlyArray<{ readonly url: string; readonly agents: number }>,
  ) =>
    Effect.gen(function* () {
      const result = yield* tests.findResult(job.resultId);
      const ticket = yield* Option.match(
        Option.flatMap(result, (row) => Option.fromNullOr(row.linearId)),
        {
          onNone: () => Effect.die(new Error(`claimed job ${job.id} has no ticket`)),
          onSome: (id) => Effect.succeed(id),
        },
      );
      yield* Prompts.compose(job, ticket, job.resultId).pipe(
        Effect.matchEffect({
          onFailure: (error) => failed(job, jobAttr(ticket), error.message, { cause: error }),
          onSuccess: (prompt) =>
            Effect.gen(function* () {
              const load = yield* Ref.get(counts);
              let chosen = Arr.headNonEmpty(clients);
              for (const client of clients) {
                if ((load.get(client.url) ?? 0) < (load.get(chosen.url) ?? 0)) {
                  chosen = client;
                }
              }
              yield* taken(chosen.url);
              yield* runJob(job, ticket, chosen.url, prompt).pipe(Effect.forkIn(jobs));
              yield* log.info(`job started; ${job.action}; ${chosen.url}`, jobAttr(ticket));
            }),
        }),
      );
    }).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        return failed(job, processAttr, Render.errorDetail(error), { cause: error });
      }),
    );

  const tick = Effect.gen(function* () {
    const clients = yield* servers.listAutomationClients;
    if (!Arr.isReadonlyArrayNonEmpty(clients)) {
      const waiting = yield* automation.countReady;
      if (waiting > 0 && !(yield* Ref.get(warned))) {
        yield* Ref.set(warned, true);
        yield* log.warning(
          `no automation client available; ${String(waiting)} jobs waiting`,
          processAttr,
        );
      }
      return;
    }
    yield* Ref.set(warned, false);
    const claimed = yield* automation.claimNext;
    if (Option.isSome(claimed)) {
      yield* dispatch(claimed.value, clients);
    }
  });

  // Uninterruptible so that shutdown's interrupt waits for a claim in flight to reach its fiber
  // instead of tearing it; repeat runs the ticks one after another, so none overlaps.
  yield* Effect.uninterruptible(tick).pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);
      return log.error(`dispatch failed: ${Render.errorDetail(error)}`, {
        ...processAttr,
        cause: error,
      });
    }),
    Effect.repeat(Schedule.spaced(DISPATCH_INTERVAL)),
    Effect.ensuring(Scope.close(jobs, Exit.void)),
  );
}).pipe(Effect.withSpan("Dispatcher.loop"));
