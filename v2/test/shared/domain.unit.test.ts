import { describe, expect, it } from "vitest";
import { Effect, Exit, Schema } from "effect";
import * as Domain from "../../src/shared/domain.ts";

const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";

describe("FollowEvent", () => {
  const lines: ReadonlyArray<readonly [Domain.FollowEvent, string]> = [
    [{ type: "session", status: "pending" }, `{"type":"session","status":"pending"}`],
    [
      { type: "intent", state: "started", message: "open the terminal" },
      `{"type":"intent","state":"started","message":"open the terminal"}`,
    ],
    [{ type: "intent", state: "cancelled" }, `{"type":"intent","state":"cancelled"}`],
    [
      { type: "action", id: 3, name: "send-keys", state: "running" },
      `{"type":"action","id":3,"name":"send-keys","state":"running"}`,
    ],
    [{ type: "action", id: 3, state: "completed" }, `{"type":"action","id":3,"state":"completed"}`],
    [
      { type: "image", id: SESSION_ID, png: "iVBORw0KGgo=" },
      `{"type":"image","id":"${SESSION_ID}","png":"iVBORw0KGgo="}`,
    ],
  ];

  it.each(lines)("round-trips %j through FollowEventLine with today's key order", (event, line) => {
    expect(Domain.encodeFollowLine(event)).toBe(`${line}\n`);
    const decoded = Effect.runSync(Domain.decodeFollowLine(line));
    expect(decoded).toEqual(event);
  });

  it("rejects a line with an unknown type", () => {
    const exit = Effect.runSyncExit(Domain.decodeFollowLine(`{"type":"noise","status":"pending"}`));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects a session line without a status", () => {
    const exit = Effect.runSyncExit(Domain.decodeFollowLine(`{"type":"session"}`));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects text that is not JSON", () => {
    const exit = Effect.runSyncExit(Domain.decodeFollowLine("not json"));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("brands", () => {
  it("accepts a uuid as a SessionId and refuses anything else", () => {
    expect(Domain.isSessionId(SESSION_ID)).toBe(true);
    expect(Domain.isSessionId("session-1")).toBe(false);
    expect(Domain.isSessionId("")).toBe(false);
  });

  it("refuses an empty AgentId", () => {
    expect(Schema.is(Domain.AgentId)("OLI-61")).toBe(true);
    expect(Schema.is(Domain.AgentId)("")).toBe(false);
  });
});

describe("QmpInbound", () => {
  const greeting = `{"QMP": {"version": {"qemu": {"micro": 0, "minor": 2, "major": 9}, "package": ""}, "capabilities": ["oob"]}}`;
  const success = `{"return": {}, "id": 1}`;
  const failure = `{"error": {"class": "GenericError", "desc": "boom"}, "id": 2}`;
  const event = `{"event": "RESUME", "timestamp": {"seconds": 1, "microseconds": 2}}`;

  it("decodes the greeting", () => {
    const exit = Domain.decodeQmpInbound(greeting);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({
        QMP: {
          version: { qemu: { micro: 0, minor: 2, major: 9 }, package: "" },
          capabilities: ["oob"],
        },
      });
    }
  });

  it("decodes a success reply", () => {
    const exit = Domain.decodeQmpInbound(success);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({ return: {}, id: 1 });
    }
  });

  it("decodes an error reply", () => {
    const exit = Domain.decodeQmpInbound(failure);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({ error: { class: "GenericError", desc: "boom" }, id: 2 });
    }
  });

  it("decodes an event without data", () => {
    const exit = Domain.decodeQmpInbound(event);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({ event: "RESUME", timestamp: { seconds: 1, microseconds: 2 } });
    }
  });

  it("rejects a frame with none of QMP, return, error, or event", () => {
    expect(Exit.isFailure(Domain.decodeQmpInbound(`{"hello": 1}`))).toBe(true);
  });

  it("rejects a frame that is not JSON", () => {
    expect(Exit.isFailure(Domain.decodeQmpInbound(`{"return":`))).toBe(true);
  });

  it("rejects an error reply whose body has no desc", () => {
    expect(Exit.isFailure(Domain.decodeQmpInbound(`{"error": {"class": "GenericError"}}`))).toBe(
      true,
    );
  });
});

describe("encodeQmpCommand", () => {
  it("encodes qmp_capabilities as today's JSON followed by a newline", () => {
    expect(Domain.encodeQmpCommand({ execute: "qmp_capabilities", arguments: {}, id: 1 })).toBe(
      `{"execute":"qmp_capabilities","arguments":{},"id":1}\n`,
    );
  });

  it("encodes send-key", () => {
    expect(
      Domain.encodeQmpCommand({
        execute: "send-key",
        arguments: {
          keys: [
            { type: "qcode", data: "shift" },
            { type: "qcode", data: "a" },
          ],
        },
        id: 2,
      }),
    ).toBe(
      `{"execute":"send-key","arguments":{"keys":[{"type":"qcode","data":"shift"},{"type":"qcode","data":"a"}]},"id":2}\n`,
    );
  });

  it("encodes screendump", () => {
    expect(
      Domain.encodeQmpCommand({
        execute: "screendump",
        arguments: { filename: "/tmp/oligarchy-x/image-1.png", format: "png" },
        id: 3,
      }),
    ).toBe(
      `{"execute":"screendump","arguments":{"filename":"/tmp/oligarchy-x/image-1.png","format":"png"},"id":3}\n`,
    );
  });

  it("encodes input-send-event", () => {
    expect(
      Domain.encodeQmpCommand({
        execute: "input-send-event",
        arguments: {
          events: [
            { type: "abs", data: { axis: "x", value: 16383 } },
            { type: "btn", data: { button: "left", down: true } },
          ],
        },
        id: 4,
      }),
    ).toBe(
      `{"execute":"input-send-event","arguments":{"events":[{"type":"abs","data":{"axis":"x","value":16383}},{"type":"btn","data":{"button":"left","down":true}}]},"id":4}\n`,
    );
  });
});

describe("QmpExchangeOutcome", () => {
  it("accepts a completed outcome with a greeting and a failed outcome with a string", () => {
    const is = Schema.is(Domain.QmpExchangeOutcome);
    expect(is({ state: "completed", response: { return: {} } })).toBe(true);
    expect(is({ state: "failed", response: "qemu: send-key timed out" })).toBe(true);
    expect(is({ state: "failed", response: { return: {} } })).toBe(false);
  });
});
