import { SentryEffectTracer } from "@sentry/effect";
import * as Sentry from "@sentry/node";
import {
  Clock,
  Context,
  Effect,
  ErrorReporter,
  Exit,
  Layer,
  LogLevel,
  Option,
  References,
  Schema,
  Tracer,
} from "effect";
import type * as Domain from "../shared/domain.ts";

// ---------------------------------------------------------------------------
// Reporter: error and fatal lines, defects and 5xx failures
// ---------------------------------------------------------------------------

// Effect defaults unannotated errors and defects to Info; anything reaching Sentry is a failure.
const sentryLevels: Record<LogLevel.Severity, Sentry.SeverityLevel> = {
  Fatal: "fatal",
  Error: "error",
  Warn: "warning",
  Info: "error",
  Debug: "error",
  Trace: "error",
};

const toSentryLevel = (severity: LogLevel.Severity): Sentry.SeverityLevel => sentryLevels[severity];

const stringValue = Schema.decodeUnknownOption(Schema.String);

const tag = (
  source: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, string>> | undefined =>
  Option.match(stringValue(source[key]), {
    onNone: () => undefined,
    onSome: (value) => ({ [key]: value }),
  });

export const reporter: ErrorReporter.ErrorReporter = ErrorReporter.make(
  ({ error, severity, attributes, fiber }) => {
    const annotations = fiber.getRef(References.CurrentLogAnnotations);
    const context = { ...annotations, ...attributes };
    Sentry.captureException(error, {
      level: toSentryLevel(severity),
      tags: Object.assign({}, tag(context, "session_id"), tag(context, "agent_id")),
      extra: context,
    });
  },
);

// ---------------------------------------------------------------------------
// Tracer: only the spans oligarchy names are exported
// ---------------------------------------------------------------------------

// `Effect.fn` and `Effect.withSpan` create spans everywhere; Sentry receives the QEMU session,
// intent and action spans alone, as it always has.
const Exported = Context.Reference<boolean>("@oligarchy/observability/sentry/Exported", {
  defaultValue: () => false,
});

const exported = Context.make(Exported, true);

const tracer = Tracer.make({
  span(options) {
    return Context.getOrElse(options.annotations, Exported, () => false)
      ? SentryEffectTracer.span(options)
      : new Tracer.NativeSpan(options);
  },
  context: SentryEffectTracer.context,
});

export const SentryLive: Layer.Layer<never> = Layer.mergeAll(
  Layer.succeed(Tracer.Tracer)(tracer),
  ErrorReporter.layer([reporter]),
  // Two seconds: a stalled ingest must not hold the exit.
  Layer.effectDiscard(
    Effect.addFinalizer(() => Effect.asVoid(Effect.promise(() => Sentry.flush(2_000)))),
  ),
);

// ---------------------------------------------------------------------------
// Spans
// ---------------------------------------------------------------------------

export const sessionSpan = (sessionId: string, agentId: string): Effect.Effect<Tracer.Span> =>
  Effect.makeSpan("QEMU session", {
    root: true,
    annotations: exported,
    attributes: { "sentry.op": "qemu.session", session_id: sessionId, agent_id: agentId },
  });

// The SentryEffectTracer turns String(error) into the span status message.
const statusExits: Record<Domain.SessionEndStatus, Exit.Exit<void, string>> = {
  succeeded: Exit.void,
  timed_out: Exit.fail("deadline_exceeded"),
  aborted: Exit.fail("aborted"),
  failed: Exit.fail("internal_error"),
};

export const statusExit = (status: Domain.SessionEndStatus): Exit.Exit<void, string> =>
  statusExits[status];

const endSpan = (span: Tracer.Span, exit: Exit.Exit<void, string>): Effect.Effect<void> =>
  Effect.map(Clock.currentTimeNanos, (now) => {
    span.end(now, exit);
  });

export const endSessionSpan = (
  span: Tracer.Span,
  status: Domain.SessionEndStatus,
): Effect.Effect<void> => {
  span.attribute("session_status", status);
  return endSpan(span, statusExit(status));
};

export const intentSpan = (
  parent: Tracer.Span,
  sessionId: string,
  agentId: string,
  testResultId: string,
  message: string,
): Effect.Effect<Tracer.Span> =>
  Effect.makeSpan(message, {
    parent,
    annotations: exported,
    attributes: {
      "sentry.op": "agent.intent",
      session_id: sessionId,
      agent_id: agentId,
      test_result_id: testResultId,
      intent: message,
    },
  });

export const endIntentSpan = (
  span: Tracer.Span,
  state: "completed" | "cancelled",
): Effect.Effect<void> => {
  span.attribute("intent_state", state);
  // Sentry maps status message "cancelled" to ok, hence "aborted".
  return endSpan(span, state === "completed" ? Exit.void : Exit.fail("aborted"));
};

export const withActionSpan =
  (parent: Tracer.Span, command: string, sessionId: string, agentId: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, Tracer.ParentSpan>> =>
    self.pipe(
      Effect.tap(() => Effect.annotateCurrentSpan("action_state", "completed")),
      Effect.tapError(() => Effect.annotateCurrentSpan("action_state", "failed")),
      Effect.withSpan(`QMP ${command}`, {
        parent,
        annotations: exported,
        attributes: {
          "sentry.op": "qemu.action",
          session_id: sessionId,
          agent_id: agentId,
          "qemu.command": command,
        },
      }),
    );

export const annotateImageUrl = (url: string): Effect.Effect<void> =>
  Effect.annotateCurrentSpan("image_url", url);
