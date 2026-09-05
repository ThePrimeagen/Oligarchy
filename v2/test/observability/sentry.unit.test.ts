import * as SentryNode from "@sentry/node";
import { afterEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, ErrorReporter, Exit, Layer, Schema } from "effect";
import { HttpClient, HttpMiddleware, HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import * as Sentry from "../../src/observability/sentry.ts";
import * as Errors from "../../src/shared/errors.ts";

const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";
const AGENT_ID = "OLI-61";

const StreamedSpan = Schema.Struct({
  name: Schema.String,
  status: Schema.String,
  is_segment: Schema.Boolean,
  span_id: Schema.String,
  trace_id: Schema.String,
  parent_span_id: Schema.optionalKey(Schema.String),
  start_timestamp: Schema.Number,
  end_timestamp: Schema.Number,
  attributes: Schema.Record(
    Schema.String,
    Schema.Struct({ value: Schema.Json, type: Schema.String }),
  ),
});
type StreamedSpan = typeof StreamedSpan.Type;

const SpanItem = Schema.Struct({ items: Schema.Array(StreamedSpan) });

const EventItem = Schema.Struct({
  level: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  extra: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  exception: Schema.optionalKey(
    Schema.Struct({
      values: Schema.Array(
        Schema.Struct({
          type: Schema.optionalKey(Schema.String),
          value: Schema.optionalKey(Schema.String),
        }),
      ),
    }),
  ),
});
type EventItem = typeof EventItem.Type;

const ItemHeader = Schema.Struct({ type: Schema.String });

const decodeSpanItem = Schema.decodeUnknownSync(Schema.fromJsonString(SpanItem));
const decodeEventItem = Schema.decodeUnknownSync(Schema.fromJsonString(EventItem));
const decodeItemHeader = Schema.decodeUnknownSync(Schema.fromJsonString(ItemHeader));

type Captured = {
  readonly spans: Effect.Effect<ReadonlyArray<StreamedSpan>>;
  readonly events: Effect.Effect<ReadonlyArray<EventItem>>;
};

const capture = (): Captured => {
  const bodies: Array<string> = [];
  SentryNode.init({
    dsn: "https://public@example.com/1",
    tracesSampleRate: 1,
    traceLifecycle: "stream",
    defaultIntegrations: false,
    transport: (options) =>
      SentryNode.createTransport(options, (request) => {
        bodies.push(
          typeof request.body === "string" ? request.body : new TextDecoder().decode(request.body),
        );
        return Promise.resolve({ statusCode: 200 });
      }),
  });
  const items = (type: string): ReadonlyArray<string> =>
    bodies.flatMap((body) => {
      const lines = body.split("\n");
      const out: Array<string> = [];
      for (let index = 1; index + 1 < lines.length; index += 2) {
        if (decodeItemHeader(lines[index]).type === type) {
          out.push(lines[index + 1] ?? "");
        }
      }
      return out;
    });
  const flush = Effect.promise(() => SentryNode.flush(1_000));
  return {
    spans: Effect.map(flush, () => items("span").flatMap((item) => decodeSpanItem(item).items)),
    events: Effect.map(flush, () => items("event").map((item) => decodeEventItem(item))),
  };
};

afterEach(() => SentryNode.close(1_000));

const attribute = (span: StreamedSpan | undefined, key: string): unknown =>
  span?.attributes[key]?.value;

const find = (spans: ReadonlyArray<StreamedSpan>, name: string): StreamedSpan | undefined =>
  spans.find((span) => span.name === name);

describe("QEMU spans happy path", () => {
  it.live("streams a timed action while its successful session is still running", () =>
    Effect.gen(function* () {
      const captured = capture();
      const session = yield* Sentry.sessionSpan(SESSION_ID, AGENT_ID);
      yield* Effect.void.pipe(Sentry.withActionSpan(session, "send-key", SESSION_ID, AGENT_ID));

      const [actionItem] = yield* captured.spans;
      expect(actionItem?.name).toBe("QMP send-key");
      expect(actionItem?.is_segment).toBe(false);
      expect(actionItem?.status).toBe("ok");
      expect(attribute(actionItem, "sentry.op")).toBe("qemu.action");
      expect(attribute(actionItem, "session_id")).toBe(SESSION_ID);
      expect(attribute(actionItem, "agent_id")).toBe(AGENT_ID);
      expect(attribute(actionItem, "qemu.command")).toBe("send-key");
      expect(attribute(actionItem, "action_state")).toBe("completed");
      expect((actionItem?.end_timestamp ?? 0) >= (actionItem?.start_timestamp ?? 1)).toBe(true);

      yield* Sentry.endSessionSpan(session, "succeeded");
      const spans = yield* captured.spans;
      expect(spans).toHaveLength(2);
      const sessionItem = spans.find((span) => span.is_segment);
      expect(sessionItem?.name).toBe("QEMU session");
      expect(sessionItem?.status).toBe("ok");
      expect(attribute(sessionItem, "sentry.op")).toBe("qemu.session");
      expect(attribute(sessionItem, "session_id")).toBe(SESSION_ID);
      expect(attribute(sessionItem, "agent_id")).toBe(AGENT_ID);
      expect(attribute(sessionItem, "session_status")).toBe("succeeded");
      expect(actionItem?.parent_span_id).toBe(sessionItem?.span_id);
      expect(actionItem?.trace_id).toBe(sessionItem?.trace_id);
    }).pipe(Effect.provide(Sentry.SentryLive)),
  );

  it.live("nests an intent under the session and an action under the intent", () =>
    Effect.gen(function* () {
      const captured = capture();
      const session = yield* Sentry.sessionSpan(SESSION_ID, AGENT_ID);
      const intent = yield* Sentry.intentSpan(
        session,
        SESSION_ID,
        AGENT_ID,
        "result-1",
        "open a terminal",
      );
      yield* Sentry.annotateImageUrl("https://oligarchy.trm.sh/images/x").pipe(
        Sentry.withActionSpan(intent, "screendump", SESSION_ID, AGENT_ID),
      );
      yield* Sentry.endIntentSpan(intent, "completed");
      yield* Sentry.endSessionSpan(session, "succeeded");

      const spans = yield* captured.spans;
      const sessionItem = find(spans, "QEMU session");
      const intentItem = find(spans, "open a terminal");
      const actionItem = find(spans, "QMP screendump");
      expect(intentItem?.parent_span_id).toBe(sessionItem?.span_id);
      expect(intentItem?.status).toBe("ok");
      expect(attribute(intentItem, "sentry.op")).toBe("agent.intent");
      expect(attribute(intentItem, "test_result_id")).toBe("result-1");
      expect(attribute(intentItem, "intent")).toBe("open a terminal");
      expect(attribute(intentItem, "intent_state")).toBe("completed");
      expect(actionItem?.parent_span_id).toBe(intentItem?.span_id);
      expect(attribute(actionItem, "image_url")).toBe("https://oligarchy.trm.sh/images/x");
    }).pipe(Effect.provide(Sentry.SentryLive)),
  );
});

describe("QEMU spans unhappy path", () => {
  it.live("marks a failed action without failing a successful session", () =>
    Effect.gen(function* () {
      const captured = capture();
      const session = yield* Sentry.sessionSpan(SESSION_ID, AGENT_ID);
      const failure = yield* Effect.flip(
        Effect.fail(Errors.QmpTimeout.make({ command: "screendump" })).pipe(
          Sentry.withActionSpan(session, "screendump", SESSION_ID, AGENT_ID),
        ),
      );
      expect(failure._tag).toBe("QmpTimeout");
      yield* Sentry.endSessionSpan(session, "succeeded");

      const spans = yield* captured.spans;
      const actionItem = spans.find((span) => !span.is_segment);
      const sessionItem = spans.find((span) => span.is_segment);
      expect(sessionItem?.status).toBe("ok");
      expect(actionItem?.status).toBe("error");
      expect(attribute(actionItem, "action_state")).toBe("failed");
    }).pipe(Effect.provide(Sentry.SentryLive)),
  );

  it.live("marks a failed session as internal_error", () =>
    Effect.gen(function* () {
      const captured = capture();
      const session = yield* Sentry.sessionSpan(SESSION_ID, AGENT_ID);
      yield* Sentry.endSessionSpan(session, "failed");
      const spans = yield* captured.spans;
      expect(spans).toHaveLength(1);
      expect(spans[0]?.status).toBe("error");
      expect(attribute(spans[0], "session_status")).toBe("failed");
      expect(attribute(spans[0], "sentry.status.message")).toBe("internal_error");
    }).pipe(Effect.provide(Sentry.SentryLive)),
  );

  it.live("marks an aborted session as aborted", () =>
    Effect.gen(function* () {
      const captured = capture();
      const session = yield* Sentry.sessionSpan(SESSION_ID, AGENT_ID);
      yield* Sentry.endSessionSpan(session, "aborted");
      const spans = yield* captured.spans;
      expect(spans[0]?.status).toBe("error");
      expect(attribute(spans[0], "session_status")).toBe("aborted");
      expect(attribute(spans[0], "sentry.status.message")).toBe("aborted");
    }).pipe(Effect.provide(Sentry.SentryLive)),
  );

  it.live("marks a timed-out session as deadline_exceeded", () =>
    Effect.gen(function* () {
      const captured = capture();
      const session = yield* Sentry.sessionSpan(SESSION_ID, AGENT_ID);
      yield* Sentry.endSessionSpan(session, "timed_out");
      const spans = yield* captured.spans;
      expect(spans[0]?.status).toBe("error");
      expect(attribute(spans[0], "session_status")).toBe("timed_out");
      expect(attribute(spans[0], "sentry.status.message")).toBe("deadline_exceeded");
    }).pipe(Effect.provide(Sentry.SentryLive)),
  );

  it.live("a cancelled intent reads aborted, because Sentry maps cancelled to ok", () =>
    Effect.gen(function* () {
      const captured = capture();
      const session = yield* Sentry.sessionSpan(SESSION_ID, AGENT_ID);
      const intent = yield* Sentry.intentSpan(
        session,
        SESSION_ID,
        AGENT_ID,
        "result-1",
        "type hello",
      );
      yield* Sentry.endIntentSpan(intent, "cancelled");
      yield* Sentry.endSessionSpan(session, "aborted");
      const spans = yield* captured.spans;
      const intentItem = find(spans, "type hello");
      expect(intentItem?.status).toBe("error");
      expect(attribute(intentItem, "intent_state")).toBe("cancelled");
      expect(attribute(intentItem, "sentry.status.message")).toBe("aborted");
    }).pipe(Effect.provide(Sentry.SentryLive)),
  );

  it("statusExit maps every end status", () => {
    expect(Sentry.statusExit("succeeded")).toEqual(Exit.void);
    expect(Sentry.statusExit("timed_out")).toEqual(Exit.fail("deadline_exceeded"));
    expect(Sentry.statusExit("aborted")).toEqual(Exit.fail("aborted"));
    expect(Sentry.statusExit("failed")).toEqual(Exit.fail("internal_error"));
  });
});

describe("only the named spans reach Sentry", () => {
  it.live("an Effect.fn span and a plain withSpan are not exported", () =>
    Effect.gen(function* () {
      const captured = capture();
      const traced = Effect.fn("db.insertLog")(function* () {
        yield* Effect.void;
      });
      yield* traced();
      yield* Effect.void.pipe(Effect.withSpan("Sessions.start"));
      const session = yield* Sentry.sessionSpan(SESSION_ID, AGENT_ID);
      yield* traced().pipe(Sentry.withActionSpan(session, "send-key", SESSION_ID, AGENT_ID));
      yield* Sentry.endSessionSpan(session, "succeeded");
      const spans = yield* captured.spans;
      expect(spans.map((span) => span.name).sort()).toEqual(["QEMU session", "QMP send-key"]);
    }).pipe(Effect.provide(Sentry.SentryLive)),
  );

  it.live("a request served with TracerDisabledWhen exports no http.server span", () =>
    Effect.gen(function* () {
      const captured = capture();
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.get("/ping");
      expect(yield* response.text).toBe("ok");
      const spans = yield* captured.spans;
      expect(spans).toEqual([]);
    }).pipe(
      Effect.provide(
        HttpRouter.serve(HttpRouter.add("GET", "/ping", HttpServerResponse.text("ok")), {
          disableLogger: true,
          disableListenLog: true,
        }).pipe(
          Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen)(() => true)),
          Layer.provideMerge(NodeHttpServer.layerTest),
          Layer.provideMerge(Sentry.SentryLive),
        ),
      ),
    ),
  );
});

