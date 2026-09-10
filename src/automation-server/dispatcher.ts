import {
  Cause,
  Clock,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Option,
  Ref,
  Schedule,
  Scope,
  Semaphore,
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

export const DISPATCH_INTERVAL = "10 seconds";
export const FRESH_WITHIN_MS = 90_000;

const processAttr = {
  location: Log.Locations.automationServer,
  agentId: Log.AutomationAgentId,
} as const;

const jobAttr = (ticket: string) => ({
  location: Log.Locations.automationServer,
  agentId: ticket,
});

type Flight = {
  readonly fiber: Fiber.Fiber<void>;
  readonly url: string;
  readonly ticket: string;
};

export const sweep = Effect.fn("Dispatcher.sweep")(function* (reason: string) {
  const automation = yield* Automation.AutomationStore;
  const log = yield* Log.Log;
  const count = yield* automation.abortRunning(reason);
  if (count > 0) {
    yield* log.info(`${String(count)} jobs aborted; ${reason}`, processAttr);
  }
  return count;
});

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
  | Scope.Scope
> = Effect.gen(function* () {
  const automation = yield* Automation.AutomationStore;
  const tests = yield* Tests.TestStore;
  const servers = yield* Servers.ServerStore;
  const log = yield* Log.Log;
  const jobs = yield* Scope.make();
  const guard = yield* Semaphore.make(1);
  const inFlight = yield* Ref.make<ReadonlyMap<string, Flight>>(new Map());
  const counts = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
  const warned = yield* Ref.make(false);

  // Registered before the loop so shutdown interrupts in-flight runs after the loop fiber stops.
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const flights = yield* Ref.get(inFlight);
      yield* Effect.forEach([...flights.values()], (flight) => Fiber.interrupt(flight.fiber), {
        concurrency: "unbounded",
      });
      yield* Scope.close(jobs, Exit.void);
    }),
  );

  const closeRow = (id: string, status: Automation.TerminalStatus, reason: string | null) =>
    automation.closeJob(id, status, reason).pipe(
      Effect.catch((error) =>
        log
          .error(`db: closing job ${id} failed: ${Render.errorDetail(error)}`, {
            ...processAttr,
            cause: error,
          })
          .pipe(Effect.as(false)),
      ),
    );

  const abortOpenResult = (job: Automation.AutomationJobRow, reason: string) => {
    if (job.action !== "drive") {
      return Effect.void;
    }
    return tests.findResult(job.resultId).pipe(
      Effect.flatMap((result) => {
        if (Option.isNone(result)) {
          return Effect.void;
        }
        if (result.value.status !== "pending" && result.value.status !== "running") {
          return Effect.void;
        }
        return tests
          .closeResult(result.value.id, "aborted", `automation: ${reason}`, null)
          .pipe(Effect.asVoid);
      }),
    );
  };

  const finish = (
    job: Automation.AutomationJobRow,
    ticket: string,
    status: Automation.TerminalStatus,
    reason: string | null,
    line: {
      readonly level: "info" | "error";
      readonly text: string;
      readonly skipSentry?: true;
      readonly cause?: unknown;
    },
  ) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        yield* closeRow(job.id, status, reason);
        if (status === "failed" || status === "timed_out") {
          // The job row is already closed; a result write that fails is the next reviewer's.
          yield* abortOpenResult(job, reason ?? line.text).pipe(Effect.ignore);
        }
        const attribution = Object.assign(
          jobAttr(ticket),
          line.skipSentry === true ? { skipSentry: true as const } : {},
          line.cause === undefined ? {} : { cause: line.cause },
        );
        if (line.level === "info") {
          yield* log.info(line.text, attribution);
        } else {
          yield* log.error(line.text, attribution);
        }
      }),
    );

  const drop = (jobId: string, url: string) =>
    Effect.gen(function* () {
      yield* Ref.update(inFlight, (map) => {
        const next = new Map(map);
        next.delete(jobId);
        return next;
      });
      yield* Ref.update(counts, (map) => {
        const next = new Map(map);
        const n = (next.get(url) ?? 1) - 1;
        if (n <= 0) {
          next.delete(url);
        } else {
          next.set(url, n);
        }
        return next;
      });
    });

  const runJob = (job: Automation.AutomationJobRow, ticket: string, url: string, prompt: string) =>
    Effect.gen(function* () {
      const started = yield* Clock.currentTimeMillis;
      yield* Clients.run(url, ticket, prompt).pipe(
        Effect.matchEffect({
          onSuccess: () =>
            Effect.gen(function* () {
              const elapsed = (yield* Clock.currentTimeMillis) - started;
              yield* finish(job, ticket, "succeeded", null, {
                level: "info",
                text: `job succeeded; ${job.action} in ${String(elapsed)}ms`,
              });
            }),
          onFailure: (error) =>
            error._tag === "ProxyRefusal"
              ? error.status === 504
                ? finish(job, ticket, "timed_out", error.message, {
                    level: "error",
                    text: `job timed out; ${job.action}`,
                    skipSentry: true,
                  })
                : finish(job, ticket, "failed", error.message, {
                    level: "error",
                    text: `job failed; ${job.action}; ${error.message}`,
                    skipSentry: true,
                  })
              : finish(
                  job,
                  ticket,
                  "failed",
                  `automation client ${url} unreachable: ${Render.errorDetail(error)}`,
                  {
                    level: "error",
                    text: `job failed; ${job.action}; automation client ${url} unreachable: ${Render.errorDetail(error)}`,
                    cause: error,
                  },
                ),
        }),
      );
    }).pipe(
      Effect.onExit((exit) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            yield* drop(job.id, url);
            if (Exit.isFailure(exit)) {
              const closed = yield* closeRow(job.id, "aborted", "automation-server shutdown");
              if (closed) {
                yield* abortOpenResult(job, "automation-server shutdown").pipe(Effect.ignore);
                yield* log.info(
                  `job aborted; ${job.action}; automation-server shutdown`,
                  jobAttr(ticket),
                );
              }
            }
          }),
        ),
      ),
    );

  const tick = Effect.gen(function* () {
    const clients = yield* servers.listAutomationClients;
    const first = clients[0];
    if (first === undefined) {
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
    if (Option.isNone(claimed)) {
      return;
    }
    const job = claimed.value;
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
        onFailure: (error) =>
          finish(job, ticket, "failed", error.message, {
            level: "error",
            text: `job failed; ${job.action}; ${error.message}`,
            cause: error,
          }),
        onSuccess: (prompt) =>
          Effect.gen(function* () {
            const load = yield* Ref.get(counts);
            let chosen = first;
            let best = load.get(chosen.url) ?? 0;
            for (const client of clients) {
              const n = load.get(client.url) ?? 0;
              if (n < best) {
                chosen = client;
                best = n;
              }
            }
            yield* Ref.update(counts, (map) => {
              const next = new Map(map);
              next.set(chosen.url, (next.get(chosen.url) ?? 0) + 1);
              return next;
            });
            const fiber = yield* runJob(job, ticket, chosen.url, prompt).pipe(Effect.forkIn(jobs));
            yield* Ref.update(inFlight, (map) => {
              const next = new Map(map);
              next.set(job.id, { fiber, url: chosen.url, ticket });
              return next;
            });
            yield* log.info(`job started; ${job.action}; ${chosen.url}`, jobAttr(ticket));
          }),
      }),
    );
  });

  const guarded = Effect.uninterruptible(guard.withPermitsIfAvailable(1)(tick)).pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);
      return log.error(`dispatch failed: ${Render.errorDetail(error)}`, {
        ...processAttr,
        cause: error,
      });
    }),
    Effect.asVoid,
  );

  yield* guarded.pipe(Effect.repeat(Schedule.spaced(DISPATCH_INTERVAL)));
}).pipe(Effect.withSpan("Dispatcher.loop"));
