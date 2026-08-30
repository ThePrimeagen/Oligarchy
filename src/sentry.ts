// Sentry for the proxy. The DSN is the Cloudflare project's — this process
// is Node (QEMU cannot run on a worker), so the SDK is @sentry/node, and
// Effect's respond middleware plus log() decide what is an event: 5xx and
// operational failures, not 4xx. capture() is what log() calls for error
// and fatal (and for the log-insert failure that cannot go through log()
// again). flush() is for the process.exit paths so the last event is not
// dropped.

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
