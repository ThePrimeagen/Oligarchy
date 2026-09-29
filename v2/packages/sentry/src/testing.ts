// A fake service for tests: the same span tree as create makes, recording what it would send
// instead of sending it. Every send settles at once, so wait resolves at once.
import * as Tree from "./tree.ts";
import type * as Types from "./types.ts";

export type Sent = {
  readonly error: unknown;
  readonly report: Types.Report;
  readonly jobId: string | undefined;
};

export type Recorded = {
  readonly name: string;
  readonly op: string;
  readonly jobId: string;
  readonly attributes: Types.Attributes;
  // undefined while the span is open.
  readonly status: Types.SpanStatus | undefined;
  // What was sent through this span.
  readonly sent: ReadonlyArray<Sent>;
  readonly children: ReadonlyArray<Recorded>;
};

type Node = {
  readonly name: string;
  readonly op: string;
  readonly jobId: string;
  readonly attributes: Record<string, string | number | boolean>;
  status: Types.SpanStatus | undefined;
  readonly sent: Array<Sent>;
  readonly children: Array<Node>;
};

const node = (name: string, options: Types.TraceOptions, jobId: string): Node => ({
  name,
  op: options.op,
  jobId,
  attributes: { ...options.attributes },
  status: undefined,
  sent: [],
  children: [],
});

export const sentry = (): {
  readonly sentry: Types.Sentry;
  // Every root span, in the order they were opened.
  readonly roots: ReadonlyArray<Recorded>;
  // Everything sent, through a span or not, in the order it was sent.
  readonly sent: ReadonlyArray<Sent>;
  // Every span in the order it ended.
  readonly ended: ReadonlyArray<Recorded>;
} => {
  const roots: Array<Node> = [];
  const sent: Array<Sent> = [];
  const ended: Array<Node> = [];

  const sink: Tree.Sink<Node> = {
    capture: async (error, report, where) => {
      if (where.kind === "span") {
        const one: Sent = { error, report, jobId: where.span.jobId };
        where.span.sent.push(one);
        sent.push(one);
        return;
      }
      sent.push({ error, report, jobId: where.kind === "job" ? where.jobId : undefined });
    },
    root: (name, options) => {
      const root = node(name, options, options.jobId);
      roots.push(root);
      return root;
    },
    child: (parent, name, options) => {
      const child = node(name, options, parent.jobId);
      parent.children.push(child);
      return child;
    },
    set: (span, attributes) => {
      Object.assign(span.attributes, attributes);
    },
    end: (span, status) => {
      span.status = status;
      ended.push(span);
    },
  };

  return {
    sentry: { service: "sentry", ...Tree.reporter(sink), wait: () => Promise.resolve() },
    roots,
    sent,
    ended,
  };
};
