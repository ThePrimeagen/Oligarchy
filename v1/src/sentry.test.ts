import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, it } from "node:test";
import * as Sentry from "@sentry/node";
import {
  finishQemuActionSpan,
  finishQemuSpan,
  initSentry,
  startQemuActionSpan,
  startQemuSpan,
} from "./sentry.ts";

type StreamedSpan = {
  attributes: Record<string, { value: unknown; type: string }>;
  end_timestamp: number;
  is_segment: boolean;
  name: string;
  parent_span_id?: string;
  span_id: string;
  start_timestamp: number;
  status: string;
  trace_id: string;
};

function captureSpans(): { spans: () => Promise<StreamedSpan[]> } {
  const bodies: string[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1",
    tracesSampleRate: 1,
    traceLifecycle: "stream",
    defaultIntegrations: false,
    transport: (options) =>
      Sentry.createTransport(options, (request) => {
        bodies.push(
          typeof request.body === "string"
            ? request.body
            : new TextDecoder().decode(request.body),
        );
        return Promise.resolve({ statusCode: 200 });
      }),
  });
  return {
    spans: async () => {
      await Sentry.flush(1_000);
      return bodies.flatMap((body) => {
        const lines = body.split("\n");
        assert.equal(JSON.parse(lines[1]).type, "span");
        return (JSON.parse(lines[2]) as { items: StreamedSpan[] }).items;
      });
    },
  };
}

afterEach(async () => {
  await Sentry.close(1_000);
});

describe("initSentry", () => {
  it("does not trace proxy HTTP requests or fetches", async () => {
    initSentry();
    const client = Sentry.getClient();
    assert.ok(client !== undefined);
    Object.assign(client, {
      _transport: {
        send: async () => ({}),
        flush: async () => true,
      },
    });
    let started = 0;
    client.on("spanStart", () => {
      started++;
    });
    const server = createServer((_request, response) => {
      response.end("ok");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/test`);
      assert.equal(await response.text(), "ok");
      assert.equal(started, 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("QEMU spans happy path", () => {
  it("streams a timed action while its successful session is still running", async () => {
    const captured = captureSpans();
    const session = startQemuSpan("session-1", "agent-1");
    const action = startQemuActionSpan(session, "session-1", "agent-1", "send-key");

    finishQemuActionSpan(action, "completed");
    const [actionItem] = await captured.spans();
    assert.equal(actionItem.name, "QMP send-key");
    assert.equal(actionItem.is_segment, false);
    assert.equal(actionItem.status, "ok");
    assert.equal(actionItem.attributes["sentry.op"].value, "qemu.action");
    assert.equal(actionItem.attributes.session_id.value, "session-1");
    assert.equal(actionItem.attributes.agent_id.value, "agent-1");
    assert.equal(actionItem.attributes["qemu.command"].value, "send-key");
    assert.equal(actionItem.attributes.action_state.value, "completed");
    assert.ok(actionItem.end_timestamp >= actionItem.start_timestamp);

    finishQemuSpan(session, "succeeded");
    const spans = await captured.spans();
    assert.equal(spans.length, 2);
    const sessionItem = spans.find((span) => span.is_segment);
    assert.ok(sessionItem !== undefined);
    assert.equal(sessionItem.name, "QEMU session");
    assert.equal(sessionItem.status, "ok");
    assert.equal(sessionItem.attributes["sentry.op"].value, "qemu.session");
    assert.equal(sessionItem.attributes.session_id.value, "session-1");
    assert.equal(sessionItem.attributes.agent_id.value, "agent-1");
    assert.equal(sessionItem.attributes.session_status.value, "succeeded");
    assert.ok(sessionItem.end_timestamp >= sessionItem.start_timestamp);
    assert.equal(actionItem.parent_span_id, sessionItem.span_id);
    assert.equal(actionItem.trace_id, sessionItem.trace_id);
  });
});

describe("QEMU spans unhappy path", () => {
  it("marks a failed action without failing a successful session", async () => {
    const captured = captureSpans();
    const session = startQemuSpan("session-2", "agent-2");
    const action = startQemuActionSpan(session, "session-2", "agent-2", "screendump");

    finishQemuActionSpan(action, "failed");
    finishQemuSpan(session, "succeeded");

    const spans = await captured.spans();
    const actionItem = spans.find((span) => !span.is_segment);
    const sessionItem = spans.find((span) => span.is_segment);
    assert.equal(sessionItem?.status, "ok");
    assert.equal(actionItem?.status, "error");
    assert.equal(actionItem?.attributes.action_state.value, "failed");
  });

  it("marks a failed session", async () => {
    const captured = captureSpans();
    const session = startQemuSpan("session-3", "agent-3");

    finishQemuSpan(session, "failed");

    const spans = await captured.spans();
    assert.equal(spans.length, 1);
    assert.equal(spans[0].status, "error");
    assert.equal(spans[0].attributes.session_status.value, "failed");
  });

  it("marks an aborted session as an error", async () => {
    const captured = captureSpans();
    const session = startQemuSpan("session-4", "agent-4");

    finishQemuSpan(session, "aborted");

    const spans = await captured.spans();
    assert.equal(spans.length, 1);
    assert.equal(spans[0].status, "error");
    assert.equal(spans[0].attributes.session_status.value, "aborted");
  });

  it("marks a timed-out session as an error", async () => {
    const captured = captureSpans();
    const session = startQemuSpan("session-5", "agent-5");

    finishQemuSpan(session, "timed_out");

    const spans = await captured.spans();
    assert.equal(spans.length, 1);
    assert.equal(spans[0].status, "error");
    assert.equal(spans[0].attributes.session_status.value, "timed_out");
  });
});
