import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Intent from "../../src/harness/intent.ts";
import type * as Tools from "../../src/harness/tools.ts";

const RESULT = "22222222-2222-4222-8222-222222222222";
const SESSION = "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f";

const line = (args: ReadonlyArray<string>): Tools.CommandLine => ({ bin: "./client", args });

const guest = (args: ReadonlyArray<string>, message = "lock the screen"): Intent.Bracket => {
  const result = Intent.bracket(line(args), RESULT, message);
  if (Result.isFailure(result)) {
    expect.fail(result.failure.message);
  }
  return result.success;
};

const refused = (args: ReadonlyArray<string>, message = "lock the screen"): string => {
  const result = Intent.bracket(line(args), RESULT, message);
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure._tag).toBe("ToolError");
    return result.failure.message;
  }
  return "";
};

describe("intent brackets", () => {
  it("wraps keys, mouse, images, serial and follow, copying the session flags", () => {
    const send = guest([
      "send-keys",
      "--agent-id",
      "OLI-1",
      "--session-id",
      SESSION,
      "--server-url",
      "http://127.0.0.1:9",
      "--keys",
      "a",
    ]);
    expect(send._tag).toBe("guest");
    if (send._tag !== "guest") {
      return;
    }
    expect(send.start).toEqual({
      bin: "./client",
      args: [
        "intent",
        "start",
        "--agent-id",
        "OLI-1",
        "--session-id",
        SESSION,
        "--server-url",
        "http://127.0.0.1:9",
        "--test-result-id",
        RESULT,
        "--message",
        "lock the screen",
      ],
    });
    expect(send.end).toEqual({
      bin: "./client",
      args: [
        "intent",
        "end",
        "--agent-id",
        "OLI-1",
        "--session-id",
        SESSION,
        "--server-url",
        "http://127.0.0.1:9",
      ],
    });

    for (const args of [
      [
        "mouse",
        "click",
        "--agent-id",
        "OLI-1",
        "--session-id",
        SESSION,
        "--x",
        "0.1",
        "--y",
        "0.2",
      ],
      ["get-image", "--agent-id=OLI-1", `--session-id=${SESSION}`, "-o", "shot.png"],
      ["get-serial", "--agent-id", "OLI-1", "--session-id", SESSION],
      ["follow", "--session-id", SESSION, "--agent-id", "OLI-1"],
    ]) {
      expect(guest(args)._tag, args[0]).toBe("guest");
    }
  });

  it("leaves start, reserve, relinquish, stop and save outside an intent", () => {
    for (const args of [
      ["start", "--agent-id", "OLI-1", "--iso", "omarchy.iso"],
      ["reserve", "--agent-id", "OLI-1"],
      ["relinquish", "--agent-id", "OLI-1"],
      ["stop", "--agent-id", "OLI-1", "--session-id", SESSION, "--status", "succeeded"],
      ["save", "--agent-id", "OLI-1", "--session-id", SESSION],
      ["bash"],
      [],
    ]) {
      expect(guest(args)._tag, args[0] ?? "(none)").toBe("plain");
    }
  });

  it("refuses a guest action that names no agent or no session, and an empty intent", () => {
    expect(refused(["send-keys", "--agent-id", "OLI-1", "--keys", "a"])).toContain("--session-id");
    expect(refused(["send-keys", "--session-id", SESSION, "--keys", "a"])).toContain("--agent-id");
    expect(refused(["mouse", "click", "--agent-id", "OLI-1"])).toContain("--session-id");
    expect(refused(["get-image", "--agent-id", "OLI-1", "--session-id", SESSION], "")).toContain(
      "message",
    );
    const missing = Intent.bracket(
      line(["send-keys", "--agent-id", "OLI-1", "--session-id", SESSION]),
      "",
      "lock",
    );
    expect(Result.isFailure(missing)).toBe(true);
    if (Result.isFailure(missing)) {
      expect(missing.failure.message).toContain("test-result-id");
    }
  });

  it("uses the model's words, or the action when it said nothing", () => {
    expect(Intent.intentMessage("  lock the screen  ", ["send-keys"])).toBe("lock the screen");
    expect(Intent.intentMessage(null, ["send-keys", "--keys", "a"])).toBe("send-keys");
    expect(Intent.intentMessage("", ["mouse", "click", "--x", "0"])).toBe("mouse click");
    expect(Intent.intentMessage("   ", ["get-image"])).toBe("get-image");
  });

  it("puts the harness agent, server, and session on the action and drops a model's copy", () => {
    const held = {
      agentId: "OLI-1",
      serverUrl: "http://127.0.0.1:9",
      sessionId: SESSION,
    };
    const keys = Intent.owned(
      [
        "send-keys",
        "--agent-id",
        "WRONG",
        "--server-url=http://stolen.example",
        "--session-id",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "--keys",
        "a",
      ],
      held,
    );
    expect(Result.isSuccess(keys)).toBe(true);
    if (Result.isSuccess(keys)) {
      expect(keys.success).toEqual([
        "send-keys",
        "--keys",
        "a",
        "--agent-id",
        "OLI-1",
        "--server-url",
        "http://127.0.0.1:9",
        "--session-id",
        SESSION,
      ]);
    }
    const boot = Intent.owned(["start", "--resume"], { ...held, serverUrl: "", sessionId: "" });
    expect(Result.isSuccess(boot)).toBe(true);
    if (Result.isSuccess(boot)) {
      expect(boot.success).toEqual(["start", "--resume", "--agent-id", "OLI-1"]);
    }
  });

  it("refuses a guest action or a stop before the harness has a session (unhappy)", () => {
    const held = { agentId: "OLI-1", serverUrl: "http://127.0.0.1:9", sessionId: "" };
    for (const args of [
      ["send-keys", "--keys", "a"],
      ["stop", "--status", "succeeded"],
      ["save"],
    ]) {
      const missing = Intent.owned(args, held);
      expect(Result.isFailure(missing), args[0]).toBe(true);
      if (Result.isFailure(missing)) {
        expect(missing.failure.message).toContain("no session");
      }
    }
    const start = Intent.owned(["start"], held);
    expect(Result.isSuccess(start)).toBe(true);
  });
});
