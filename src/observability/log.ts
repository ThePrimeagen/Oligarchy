import { Cause, Deferred, Effect, type Layer, Queue } from "effect";
import * as Logs from "@oligarchy/db/logs";
import * as ExternalFailure from "@oligarchy/log/external-failure";
import * as Log from "@oligarchy/log/log";
import * as Render from "@oligarchy/log/render";

type Row = Parameters<typeof Logs.LogStore.Service.insertLog>[0];

type Work =
  | { readonly _tag: "Line"; readonly line: Render.Line; readonly row: Row }
  | { readonly _tag: "Marker"; readonly done: Deferred.Deferred<void> };

// The row is the record and stdout its convenience copy, so the copy follows the record: one
// fiber drains the queue, inserts each row, then writes its line, so lines land in call order. A
// refused row still writes its line, then names the failure and reports it to Sentry, and never
// fails the caller or the rows behind it. The queue is unbounded by policy: a log call never
// blocks or drops a row because the database is slow; a long outage costs memory, accepted.
const makeSink: Log.SinkFactory<Logs.LogStore> = (write, report) =>
  Effect.gen(function* () {
    const store = yield* Logs.LogStore;
    const queue = yield* Queue.unbounded<Work>();
    const failed = (cause: Cause.Cause<unknown>) =>
      Effect.gen(function* () {
        const detail = Render.errorDetail(ExternalFailure.causeOf(Cause.squash(cause)));
        yield* write({ text: `db: log insert failed: ${detail}`, level: "error" });
        yield* report(Cause.die(Cause.squash(cause)));
      });
    const drain = Effect.forever(
      Effect.gen(function* () {
        const work = yield* Queue.take(queue);
        if (work._tag === "Marker") {
          yield* Deferred.succeed(work.done, undefined);
          return;
        }
        yield* store.insertLog(work.row).pipe(
          Effect.matchCauseEffect({
            onFailure: (cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.interrupt
                : Effect.andThen(write(work.line), failed(cause)),
            onSuccess: () => write(work.line),
          }),
        );
      }),
    );
    yield* Effect.forkScoped(drain, { startImmediately: true });
    const flush = Effect.gen(function* () {
      const done = yield* Deferred.make<void>();
      Queue.offerUnsafe(queue, { _tag: "Marker", done });
      yield* Deferred.await(done);
    });
    // Registered after the fork so it runs before the drain fiber is interrupted.
    yield* Effect.addFinalizer(() => flush);
    return {
      offer: (line, row) =>
        Effect.sync(() => {
          Queue.offerUnsafe(queue, { _tag: "Line", line, row });
        }),
      flush,
    };
  });

// The Log every fleet process runs: every line a row, then its stdout copy.
export const layer: Layer.Layer<Log.Log, never, Logs.LogStore> = Log.Log.layer(makeSink);
