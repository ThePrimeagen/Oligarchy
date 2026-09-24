import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Intent from "../../src/harness/intent.ts";
const SESSION = "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f";

describe("harness-owned flags", () => {
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
