import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Intent from "../../src/harness/intent.ts";
import type * as Tools from "../../src/harness/tools.ts";

const RESULT = "22222222-2222-4222-8222-222222222222";
const SESSION = "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f";

const line = (
  args: ReadonlyArray<string>,
  bin: Tools.CommandLine["bin"] = "./client",
): Tools.CommandLine => ({ bin, args });

const guest = (
  args: ReadonlyArray<string>,
  message = "lock the screen",
  bin: Tools.CommandLine["bin"] = "./client",
): Intent.Bracket => {
  const result = Intent.bracket(line(args, bin), RESULT, message);
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

  it("keeps the screenshot wrapper on the guest command and uses ./client for the intent", () => {
    const shot = guest(
      ["get-image", "--agent-id", "OLI-1", "--session-id", SESSION],
      "see the desktop",
      "./client-with-image",
    );
    expect(shot._tag).toBe("guest");
    if (shot._tag !== "guest") {
      return;
    }
    expect(shot.start.bin).toBe("./client");
    expect(shot.end.bin).toBe("./client");
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

  it("closes the result only when stop or save exits 0", () => {
    expect(Intent.closesResult(line(["stop", "--session-id", SESSION]), 0)).toBe(true);
    expect(Intent.closesResult(line(["save", "--session-id", SESSION]), 0)).toBe(true);
    expect(Intent.closesResult(line(["stop", "--session-id", SESSION]), 1)).toBe(false);
    expect(Intent.closesResult(line(["save"]), 1)).toBe(false);
    expect(Intent.closesResult(line(["send-keys", "--keys", "a"]), 0)).toBe(false);
    expect(Intent.closesResult(line(["relinquish"]), 0)).toBe(false);
    expect(Intent.closesResult(line(["start"]), 0)).toBe(false);
  });
});
