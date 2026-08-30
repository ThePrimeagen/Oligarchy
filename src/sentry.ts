import * as Sentry from "@sentry/node";
import { SENTRY_DSN } from "./sentry-dsn.ts";

export function initSentry(): void {
  Sentry.init({
    dsn: SENTRY_DSN,
  });
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
