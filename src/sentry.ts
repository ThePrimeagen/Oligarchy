// Sentry for the proxy. Init reads SENTRY_DSN; with no DSN every call is a
// no-op so a local boot does not need a project. capture() is what log()
// calls for error and fatal (and for the log-insert failure that cannot
// go through log() again). flush() is for the process.exit paths so the
// last event is not dropped.

import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

export function initSentry(): void {
  if (dsn === undefined || dsn === "") {
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT,
  });
}

export function capture(ctx: {
  text: string;
  level: "warning" | "error" | "fatal";
  sessionId?: string;
  agentId?: string;
  cause?: unknown;
}): void {
  if (dsn === undefined || dsn === "") {
    return;
  }
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
  if (dsn === undefined || dsn === "") {
    return Promise.resolve();
  }
  // Two seconds: a stalled ingest must not hold the exit.
  return Sentry.flush(2_000).then(() => undefined);
}
