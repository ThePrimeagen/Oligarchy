import { describe, expect, it } from "vitest";
import { Duration, Result } from "effect";
import * as History from "../../src/harness/history.ts";
import * as Stop from "../../src/harness/stop.ts";

const SESSION = "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f";

const ok = <A>(result: Result.Result<A, { readonly message: string }>): A => {
  if (Result.isFailure(result)) {
    expect.fail(result.failure.message);
  }
  return result.success;
};

const started = (): History.History => ok(History.begin("You drive.", "Lock the screen."));

const call = (history: History.History, exitCode: number | null): History.History => {
  const called = ok(
    History.recordAssistant(history, {
      content: null,
      toolCalls: [
        {
          id: "keys",
          name: "client",
          arguments: JSON.stringify({
            args: ["send-keys", "--agent-id", "OLI-1", "--session-id", SESSION, "--keys", "a"],
          }),
        },
      ],
    }),
  );
  return ok(History.recordToolResult(called, { toolCallId: "keys", content: "", exitCode }));
};

const decide = (
  history: History.History,
  stepLimit: number,
  elapsed: number,
  ceiling: number,
  resultClosed = false,
): Stop.Decision =>
  Stop.decide({
    history,
    resultClosed,
    stepLimit,
    elapsed: Duration.millis(elapsed),
    ceiling: Duration.millis(ceiling),
  });

describe("stop conditions", () => {
  it("continues while the harness has not closed the result, the model is still calling tools, and both limits have room", () => {
    expect(decide(call(started(), 0), 200, 1_000, 60_000)).toEqual({ _tag: "continue" });
  });

  it("stops when the harness has marked the result complete, and a client command does not", () => {
    const history = call(started(), 0);
    expect(decide(history, 200, 1_000, 60_000)).toEqual({ _tag: "continue" });
    expect(decide(history, 200, 1_000, 60_000, true)).toEqual({
      _tag: "stop",
      reason: "result-closed",
    });

    const called = ok(
      History.recordAssistant(started(), {
        content: null,
        toolCalls: [{ id: "bad", name: "ctrl", arguments: '{"args":["test-results"]}' }],
      }),
    );
    const refused = ok(
      History.recordToolResult(called, {
        toolCallId: "bad",
        content: 'unknown tool "ctrl"',
        exitCode: null,
      }),
    );
    expect(decide(refused, 200, 1_000, 60_000)).toEqual({ _tag: "continue" });
  });

  it("stops at the step limit, which counts tool calls", () => {
    const history = call(started(), 0);
    expect(decide(history, 1, 0, 60_000)).toEqual({ _tag: "stop", reason: "step-limit" });
    expect(decide(history, 2, 0, 60_000)).toEqual({ _tag: "continue" });
  });

  it("stops when the model stops calling tools", () => {
    const history = ok(
      History.recordAssistant(started(), { content: "I am stuck", toolCalls: [] }),
    );
    expect(decide(history, 200, 0, 60_000)).toEqual({ _tag: "stop", reason: "model-stopped" });
  });

  it("stops once the elapsed time reaches the ceiling, and not before", () => {
    const history = started();
    expect(decide(history, 200, 999, 1_000)).toEqual({ _tag: "continue" });
    expect(decide(history, 200, 1_000, 1_000)).toEqual({ _tag: "stop", reason: "ceiling" });
    expect(decide(history, 200, 1_001, 1_000)).toEqual({ _tag: "stop", reason: "ceiling" });
  });

  it("reports the closed result ahead of the other conditions, then the step limit, then the model, then the ceiling", () => {
    const history = call(started(), 0);
    expect(decide(history, 1, 5_000, 1_000, true)).toEqual({
      _tag: "stop",
      reason: "result-closed",
    });

    const quiet = ok(History.recordAssistant(history, { content: "enough", toolCalls: [] }));
    expect(decide(quiet, 1, 5_000, 1_000)).toEqual({ _tag: "stop", reason: "step-limit" });

    const stopped = ok(History.recordAssistant(started(), { content: "enough", toolCalls: [] }));
    expect(decide(stopped, 200, 5_000, 1_000)).toEqual({ _tag: "stop", reason: "model-stopped" });
  });
});
