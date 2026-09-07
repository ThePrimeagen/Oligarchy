import { ErrorReporter, Layer, LogLevel, References } from "effect";

export type Reported = {
  readonly error: Error;
  readonly severity: LogLevel.Severity;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly annotations: Readonly<Record<string, unknown>>;
};

export type Collector = {
  readonly reported: Array<Reported>;
  readonly layer: Layer.Layer<never>;
};

// Collects every report the code under test forwards to the ErrorReporter, with the log
// annotations the Sentry reporter would turn into tags.
export const collect = (): Collector => {
  const reported: Array<Reported> = [];
  const reporter = ErrorReporter.make(({ error, severity, attributes, fiber }) => {
    reported.push({
      error,
      severity,
      attributes,
      annotations: fiber.getRef(References.CurrentLogAnnotations),
    });
  });
  return { reported, layer: ErrorReporter.layer([reporter]) };
};