describe("reporter", () => {
  const severe = (message: string, severity: string): Error =>
    Object.assign(new Error(message), { [ErrorReporter.severity]: severity });

  it.live("maps Warn to warning, Fatal to fatal and anything else to error", () =>
    Effect.gen(function* () {
      const captured = capture();
      yield* ErrorReporter.report(Cause.fail(severe("warn me", "Warn")));
      yield* ErrorReporter.report(Cause.fail(severe("fatal me", "Fatal")));
      yield* ErrorReporter.report(Cause.fail(new Error("plain")));
      yield* ErrorReporter.report(Cause.die(new Error("defect")));
      const events = yield* captured.events;
      const byMessage = new Map(
        events.map((event) => [event.exception?.values[0]?.value, event.level] as const),
      );
      expect(byMessage.get("warn me")).toBe("warning");
      expect(byMessage.get("fatal me")).toBe("fatal");
      expect(byMessage.get("plain")).toBe("error");
      expect(byMessage.get("defect")).toBe("error");
    }).pipe(Effect.provide(Sentry.SentryLive)),
  );

  it.live("tags the event with the log annotations and carries the attributes", () =>
    Effect.gen(function* () {
      const captured = capture();
      yield* ErrorReporter.report(
        Cause.fail(Errors.QemuStartError.make({ message: "qemu: handshake timeout" })),
      ).pipe(Effect.annotateLogs({ session_id: SESSION_ID, agent_id: AGENT_ID, log: "starting" }));
      const events = yield* captured.events;
      expect(events).toHaveLength(1);
      expect(events[0]?.tags).toEqual({ session_id: SESSION_ID, agent_id: AGENT_ID });
      expect(events[0]?.extra).toEqual({
        session_id: SESSION_ID,
        agent_id: AGENT_ID,
        log: "starting",
      });
      expect(events[0]?.exception?.values[0]?.value).toBe("qemu: handshake timeout");
    }).pipe(Effect.provide(Sentry.SentryLive)),
  );

  it.live("ignores an error carrying [ErrorReporter.ignore]", () =>
    Effect.gen(function* () {
      const captured = capture();
      yield* ErrorReporter.report(Cause.fail(Errors.BadRequest.make({ message: "nope" })));
      yield* ErrorReporter.report(Cause.fail(Errors.unknownSession("x")));
      yield* ErrorReporter.report(Cause.interrupt());
      const events = yield* captured.events;
      expect(events).toEqual([]);
    }).pipe(Effect.provide(Sentry.SentryLive)),
  );

  it("exposes the reporter the layer installs", () => {
    expect(ErrorReporter.TypeId in Sentry.reporter).toBe(true);
  });
});
