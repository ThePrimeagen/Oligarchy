import {
  Cause,
  Console,
  Context,
  Deferred,
  Effect,
  ErrorReporter,
  Layer,
  LogLevel,
  Queue,
  Schema,
  Scope,
} from "effect";
import * as Logs from "../db/logs.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Errors from "../shared/errors.ts";
import type * as Domain from "../shared/domain.ts";
import * as Render from "./render.ts";

export type Attribution = { readonly sessionId?: string; readonly agentId?: string };
export type Report = Attribution & { readonly cause?: unknown; readonly skipSentry?: true };

export type LogService = {
  readonly info: (text: string, attribution?: Attribution) => Effect.Effect<void>;
  readonly warning: (text: string, attribution?: Attribution) => Effect.Effect<void>;
  readonly error: (text: string, report?: Report) => Effect.Effect<void>;
  readonly fatal: (text: string, report?: Report) => Effect.Effect<void>;
  readonly acquireColor: (agentId: string) => Effect.Effect<void>;
  readonly releaseColor: (agentId: string) => Effect.Effect<void>;
  // Resolves when every offered row has been inserted or its failure reported.
  readonly flush: Effect.Effect<void>;
};

// Whether stdout lines carry colour; tests override it, the process decides it once.
export const Colors = Context.Reference<boolean>("@oligarchy/observability/log/Colors", {
  defaultValue: () => Render.stdoutColors,
});

// An error or fatal line reported without a cause: Sentry sees the text itself.
class LogLine extends Schema.TaggedError<LogLine>("@oligarchy/observability/log/LogLine")(
  "LogLine",
  {
    text: Schema.String,
    level: Schema.Literals(["error", "fatal"]),
  },
) {
  override get message(): string {
    return this.text;
  }
  override get [ErrorReporter.severity](): LogLevel.Severity {
    return this.level === "fatal" ? "Fatal" : "Error";
  }
}

type Row = Parameters<typeof Logs.LogStore.Service.insertLog>[0];

type Work =
  | { readonly _tag: "Row"; readonly row: Row }
  | { readonly _tag: "Marker"; readonly done: Deferred.Deferred<void> };

type Sink = {
  readonly offer: (row: Row) => void;
  readonly flush: Effect.Effect<void>;
};

const annotations = (text: string, attribution: Attribution): Record<string, unknown> =>
  Object.assign(
    {},
    attribution.sessionId === undefined ? undefined : { session_id: attribution.sessionId },
    attribution.agentId === undefined ? undefined : { agent_id: attribution.agentId },
    { log: text },
  );

// Rows are drained by one fiber so they land in call order; a failed insert prints itself and
// reports to Sentry but never fails the caller or the rows behind it.
const makeSink = (
  insert: (row: Row) => Effect.Effect<void, Errors.DatabaseError>,
  write: (line: Render.LogLine) => Effect.Effect<void>,
  report: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<Work>();
    const failed = (cause: Cause.Cause<Errors.DatabaseError>) =>
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
        yield* insert(work.row).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.interrupt : failed(cause),
          ),
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
      offer: (row) => {
        Queue.offerUnsafe(queue, { _tag: "Row", row });
      },
      flush,
    } satisfies Sink;
  });

const stdoutOnly: Sink = { offer: () => undefined, flush: Effect.void };

type ReportCause = (cause: Cause.Cause<unknown>) => Effect.Effect<void>;

const makeLog = (
  sink: (
    write: (line: Render.LogLine) => Effect.Effect<void>,
    report: ReportCause,
  ) => Effect.Effect<Sink, never, Scope.Scope>,
) =>
  Effect.gen(function* () {
    const colors = yield* Colors;
    // The reporters installed where the layer is built, so a line reports the same way from any fiber.
    const reporters = yield* ErrorReporter.CurrentErrorReporters;
    const reportCause: ReportCause = (cause) =>
      ErrorReporter.report(cause).pipe(
        Effect.provideService(ErrorReporter.CurrentErrorReporters, reporters),
      );
    const palette = new Map<string, string>();
    let next = 0;

    // A colour belongs to a live session: acquired when it is created, released when it ends. A
    // line for any other agent id (a refused start, a ctrl read) stays gray, as it always has.
    const acquireColor = (agentId: string): void => {
      if (palette.has(agentId)) {
        return;
      }
      const taken = new Set(palette.values());
      let pick = next;
      for (let offset = 0; offset < Render.AGENT_COLORS.length; offset++) {
        const index = (next + offset) % Render.AGENT_COLORS.length;
        if (!taken.has(Render.AGENT_COLORS[index])) {
          pick = index;
          break;
        }
      }
      palette.set(agentId, Render.AGENT_COLORS[pick]);
      next = (pick + 1) % Render.AGENT_COLORS.length;
    };

    const write = (line: Render.LogLine) => Console.log(Render.renderLogLine(line, colors));

    const { offer, flush } = yield* sink(write, reportCause);

    const emit = (
      level: Domain.LogLevel,
      text: string,
      attribution: Attribution,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const color =
          attribution.agentId === undefined ? undefined : palette.get(attribution.agentId);
        yield* write(
          Object.assign(
            { text, level },
            attribution.sessionId === undefined ? undefined : { sessionId: attribution.sessionId },
            attribution.agentId === undefined ? undefined : { agentId: attribution.agentId },
            color === undefined ? undefined : { color },
          ),
        );
        offer({
          text,
          level,
          sessionId: attribution.sessionId ?? null,
          agentId: attribution.agentId ?? null,
        });
      });

    const reported =
      (level: "error" | "fatal") =>
      (text: string, report: Report = {}) =>
        Effect.gen(function* () {
          yield* emit(level, text, report);
          if (report.skipSentry === true) {
            return;
          }
          const cause =
            report.cause === undefined
              ? Cause.fail(LogLine.make({ text, level }))
              : Cause.die(report.cause);
          yield* reportCause(cause).pipe(Effect.annotateLogs(annotations(text, report)));
        });

    return {
      info: (text, attribution = {}) => emit("info", text, attribution),
      warning: (text, attribution = {}) => emit("warning", text, attribution),
      error: reported("error"),
      fatal: reported("fatal"),
      acquireColor: (agentId) =>
        Effect.sync(() => {
          acquireColor(agentId);
        }),
      releaseColor: (agentId) =>
        Effect.sync(() => {
          palette.delete(agentId);
        }),
      flush,
    } satisfies LogService;
  });

export class Log extends Context.Service<Log>()("@oligarchy/observability/Log", {
  make: Effect.gen(function* () {
    const store = yield* Logs.LogStore;
    return yield* makeLog((write, report) => makeSink(store.insertLog, write, report));
  }),
}) {
  static readonly layer: Layer.Layer<Log, never, Logs.LogStore> = Layer.effect(this)(this.make);
  // stdout only, no rows: tests and the CLIs that have no database.
  static readonly layerStdout: Layer.Layer<Log> = Layer.effect(this)(
    makeLog(() => Effect.succeed(stdoutOnly)),
  );
}
