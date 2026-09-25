import {
  Cause,
  Clock,
  Console,
  Context,
  Deferred,
  Effect,
  ErrorReporter,
  Layer,
  Queue,
  Scope,
} from "effect";
import * as Logs from "../db/logs.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Errors from "../shared/errors.ts";
import type * as Domain from "../shared/domain.ts";
import * as Palette from "./palette.ts";
import * as Render from "./render.ts";

// location is a text bucket: a session UUID, Locations.server, Locations.automation, or
// Locations.automationClient.
export type Attribution = { readonly location?: string; readonly agentId?: string };
export type Report = Attribution & { readonly cause?: unknown; readonly skipSentry?: true };

export const Locations = {
  automation: "automation",
  automationClient: "automation-client",
  server: "server",
} as const;

// The automation server logs with agentId === Locations.automation as well.
export const AutomationAgentId = Locations.automation;
export const AutomationClientAgentId = Locations.automationClient;

// Fallback attribution when a log line has no session: qemu-server-wide "server", or automation's
// own bucket. Processes override this Reference at the top of their layer graph.
export type ProcessAttribution = {
  readonly location: string;
  readonly agentId?: string;
};

export const ProcessAttribution = Context.Reference<ProcessAttribution>(
  "@oligarchy/observability/log/ProcessAttribution",
  { defaultValue: () => ({ location: Locations.server }) },
);

export const AutomationProcessAttribution: ProcessAttribution = {
  location: Locations.automation,
  agentId: AutomationAgentId,
};

export const AutomationClientProcessAttribution: ProcessAttribution = {
  location: Locations.automationClient,
  agentId: AutomationClientAgentId,
};

export type LogService = {
  readonly info: (text: string, attribution?: Attribution) => Effect.Effect<void>;
  readonly warning: (text: string, attribution?: Attribution) => Effect.Effect<void>;
  readonly error: (text: string, report?: Report) => Effect.Effect<void>;
  readonly fatal: (text: string, report?: Report) => Effect.Effect<void>;
  // Resolves when every offered row has been inserted or its failure reported.
  readonly flush: Effect.Effect<void>;
};

// Whether stdout lines carry colour; tests override it, the process decides it once.
export const Colors = Context.Reference<boolean>("@oligarchy/observability/log/Colors", {
  defaultValue: () => Render.stdoutColors,
});

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
    attribution.location === undefined ? undefined : { location: attribution.location },
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
    let palette = Palette.empty;

    const write = (line: Render.LogLine) => Console.log(Render.renderLogLine(line, colors));

    const { offer, flush } = yield* sink(write, reportCause);

    const emit = (
      level: Domain.LogLevel,
      text: string,
      attribution: Attribution,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        let color: string | undefined;
        if (attribution.agentId !== undefined) {
          const touched = Palette.touch(
            palette,
            attribution.agentId,
            yield* Clock.currentTimeMillis,
          );
          palette = touched.palette;
          color = touched.color;
        }
        yield* write(
          Object.assign(
            { text, level },
            attribution.location === undefined ? undefined : { location: attribution.location },
            attribution.agentId === undefined ? undefined : { agentId: attribution.agentId },
            color === undefined ? undefined : { color },
          ),
        );
        offer({
          text,
          level,
          location: attribution.location ?? null,
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
          // The line carries the level to the reporter; a bare cause would report as `error`.
          const line =
            report.cause === undefined
              ? Errors.LogLine.make({ text, level })
              : Errors.LogLine.make({ text, level, cause: report.cause });
          yield* reportCause(Cause.fail(line)).pipe(Effect.annotateLogs(annotations(text, report)));
        });

    return {
      info: (text, attribution = {}) => emit("info", text, attribution),
      warning: (text, attribution = {}) => emit("warning", text, attribution),
      error: reported("error"),
      fatal: reported("fatal"),
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
  // stdout only, no rows: tests. The automation server persists through `layer` once it has a database.
  static readonly layerStdout: Layer.Layer<Log> = Layer.effect(this)(
    makeLog(() => Effect.succeed(stdoutOnly)),
  );
}
