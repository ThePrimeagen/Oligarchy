import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
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

  it("accepts a snake_case ErrorTypeKey and refuses anything else", () => {
    const is = Schema.is(Domain.ErrorTypeKey);
    expect(is("guest_boot_hang")).toBe(true);
    expect(is("timeout")).toBe(true);
    expect(is("http_502")).toBe(true);
    expect(is("")).toBe(false);
    expect(is("Guest Boot Hang")).toBe(false);
    expect(is("guest-boot-hang")).toBe(false);
    expect(is("7_days")).toBe(false);
    expect(is("_leading")).toBe(false);
    expect(is("GUEST")).toBe(false);
  });

  it("names the key rule in the ErrorTypeKey decode failure", () => {
    const exit = Schema.decodeUnknownExit(Domain.ErrorTypeKey)("Guest Boot");
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toMatch(
        /key must be snake_case: a-z, 0-9 and _, starting with a letter/,
      );
    }
  });

  it("accepts an http or https url with a host as a ServerUrl and refuses anything else", () => {
    const is = Schema.is(Domain.ServerUrl);
    expect(is("http://10.0.0.5:42069")).toBe(true);
    expect(is("https://qemu.example.com")).toBe(true);
    expect(is("https://qemu.example.com/")).toBe(true);
    expect(is("")).toBe(false);
    expect(is("qemu.example.com:42069")).toBe(false);
    expect(is("ftp://qemu.example.com")).toBe(false);
    expect(is("http://")).toBe(false);
    expect(is("not a url")).toBe(false);
  });

  it("names the url rule in the ServerUrl decode failure", () => {
    const exit = Schema.decodeUnknownExit(Domain.ServerUrl)("qemu.example.com:42069");
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toMatch(/url must be an http or https url/);
    }
  });

  it("accepts a non-empty ServerName and refuses an empty one", () => {
    const is = Schema.is(Domain.ServerName);
    expect(is("garage")).toBe(true);
    expect(is("qemu-a")).toBe(true);
    expect(is("")).toBe(false);
  });

  it("accepts a provider/model id as a ModelId and refuses anything else", () => {
    const is = Schema.is(Domain.ModelId);
    expect(is("opencode/muse-spark-1.3-contributor-free")).toBe(true);
    expect(is("openrouter/deepseek/deepseek-v4.1-flash")).toBe(true);
    expect(is("")).toBe(false);
    expect(is("muse-spark-1.3")).toBe(false);
    expect(is("opencode/")).toBe(false);
    expect(is("/muse-spark-1.3")).toBe(false);
    expect(is("opencode/muse spark")).toBe(false);
  });

  it("names the model rule in the ModelId decode failure", () => {
    const exit = Schema.decodeUnknownExit(Domain.ModelId)("muse-spark-1.3");
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toMatch(/model must be provider\/model/);
    }
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
