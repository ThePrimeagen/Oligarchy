import { describe, expect, it } from "vitest";
import { Option } from "effect";
import * as Events from "../../src/automation-client/events.ts";

// Synthetic fixtures: S2 could not be captured here (no opencode). Shapes follow AUTO_CLIENT.md §6.3.
const TEXT = JSON.stringify({
  type: "text",
  sessionID: "ses_synthetic_1",
  part: { text: "hello from the agent" },
});
const STEP_START = JSON.stringify({ type: "step_start", sessionID: "ses_synthetic_1" });
const FINAL_TEXT = JSON.stringify({
  type: "text",
  sessionID: "ses_synthetic_1",
  part: { text: "the last step's answer" },
});
const ERROR_WITH_DATA = JSON.stringify({
  type: "error",
  sessionID: "ses_synthetic_1",
  error: { name: "APIError", data: { message: "bad key" } },
});
const ERROR_NAME_ONLY = JSON.stringify({
  type: "error",
  sessionID: "ses_synthetic_2",
  error: { name: "PermissionDenied" },
});
const TOOL_USE = JSON.stringify({
  type: "tool_use",
  sessionID: "ses_synthetic_1",
  part: { name: "bash" },
});
const NO_SESSION = JSON.stringify({ type: "text", part: { text: "orphan" } });

const foldAll = (lines: ReadonlyArray<string>): Events.State =>
  lines.reduce(Events.fold, Events.empty);

describe("events fold happy path", () => {
  it("a captured text line yields the session id and its text", () => {
    const state = Events.fold(Events.empty, TEXT);
    expect(state.session).toEqual(Option.some("ses_synthetic_1"));
    expect(state.text).toBe("hello from the agent");
    expect(state.error).toEqual(Option.none());
    expect(state.ignored).toBe(0);
  });

  it("step_start resets the text so the final answer is the last step's", () => {
    const state = foldAll([TEXT, STEP_START, FINAL_TEXT]);
    expect(state.session).toEqual(Option.some("ses_synthetic_1"));
    expect(state.text).toBe("the last step's answer");
    expect(state.ignored).toBe(0);
  });

  it("a captured error line yields error.data.message, or error.name when there is no data", () => {
    expect(Events.fold(Events.empty, ERROR_WITH_DATA).error).toEqual(Option.some("bad key"));
    expect(Events.fold(Events.empty, ERROR_NAME_ONLY).error).toEqual(
      Option.some("PermissionDenied"),
    );
  });
});

describe("events fold unhappy path", () => {
  it("a non-JSON line and a JSON line with an unknown type are ignored and counted", () => {
    const state = foldAll([TEXT, "not json", TOOL_USE, "{"]);
    expect(state.session).toEqual(Option.some("ses_synthetic_1"));
    expect(state.text).toBe("hello from the agent");
    expect(state.ignored).toBe(3);
  });

  it("a line without sessionID is ignored", () => {
    const state = foldAll([TEXT, NO_SESSION]);
    expect(state.session).toEqual(Option.some("ses_synthetic_1"));
    expect(state.text).toBe("hello from the agent");
    expect(state.ignored).toBe(1);
  });
});
