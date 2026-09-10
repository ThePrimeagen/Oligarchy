import { Cause, Clock, Context, Effect, Exit, Layer, Ref, Scope } from "effect";
import { HttpServerError } from "effect/unstable/http";
import * as Stats from "../host/stats.ts";
import * as Log from "../observability/log.ts";
import * as Render from "../observability/render.ts";
import * as Contract from "../shared/contract.ts";
import * as Errors from "../shared/errors.ts";
import * as Runner from "./runner.ts";

// Two hours: far above any run still doing work (a driven session times out after ten idle
// minutes on the qemu server; a run is one session plus its review) and well short of forever,
// which is what a wedged agent otherwise costs the slot it holds.
const RUN_TIMEOUT = "2 hours";

type LiveRun = {
  readonly id: string;
  readonly key: string;
  readonly startedAt: number;
  readonly scope: Scope.Closeable;
};

export type AutomationStats = {
  readonly agents: number;
  readonly memory: Contract.Memory;
  readonly cpu: Contract.Cpu;
};

export type RunsService = {
  readonly run: (
    body: Contract.RunBody,
  ) => Effect.Effect<Contract.RunResponse, Errors.RunFailed | Errors.RunTimedOut>;
  readonly stats: Effect.Effect<AutomationStats>;
};

const isClientAbort = (cause: Cause.Cause<unknown>): boolean => {
  for (const reason of cause.reasons) {
    if (reason._tag === "Interrupt" && reason.annotations.has(HttpServerError.ClientAbort.key)) {
      return true;
    }
  }
  return false;
};

const make = Effect.gen(function* () {
  const runner = yield* Runner.AgentRunner;
  const stats = yield* Stats.Stats;
  const log = yield* Log.Log;
  const live = yield* Ref.make(new Map<string, LiveRun>());

  const run = Effect.fn("Runs.run")(function* (body: Contract.RunBody) {
    const attr = { location: Log.Locations.automationRun(body.key), agentId: body.key };
    // Acquire and release are uninterruptible: a caller that goes away between the first line and
    // the spawn still leaves no entry in the map, no scope and no colour behind.
    return yield* Effect.acquireUseRelease(
      Effect.gen(function* () {
        const id = crypto.randomUUID();
        const startedAt = yield* Clock.currentTimeMillis;
        const scope = yield* Scope.make();
        yield* Ref.update(live, (map) =>
          new Map(map).set(id, { id, key: body.key, startedAt, scope }),
        );
        yield* log.acquireColor(body.key);
        yield* log.info(`run started; ${runner.name}; ${String(body.prompt.length)} chars`, attr);
        return { id, startedAt, scope };
      }),
      ({ startedAt, scope }) =>
        Effect.gen(function* () {
          const outcome = yield* runner.run({ key: body.key, prompt: body.prompt }).pipe(
            Scope.provide(scope),
            Effect.timeoutOrElse({
              duration: RUN_TIMEOUT,
              orElse: () =>
                Errors.RunTimedOut.make({
                  message: `${runner.name}: no result within ${RUN_TIMEOUT}`,
                  agentId: body.key,
                }),
            }),
          );
          const ended = yield* Clock.currentTimeMillis;
          return Contract.RunResponse.make({
            model: runner.model,
            session: outcome.session,
            text: outcome.text,
            elapsedMs: ended - startedAt,
          });
        }),
      ({ id, startedAt, scope }, exit) =>
        Effect.gen(function* () {
          const rest = yield* Ref.modify(live, (map) => {
            const next = new Map(map);
            next.delete(id);
            return [next, next];
          });
          // Closing the scope kills a child still alive and removes its directory; a removal that
          // fails is one line, and the run is still over.
          yield* Scope.close(scope, Exit.void).pipe(
            Effect.catchCause((cause) => {
              const error = Cause.squash(cause);
              return log.error(`run cleanup failed: ${Render.errorDetail(error)}`, {
                ...attr,
                cause: error,
              });
            }),
          );
          // The colour belongs to the key: another run of the same ticket keeps it.
          if (![...rest.values()].some((other) => other.key === body.key)) {
            yield* log.releaseColor(body.key);
          }
          const elapsed = `${String((yield* Clock.currentTimeMillis) - startedAt)}ms`;
          if (Exit.isSuccess(exit)) {
            yield* log.info(
              `run finished; ${String(exit.value.text.length)} chars in ${elapsed}`,
              attr,
            );
          } else if (Cause.hasInterruptsOnly(exit.cause)) {
            yield* log.info(
              isClientAbort(exit.cause)
                ? `run aborted; client disconnected after ${elapsed}`
                : `run aborted; interrupted after ${elapsed}`,
              attr,
            );
          }
        }),
    );
  });

  return {
    run,
    stats: Effect.flatMap(Ref.get(live), (map) =>
      Effect.map(stats.collect, (host) => ({ agents: map.size, ...host })),
    ),
  } satisfies RunsService;
});

export class Runs extends Context.Service<Runs>()("@oligarchy/automation-client/Runs", { make }) {
  static readonly layer: Layer.Layer<Runs, never, Runner.AgentRunner | Stats.Stats | Log.Log> =
    Layer.effect(this)(this.make);
}
