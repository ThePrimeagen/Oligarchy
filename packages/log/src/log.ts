import { Cause, Clock, Console, Context, Effect, ErrorReporter, Layer, type Scope } from "effect";
import type * as Domain from "@oligarchy/shared/domain";
import * as Errors from "./errors.ts";
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
  "@oligarchy/log/log/ProcessAttribution",
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

// Whether stdout lines carry colour. Off unless the process says otherwise: reading the tty is
// the entry's business, not this package's, so the entry provides what it decided.
export const Colors = Context.Reference<boolean>("@oligarchy/log/log/Colors", {
  defaultValue: () => false,
});

// The row a line is recorded as, for a sink that keeps rows.
export type LogRow = {
  readonly text: string;
  readonly level: Domain.LogLevel;
  readonly location: string | null;
  readonly agentId: string | null;
};

// Where lines go: a sink is offered each rendered line with its row, in call order, and owns
// every destination. `flush` resolves when everything offered so far has landed.
export type Sink = {
  readonly offer: (line: Render.Line, row: LogRow) => Effect.Effect<void>;
  readonly flush: Effect.Effect<void>;
};

// A sink is built once, from the two things it cannot make itself: `write` puts a rendered line
// on stdout and `report` reaches the reporters installed where the layer was built. So a sink
// can say `db: log insert failed` and report it without depending on the Log it is part of.
export type SinkFactory<R> = (
  write: (line: Render.Line) => Effect.Effect<void>,
  report: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
) => Effect.Effect<Sink, never, Scope.Scope | R>;

const annotations = (text: string, attribution: Attribution) =>
  Object.assign(
    {},
    attribution.location === undefined ? undefined : { location: attribution.location },
    attribution.agentId === undefined ? undefined : { agent_id: attribution.agentId },
    { log: text },
  );

const make = <R>(sink: SinkFactory<R>) =>
  Effect.gen(function* () {
    const colors = yield* Colors;
    // The reporters installed where the layer is built, so a line reports the same way from any fiber.
    const reporters = yield* ErrorReporter.CurrentErrorReporters;
    const reportCause = (cause: Cause.Cause<unknown>): Effect.Effect<void> =>
      ErrorReporter.report(cause).pipe(
        Effect.provideService(ErrorReporter.CurrentErrorReporters, reporters),
      );
    let palette = Palette.empty;

    const write = (line: Render.Line) => Console.log(Render.renderLogLine(line, colors));

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
        const line: Render.Line = Object.assign(
          { text, level },
          attribution.location === undefined ? undefined : { location: attribution.location },
          attribution.agentId === undefined ? undefined : { agentId: attribution.agentId },
          color === undefined ? undefined : { color },
        );
        yield* offer(line, {
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
      info: (text: string, attribution: Attribution = {}) => emit("info", text, attribution),
      warning: (text: string, attribution: Attribution = {}) => emit("warning", text, attribution),
      error: reported("error"),
      fatal: reported("fatal"),
      // Resolves when every line offered so far has landed where the sink puts it.
      flush,
    };
  });

export class Log extends Context.Service<Log>()("@oligarchy/log/Log", { make }) {
  static readonly layer = <R>(sink: SinkFactory<R>): Layer.Layer<Log, never, R> =>
    Layer.effect(this)(this.make(sink));
  // stdout alone: each line is written as it is offered, and there is nothing to wait for.
  static readonly layerStdout: Layer.Layer<Log> = this.layer((write) =>
    Effect.succeed({ offer: (line) => write(line), flush: Effect.void }),
  );
}
