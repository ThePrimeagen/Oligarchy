import type * as Types from "./types.ts";

// Where a send lands: on a span, on a job's trace, or on neither.
export type Where<S> =
  | { readonly kind: "span"; readonly span: S }
  | { readonly kind: "job"; readonly jobId: string }
  | { readonly kind: "none" };

// What the tree drives: the SDK, or the fake's recorder. S is its handle on one open span, and
// undefined where it could not open one.
export type Sink<S> = {
  // Resolves once the send has settled, however it went.
  readonly capture: (error: unknown, report: Types.Report, where: Where<S>) => Promise<void>;
  readonly root: (
    name: string,
    options: Types.TraceOptions & { readonly jobId: string },
  ) => S | undefined;
  readonly child: (parent: S, name: string, options: Types.TraceOptions) => S | undefined;
  readonly set: (span: S, attributes: Types.Attributes) => void;
  readonly end: (span: S, status: Types.SpanStatus) => void;
};

// Telemetry never breaks its caller: whatever a sink throws stops here.
const quietly = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

const capture = <S>(
  sink: Sink<S>,
  error: unknown,
  report: Types.Report,
  where: Where<S>,
): Promise<void> =>
  quietly(() => sink.capture(error, report, where).catch(() => undefined), Promise.resolve());

const failed = (options: { readonly level?: Types.Level }): Types.Report => ({
  level: options.level ?? "error",
});

// A span with nothing behind it: one opened under an ended span, or one the sink could not open.
// It opens no spans and ends nothing, and what is sent through it lands where it would have.
const dead = <S>(sink: Sink<S>, where: Where<S>): Types.Span => {
  const self: Types.Span = {
    send: (error, report) => {
      void capture(sink, error, report, where);
    },
    sendWait: (error, report) => capture(sink, error, report, where),
    trace: () => self,
    set: () => undefined,
    end: () => undefined,
    fail: (error, options = {}) => {
      void capture(sink, error, failed(options), where);
    },
  };
  return self;
};

type Abort = () => void;

const live = <S>(sink: Sink<S>, handle: S, siblings: Set<Abort> | undefined): Types.Span => {
  const where: Where<S> = { kind: "span", span: handle };
  const open = new Set<Abort>();
  let ended = false;

  const finish = (status: Types.SpanStatus, byParent: boolean) => {
    if (ended) {
      return;
    }
    ended = true;
    for (const child of [...open].reverse()) {
      child();
    }
    siblings?.delete(abort);
    if (byParent) {
      quietly(() => sink.set(handle, { ended_by_parent: true }), undefined);
    }
    quietly(() => sink.end(handle, status), undefined);
  };
  const abort: Abort = () => finish("aborted", true);
  siblings?.add(abort);

  return {
    send: (error, report) => {
      void capture(sink, error, report, where);
    },
    sendWait: (error, report) => capture(sink, error, report, where),
    trace: (name, options) => {
      if (ended) {
        return dead(sink, where);
      }
      const child = quietly(() => sink.child(handle, name, options), undefined);
      return child === undefined ? dead(sink, where) : live(sink, child, open);
    },
    set: (attributes) => {
      if (!ended) {
        quietly(() => sink.set(handle, attributes), undefined);
      }
    },
    end: (status) => finish(status, false),
    fail: (error, options = {}) => {
      void capture(sink, error, failed(options), where);
      finish(options.status ?? "internal_error", false);
    },
  };
};

const split = <S>(report: Types.JobReport): [Types.Report, Where<S>] => {
  const { jobId, ...rest } = report;
  return [rest, jobId === undefined ? { kind: "none" } : { kind: "job", jobId }];
};

// The service's own calls; its service name and wait are the caller's.
export const reporter = <S>(sink: Sink<S>): Pick<Types.Sentry, "send" | "sendWait" | "trace"> => ({
  send: (error, report) => {
    void capture(sink, error, ...split<S>(report));
  },
  sendWait: (error, report) => capture(sink, error, ...split<S>(report)),
  trace: (name, options) => {
    const handle = quietly(() => sink.root(name, options), undefined);
    return handle === undefined
      ? dead(sink, { kind: "job", jobId: options.jobId })
      : live(sink, handle, undefined);
  },
});
