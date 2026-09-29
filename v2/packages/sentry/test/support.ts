import * as Async from "@oligarchy/async";
import * as Fake from "@oligarchy/http/testing";
import * as Sentry from "../src/main.ts";

export const DSN = "https://public@o1.ingest.example/42";
export const JOB_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";
export const TRACE_ID = "1baaad43674b4bdb88d73f18fce50aba";

// A service whose requests go to the fake instead of Sentry.
export const ingest = (
  replies: Parameters<typeof Fake.http>[0],
  options: { readonly timeoutMs?: number } = {},
) => {
  const fake = Fake.http(replies, options);
  const sentry = Sentry.create({ dsn: DSN, environment: "test", http: fake.http });
  return { sentry, asked: fake.asked };
};

// Whether promise settles within ms.
export const within = async (ms: number, promise: Promise<unknown>): Promise<boolean> => {
  const stop = new AbortController();
  const settled = await Promise.race([
    promise.then(() => true),
    Async.sleep(ms, stop.signal).then(() => false),
  ]);
  stop.abort();
  return settled;
};

// A promise the test settles when it chooses.
export const held = <T>() => {
  let release: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

type StreamedSpan = {
  readonly name: string;
  readonly span_id: string;
  readonly parent_span_id?: string;
  readonly trace_id: string;
  readonly status: string;
  readonly attributes: Readonly<Record<string, { readonly value: unknown }>>;
};

type ErrorEvent = {
  readonly event_id: string;
  readonly level: string;
  readonly exception: { readonly values: ReadonlyArray<{ readonly value: string }> };
  readonly contexts: { readonly trace: { readonly trace_id: string; readonly span_id: string } };
};

const text = (body: unknown): string => {
  if (typeof body === "string") {
    return body;
  }
  return body instanceof Uint8Array ? new TextDecoder().decode(body) : "";
};

// Every item of every envelope the fake was sent: its type and the line that carried it.
const items = (asked: ReadonlyArray<Fake.Asked>) =>
  asked.flatMap(({ body }) => {
    const lines = text(body).split("\n");
    const found: Array<{ readonly type: string; readonly line: string }> = [];
    for (let index = 1; index + 1 < lines.length; index += 2) {
      const header: { readonly type: string } = JSON.parse(lines[index] ?? "{}");
      found.push({ type: header.type, line: lines[index + 1] ?? "{}" });
    }
    return found;
  });

export const spans = (asked: ReadonlyArray<Fake.Asked>) =>
  items(asked).flatMap(({ type, line }) => {
    if (type !== "span") {
      return [];
    }
    const batch: { readonly items: ReadonlyArray<StreamedSpan> } = JSON.parse(line);
    return batch.items.map((span) => ({
      name: span.name,
      op: span.attributes["sentry.op"]?.value,
      spanId: span.span_id,
      parentId: span.parent_span_id,
      traceId: span.trace_id,
      status: span.status,
      message: span.attributes["sentry.status.message"]?.value,
      attribute: (key: string) => span.attributes[key]?.value,
    }));
  });

export const errors = (asked: ReadonlyArray<Fake.Asked>) =>
  items(asked).flatMap(({ type, line }) => {
    if (type !== "event") {
      return [];
    }
    const event: ErrorEvent = JSON.parse(line);
    return [
      {
        message: event.exception.values.at(-1)?.value,
        level: event.level,
        traceId: event.contexts.trace.trace_id,
        spanId: event.contexts.trace.span_id,
      },
    ];
  });
