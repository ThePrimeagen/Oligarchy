import * as Sentry from "@sentry/node";
import * as Dsn from "./dsn.ts";

// Loaded by the instrumented executables' wrappers (`--import`) before any Effect code runs.
Sentry.init({
  dsn: Dsn.SENTRY_DSN,
  tracesSampleRate: 1,
  traceLifecycle: "stream",
  integrations: [
    Sentry.httpIntegration({ spans: false }),
    Sentry.nativeNodeFetchIntegration({ spans: false }),
  ],
});
