import type * as Types from "./types.ts";

export type Sent = {
  readonly error: unknown;
  readonly report: Types.Report;
  readonly jobId: string | undefined;
};

export type Recorded = {
  readonly name: string;
  readonly op: string;
  readonly jobId: string | undefined;
  readonly attributes: Types.Attributes;
  readonly status: Types.SpanStatus | undefined;
  readonly sent: ReadonlyArray<Sent>;
  readonly children: ReadonlyArray<Recorded>;
};

export const sentry = (): {
  readonly sentry: Types.Sentry;
  readonly roots: ReadonlyArray<Recorded>;
  readonly sent: ReadonlyArray<Sent>;
  readonly ended: ReadonlyArray<Recorded>;
} => {
  throw new Error("not implemented");
};
