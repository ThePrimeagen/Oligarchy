import * as Sentry from "@sentry/bun";
import * as Dsn from "./dsn.ts";

// Loaded by the instrumented executables' wrappers (`--preload`) before any Effect code runs.
Sentry.init({
  dsn: Dsn.SENTRY_DSN,
  tracesSampleRate: 1,
  traceLifecycle: "stream",
  integrations: [
    Sentry.httpIntegration({ spans: false }),
    Sentry.nativeNodeFetchIntegration({ spans: false }),
  ],
});
