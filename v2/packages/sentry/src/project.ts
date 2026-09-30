// The one Sentry project every process reports to. The DSN is public by design: it can send
// events, not read them.
export const DSN =
  "https://8537fd5d18e270275f263f9af70f773f@o4510324148862976.ingest.us.sentry.io/4512001067581440";

// V1 never named an environment, so every event it sent is Sentry's default, production.
export const ENVIRONMENT = "production";
