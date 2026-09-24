import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as History from "../../src/harness/history.ts";

const turn = (
  id: string,
  name: string,
  args: string,
): { readonly id: string; readonly name: string; readonly arguments: string } => ({
  id,
  name,
  arguments: args,
});

const ok = <A>(result: Result.Result<A, { readonly message: string }>): A => {
  if (Result.isFailure(result)) {
    expect.fail(result.failure.message);
  }
  return result.success;
};

const failure = (
  result: Result.Result<unknown, { readonly _tag: string; readonly message: string }>,
): string => {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure._tag).toBe("HistoryError");
    return result.failure.message;
  }
  return "";
};

describe("message history", () => {
  it("starts with the system prompt and the user prompt, then the model's calls and their results", () => {
    const started = ok(History.begin("You drive.", "Lock the screen."));
    const called = ok(
      History.recordAssistant(started, {
        content: null,
        toolCalls: [turn("call-1", "client", '{"args":["start"]}')],
      }),
    );
    const answered = ok(
      History.recordToolResult(called, {
        toolCallId: "call-1",
        content: "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f\n",
        exitCode: 0,
      }),
    );
    const finished = ok(History.recordAssistant(answered, { content: "done", toolCalls: [] }));

    expect(History.wire(finished)).toEqual([
      { role: "system", content: "You drive." },
      { role: "user", content: "Lock the screen." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "client", arguments: '{"args":["start"]}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-1",
        content: "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f\n",
      },
      { role: "assistant", content: "done" },
    ]);
    expect(JSON.stringify(History.wire(finished))).not.toContain("exitCode");
  });

  it("keeps several tool calls and answers them in that order", () => {
    const started = ok(History.begin("You drive.", "Look, then type."));
    const called = ok(
      History.recordAssistant(started, {
        content: "two steps",
        toolCalls: [
          turn("img", "client", '{"args":["get-image"]}'),
          turn("keys", "client", '{"args":["send-keys"]}'),
        ],
      }),
    );
    const image = ok(
      History.recordToolResult(called, { toolCallId: "img", content: "png", exitCode: 0 }),
    );
    const typed = ok(
      History.recordToolResult(image, { toolCallId: "keys", content: "", exitCode: 0 }),
    );

    const roles = History.wire(typed).map((message) => message.role);
    expect(roles).toEqual(["system", "user", "assistant", "tool", "tool"]);
    expect(History.wire(typed)[3]).toMatchObject({ tool_call_id: "img", content: "png" });
    expect(History.wire(typed)[4]).toMatchObject({ tool_call_id: "keys", content: "" });
  });

  it("refuses an empty system prompt or an empty user prompt", () => {
    expect(failure(History.begin("", "Lock the screen."))).toContain("system");
    expect(failure(History.begin("You drive.", ""))).toContain("prompt");
  });

  it("refuses a tool result when no tool call is open", () => {
    const started = ok(History.begin("You drive.", "Lock the screen."));
    expect(
      failure(
        History.recordToolResult(started, { toolCallId: "call-1", content: "x", exitCode: 0 }),
      ),
    ).toContain("no tool call is open");
  });

  it("refuses a tool result that does not answer the next open call", () => {
    const started = ok(History.begin("You drive.", "Look, then type."));
    const called = ok(
      History.recordAssistant(started, {
        content: null,
        toolCalls: [turn("img", "client", "{}"), turn("keys", "client", "{}")],
      }),
    );
    expect(
      failure(History.recordToolResult(called, { toolCallId: "keys", content: "", exitCode: 0 })),
    ).toContain("img");
    const image = ok(
      History.recordToolResult(called, { toolCallId: "img", content: "png", exitCode: 0 }),
    );
    expect(
      failure(
        History.recordToolResult(image, { toolCallId: "img", content: "again", exitCode: 0 }),
      ),
    ).toContain("keys");
  });

  it("refuses another assistant turn while a tool call is still open", () => {
    const started = ok(History.begin("You drive.", "Lock the screen."));
    const called = ok(
      History.recordAssistant(started, {
        content: null,
        toolCalls: [turn("call-1", "client", "{}")],
      }),
    );
    expect(failure(History.recordAssistant(called, { content: "done", toolCalls: [] }))).toContain(
      "call-1",
    );
  });

  it("refuses an empty tool call id and a repeated id in one turn", () => {
    const started = ok(History.begin("You drive.", "Lock the screen."));
    expect(
      failure(
        History.recordAssistant(started, {
          content: null,
          toolCalls: [turn("", "client", "{}")],
        }),
      ),
    ).toContain("id");
    expect(
      failure(
        History.recordAssistant(started, {
          content: null,
          toolCalls: [turn("call-1", "client", "{}"), turn("call-1", "ctrl", "{}")],
        }),
      ),
    ).toContain("call-1");
  });
});
