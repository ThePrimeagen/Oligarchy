import * as Sentry from "@sentry/node";
import { SENTRY_DSN } from "./sentry-dsn.ts";

export function initSentry(): void {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 1,
    traceLifecycle: "stream",
    integrations: [
      Sentry.httpIntegration({ spans: false }),
      Sentry.nativeNodeFetchIntegration({ spans: false }),
    ],
  });
}

export type QemuSpan = Sentry.Span;

export function startQemuSpan(sessionId: string, agentId: string): QemuSpan {
  return Sentry.startInactiveSpan({
    name: "QEMU session",
    op: "qemu.session",
    parentSpan: null,
    attributes: {
      session_id: sessionId,
      agent_id: agentId,
    },
  });
}

export function finishQemuSpan(span: QemuSpan, status: SessionEndStatus): void {
  span.setAttribute("session_status", status);
  if (status === "succeeded") {
    span.setStatus({ code: 1 });
  } else if (status === "timed_out") {
    span.setStatus({ code: 2, message: "deadline_exceeded" });
  } else if (status === "aborted") {
    span.setStatus({ code: 2, message: "aborted" });
  } else {
    span.setStatus({ code: 2, message: "internal_error" });
  }
  span.end();
}

export function startQemuActionSpan(
  parentSpan: QemuSpan,
  sessionId: string,
  agentId: string,
  command: QemuCommand["execute"],
): QemuSpan {
  return Sentry.startInactiveSpan({
    name: `QMP ${command}`,
    op: "qemu.action",
    parentSpan,
    attributes: {
      session_id: sessionId,
      agent_id: agentId,
      "qemu.command": command,
    },
  });
}

export function finishQemuActionSpan(span: QemuSpan, state: QemuExchangeOutcome["state"]): void {
  span.setAttribute("action_state", state);
  span.setStatus(
    state === "completed"
      ? { code: 1 }
      : { code: 2, message: "internal_error" },
  );
  span.end();
}

export function startIntentSpan(
  parentSpan: QemuSpan,
  sessionId: string,
  agentId: string,
  testResultId: string,
  message: string,
): QemuSpan {
  return Sentry.startInactiveSpan({
    name: message,
    op: "agent.intent",
    parentSpan,
    attributes: {
      session_id: sessionId,
      agent_id: agentId,
      test_result_id: testResultId,
      intent: message,
    },
  });
}

export function finishIntentSpan(span: QemuSpan, status: "completed" | "cancelled"): void {
  span.setAttribute("intent_state", status);
  if (status === "completed") {
    span.setStatus({ code: 1 });
  } else {
    // Sentry maps status message "cancelled" to ok.
    span.setStatus({ code: 2, message: "aborted" });
  }
  span.end();
}

export function capture(ctx: {
  text: string;
  level: "warning" | "error" | "fatal";
  sessionId?: string;
  agentId?: string;
  cause?: unknown;
}): void {
  Sentry.withScope((scope) => {
    if (ctx.sessionId !== undefined) {
      scope.setTag("session_id", ctx.sessionId);
    }
    if (ctx.agentId !== undefined) {
      scope.setTag("agent_id", ctx.agentId);
    }
    scope.setExtra("log", ctx.text);
    scope.setLevel(ctx.level);
    if (ctx.cause !== undefined) {
      Sentry.captureException(ctx.cause);
    } else {
      Sentry.captureMessage(ctx.text);
    }
  });
}

export function flushSentry(): Promise<void> {
  // Two seconds: a stalled ingest must not hold the exit.
  return Sentry.flush(2_000).then(() => undefined);
}
