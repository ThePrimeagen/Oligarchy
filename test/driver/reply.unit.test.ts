import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Reply from "../../src/driver/reply.ts";

const SESSION = "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f";

const connection = {
  agentId: "OLI-1",
  serverUrl: "http://127.0.0.1:9",
  sessionId: SESSION as string | undefined,
};

const call = (body: unknown, name = "drive") =>
  Reply.parse({ name, arguments: JSON.stringify(body) });

const line = (action: Reply.Action, sessionId: string | undefined = SESSION) => {
  const result = Reply.command(action, { ...connection, sessionId });
  if (Result.isFailure(result)) {
    expect.fail(result.failure.message);
  }
  return result.success;
};

describe("drive call", () => {
  it("reads continue, what the agent did, and a send-keys action", () => {
    const parsed = call({
      status: "continue",
      actionTaken: "booted the guest",
      action: { _tag: "send-keys", keys: "hello<ENTER>" },
    });
    expect(Result.isSuccess(parsed)).toBe(true);
    if (Result.isFailure(parsed)) {
      return;
    }
    expect(parsed.success.status).toBe("continue");
    expect(parsed.success.actionTaken).toBe("booted the guest");
    expect(line(parsed.success.action).args).toEqual([
      "send-keys",
      "--agent-id",
      "OLI-1",
      "--server-url",
      "http://127.0.0.1:9",
      "--session-id",
      SESSION,
      "--keys",
      "hello<ENTER>",
    ]);
  });

  it("reads a click at the edges, and leaves out a button and a modifier when they are absent", () => {
    const parsed = call({
      status: "continue",
      actionTaken: "clicked the corner",
      action: { _tag: "click", x: 0, y: 1 },
    });
    expect(Result.isSuccess(parsed)).toBe(true);
    if (Result.isFailure(parsed)) {
      return;
    }
    expect(line(parsed.success.action).args).toEqual([
      "mouse",
      "click",
      "--agent-id",
      "OLI-1",
      "--server-url",
      "http://127.0.0.1:9",
      "--session-id",
      SESSION,
      "--x",
      "0",
      "--y",
      "1",
    ]);
  });

  it("reads a click's button and modifiers", () => {
    const parsed = call({
      status: "continue",
      actionTaken: "opened the menu",
      action: { _tag: "click", x: 0.3, y: 0.2, button: "right", modifier: ["shift", "super"] },
    });
    expect(Result.isSuccess(parsed)).toBe(true);
    if (Result.isFailure(parsed)) {
      return;
    }
    expect(line(parsed.success.action).args).toEqual([
      "mouse",
      "click",
      "--agent-id",
      "OLI-1",
      "--server-url",
      "http://127.0.0.1:9",
      "--session-id",
      SESSION,
      "--x",
      "0.3",
      "--y",
      "0.2",
      "--button",
      "right",
      "--modifier",
      "shift",
      "--modifier",
      "super",
    ]);
  });

  it("reads complete without putting the connection on a start", () => {
    const parsed = call({
      status: "complete",
      actionTaken: "booted",
      action: { _tag: "start", resume: true, iso: "omarchy.iso" },
    });
    expect(Result.isSuccess(parsed)).toBe(true);
    if (Result.isFailure(parsed)) {
      return;
    }
    expect(parsed.success.status).toBe("complete");
    expect(line(parsed.success.action, undefined).args).toEqual([
      "start",
      "--agent-id",
      "OLI-1",
      "--server-url",
      "http://127.0.0.1:9",
      "--resume",
      "--iso",
      "omarchy.iso",
    ]);
  });

  it("refuses a point outside 0..1, an empty actionTaken, a bad tool, and JSON that is not an object", () => {
    const wide = call({
      status: "continue",
      actionTaken: "clicked",
      action: { _tag: "click", x: 1.2, y: 0.2 },
    });
    expect(Result.isFailure(wide)).toBe(true);
    if (Result.isFailure(wide)) {
      expect(wide.failure.message).toContain("0..1");
    }
    const empty = call({
      status: "continue",
      actionTaken: "",
      action: { _tag: "save" },
    });
    expect(Result.isFailure(empty)).toBe(true);
    if (Result.isFailure(empty)) {
      expect(empty.failure.message).toContain("1");
    }
    const named = Reply.parse({ name: "client", arguments: "{}" });
    expect(Result.isFailure(named)).toBe(true);
    if (Result.isFailure(named)) {
      expect(named.failure.message).toContain("client");
    }
    const text = Reply.parse({ name: "drive", arguments: "not json" });
    expect(Result.isFailure(text)).toBe(true);
    if (Result.isFailure(text)) {
      expect(text.failure.message).toContain("JSON");
    }
  });

  it("refuses a session, a server, or a result id on the action", () => {
    for (const extra of [
      { sessionId: SESSION },
      { serverUrl: "http://127.0.0.1:9" },
      { testResultId: "2222" },
      { agentId: "OLI-1" },
    ]) {
      const parsed = call({
        status: "continue",
        actionTaken: "type",
        action: { _tag: "send-keys", keys: "a", ...extra },
      });
      expect(Result.isFailure(parsed)).toBe(true);
      if (Result.isFailure(parsed)) {
        expect(parsed.failure.message).toContain("excess");
      }
    }
  });

  it("refuses an unknown action", () => {
    const parsed = call({
      status: "continue",
      actionTaken: "open an intent",
      action: { _tag: "intent", message: "lock" },
    });
    expect(Result.isFailure(parsed)).toBe(true);
    if (Result.isFailure(parsed)) {
      expect(parsed.failure.message).toContain("Action");
    }
  });

  it("refuses a guest action when the harness has no session, and allows start", () => {
    const keys = call({
      status: "continue",
      actionTaken: "type",
      action: { _tag: "send-keys", keys: "a" },
    });
    expect(Result.isSuccess(keys)).toBe(true);
    if (Result.isFailure(keys)) {
      return;
    }
    const refused = Reply.command(keys.success.action, { ...connection, sessionId: undefined });
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isFailure(refused)) {
      expect(refused.failure.message).toContain("session");
    }
    const boot = call({
      status: "continue",
      actionTaken: "boot",
      action: { _tag: "start" },
    });
    expect(Result.isSuccess(boot)).toBe(true);
    if (Result.isFailure(boot)) {
      return;
    }
    expect(line(boot.success.action, undefined).args[0]).toBe("start");
  });

  it("publishes the drive tool with the point bounds and no connection fields", () => {
    expect(Reply.TOOL.function.name).toBe("drive");
    const text = JSON.stringify(Reply.TOOL.function.parameters);
    expect(text).toContain('"minimum":0');
    expect(text).toContain('"maximum":1');
    expect(text).toContain("send-keys");
    expect(text).toContain("double-click");
    expect(text).not.toContain("agentId");
    expect(text).not.toContain("sessionId");
    expect(text).not.toContain("serverUrl");
    expect(text).not.toContain("testResultId");
  });
});
