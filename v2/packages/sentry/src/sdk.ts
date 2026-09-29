import * as Http from "@oligarchy/http";
import * as SentryBun from "@sentry/bun";
import * as jarl from "jarl";
import type * as Count from "./count.ts";
import type * as Tree from "./tree.ts";
import type * as Types from "./types.ts";

type MakeTransport = NonNullable<SentryBun.BunOptions["transport"]>;
type Transport = ReturnType<MakeTransport>;
type Envelope = Parameters<Transport["send"]>[0];
type Answer = Awaited<ReturnType<Transport["send"]>>;

export type Sdk = Tree.Sink<SentryBun.Span> & {
  // Asks the SDK to send what it holds, and settles what it dropped. Never rejects.
  readonly drain: () => Promise<void>;
};

// How long one drain waits for the SDK before the caller looks at the count again.
const FLUSH_MS = 1_000;

export const disabled: Sdk = {
  capture: () => Promise.resolve(),
  root: () => undefined,
  child: () => undefined,
  set: () => undefined,
  end: () => undefined,
  drain: () => Promise.resolve(),
};

// A UUID's 32 hex digits, the form of a trace id; anything else has none.
const traceIdOf = (jobId: string): string | undefined => {
  const hex = jobId.replaceAll("-", "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex) ? hex : undefined;
};

const contextOf = (report: Types.Report) => ({
  level: report.level,
  ...(report.tags === undefined ? {} : { tags: { ...report.tags } }),
  ...(report.extra === undefined ? {} : { extra: { ...report.extra } }),
  ...(report.fingerprint === undefined ? {} : { fingerprint: [...report.fingerprint] }),
});

const eventIdOf = (envelope: Envelope): string | undefined => {
  const headers: object = envelope[0];
  return "event_id" in headers && typeof headers.event_id === "string"
    ? headers.event_id
    : undefined;
};

const spanIdsOf = (envelope: Envelope): ReadonlyArray<string> => {
  const items: ReadonlyArray<readonly [{ readonly type: string }, unknown]> = envelope[1];
  return items.flatMap(([header, payload]) => {
    if (header.type !== "span" || typeof payload !== "object" || payload === null) {
      return [];
    }
    const batch: unknown = "items" in payload ? payload.items : undefined;
    return Array.isArray(batch)
      ? batch.flatMap((span: unknown) =>
          typeof span === "object" &&
          span !== null &&
          "span_id" in span &&
          typeof span.span_id === "string"
            ? [span.span_id]
            : [],
        )
      : [];
  });
};

const settleIfStill = (open: Map<string, () => void>, id: string, settle: () => void) => {
  if (open.get(id) === settle) {
    open.delete(id);
    settle();
  }
};

export const create = (options: {
  readonly dsn: string;
  readonly environment: string;
  readonly http: Http.Http;
  readonly count: Count.Count;
}): Sdk => {
  const { http, count } = options;
  // Errors from their capture until a request takes them, by event id.
  const events = new Map<string, () => void>();
  // Ended spans until a request takes them, by span id.
  const spans = new Map<string, () => void>();

  // One request settles everything it carries, however it went.
  const claim = (envelope: Envelope): (() => void) => {
    const taken: Array<() => void> = [];
    const take = (open: Map<string, () => void>, id: string) => {
      const settle = open.get(id);
      if (settle !== undefined) {
        open.delete(id);
        taken.push(settle);
      }
    };
    const event = eventIdOf(envelope);
    if (event !== undefined) {
      take(events, event);
    }
    for (const id of spanIdsOf(envelope)) {
      take(spans, id);
    }
    return () => {
      for (const settle of taken) {
        settle();
      }
    };
  };

  const post = async (url: string, body: string | Uint8Array): Promise<Answer> => {
    const answered = await http.fetch(
      url,
      { method: "POST", body },
      { decode: () => jarl.ok(undefined) },
    );
    if (jarl.is_ok(answered)) {
      return { statusCode: 200 };
    }
    const failure = answered.error;
    if (jarl.error.is(answered, Http.HttpInvalid)) {
      // A 2xx whose body was not JSON: stored all the same.
      return { statusCode: 200 };
    }
    if ("status" in failure) {
      return { statusCode: failure.status };
    }
    // No answer at all, which the SDK hears as a rejection.
    throw failure;
  };

  const transport: MakeTransport = (transportOptions) => {
    const base = SentryBun.createTransport(transportOptions, (request) =>
      post(transportOptions.url, request.body),
    );
    return {
      send: (envelope) => {
        const settle = claim(envelope);
        try {
          const sent = base.send(envelope);
          void sent.then(settle, settle);
          return sent;
        } catch {
          settle();
          return Promise.resolve({});
        }
      },
      flush: (timeout) => base.flush(timeout),
    };
  };

  try {
    SentryBun.init({
      dsn: options.dsn,
      environment: options.environment,
      tracesSampleRate: 1,
      traceLifecycle: "stream",
      // Every integration left out is one that could drop an error, or hand it to the transport
      // only after captureException returns, which capture below counts as dropped.
      defaultIntegrations: false,
      integrations: [SentryBun.linkedErrorsIntegration()],
      sendClientReports: false,
      transport,
    });
  } catch {
    return disabled;
  }

  return {
    capture: (error, report, where) => {
      const { settle, settled } = count.add();
      const id = crypto.randomUUID().replaceAll("-", "");
      events.set(id, settle);
      const hint = { event_id: id, captureContext: contextOf(report) };
      const traceId = where.kind === "job" ? traceIdOf(where.jobId) : undefined;
      try {
        if (where.kind === "span") {
          SentryBun.withActiveSpan(where.span, () => SentryBun.captureException(error, hint));
        } else if (traceId === undefined) {
          SentryBun.captureException(error, hint);
        } else {
          SentryBun.withScope((scope) => {
            scope.setPropagationContext({ traceId, sampleRand: Math.random() });
            SentryBun.captureException(error, hint);
          });
        }
      } catch {
        // The SDK threw before handing the error on; settled below with the ones it dropped.
      }
      // The SDK hands an error to the transport before captureException returns, so one no
      // request has taken by now was dropped.
      settleIfStill(events, id, settle);
      return settled;
    },
    root: (name, { op, jobId, attributes }) => {
      const traceId = traceIdOf(jobId);
      const start = () =>
        SentryBun.startInactiveSpan({
          name,
          op,
          attributes: { ...attributes, job_id: jobId },
          forceTransaction: true,
        });
      return SentryBun.withActiveSpan(null, () =>
        traceId === undefined
          ? start()
          : // A span takes a chosen trace id only from a parent, so the root names one derived
            // from the job that no span has.
            SentryBun.continueTrace(
              { sentryTrace: `${traceId}-${traceId.slice(0, 16)}-1`, baggage: undefined },
              start,
            ),
      );
    },
    child: (parent, name, { op, attributes }) =>
      SentryBun.startInactiveSpan({ name, op, attributes: { ...attributes }, parentSpan: parent }),
    set: (span, attributes) => {
      span.setAttributes({ ...attributes });
    },
    end: (span, status) => {
      const id = span.spanContext().spanId;
      const { settle } = count.add();
      spans.set(id, settle);
      try {
        span.setStatus(status === "ok" ? { code: 1 } : { code: 2, message: status });
        span.end();
      } catch {
        settleIfStill(spans, id, settle);
      }
    },
    drain: async () => {
      const unsent = [...spans];
      let drained = true;
      try {
        drained = await SentryBun.flush(FLUSH_MS);
      } catch {
        // A flush that throws has nothing more to send.
      }
      if (!drained) {
        return;
      }
      // The SDK holds nothing, so an ended span no request took was dropped.
      for (const [id, settle] of unsent) {
        settleIfStill(spans, id, settle);
      }
    },
  };
};
