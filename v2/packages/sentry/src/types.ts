export type Level = "warning" | "error" | "fatal";

export type SpanStatus = "ok" | "aborted" | "internal_error" | "deadline_exceeded";

export type Attributes = Readonly<Record<string, string | number | boolean>>;

export type Report = {
  readonly level: Level;
  readonly tags?: Readonly<Record<string, string>>;
  readonly extra?: Readonly<Record<string, unknown>>;
  // Sentry groups the error by these values instead of its stack.
  readonly fingerprint?: ReadonlyArray<string>;
};

// A report the service sends: with jobId it lands on that job's trace, from any process.
export type JobReport = Report & { readonly jobId?: string };

export type TraceOptions = { readonly op: string; readonly attributes?: Attributes };

// What every span has: send through it, or open a span under it.
export type Reporter = {
  readonly send: (error: unknown, report: Report) => void;
  // Resolves once this send has settled, however it went. Never rejects.
  readonly sendWait: (error: unknown, report: Report) => Promise<void>;
  readonly trace: (name: string, options: TraceOptions) => Span;
};

export type Span = Reporter & {
  readonly set: (attributes: Attributes) => void;
  // Every span still open under this one ends first, newest first, as aborted. Only the first
  // end counts.
  readonly end: (status: SpanStatus) => void;
  // send, then end: status defaults to internal_error, level to error.
  readonly fail: (
    error: unknown,
    options?: { readonly level?: Level; readonly status?: Exclude<SpanStatus, "ok"> },
  ) => void;
};

export type Sentry = {
  readonly service: "sentry";
  readonly send: (error: unknown, report: JobReport) => void;
  readonly sendWait: (error: unknown, report: JobReport) => Promise<void>;
  // A job's root span. Its trace id is the job id without its dashes.
  readonly trace: (name: string, options: TraceOptions & { readonly jobId: string }) => Span;
  // Resolves once every send has settled and every ended span has been sent. Never rejects.
  readonly wait: () => Promise<void>;
};
