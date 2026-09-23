import { describe, expect, it } from "vitest";
import { Duration, Result } from "effect";
import * as History from "../../src/harness/history.ts";
import * as Stop from "../../src/harness/stop.ts";

const SESSION = "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f";
const MODEL = "openrouter/meta/muse-spark-1.3-contributor";

const ok = <A>(result: Result.Result<A, { readonly message: string }>): A => {
  if (Result.isFailure(result)) {
    expect.fail(result.failure.message);
  }
  return result.success;
};

const started = (): History.History => ok(History.begin("You drive.", "Lock the screen."));

const call = (
  history: History.History,
  id: string,
  name: string,
  args: ReadonlyArray<string>,
  exitCode: number | null,
  content: string,
): History.History => {
  const called = ok(
    History.recordAssistant(history, {
      content: null,
      toolCalls: [{ id, name, arguments: JSON.stringify({ args }) }],
    }),
  );
  return ok(History.recordToolResult(called, { toolCallId: id, content, exitCode }));
};

const decide = (
  history: History.History,
  stepLimit: number,
  elapsed: number,
  ceiling: number,
): Stop.Decision =>
  Stop.decide({
    history,
    stepLimit,
    elapsed: Duration.millis(elapsed),
    ceiling: Duration.millis(ceiling),
  });

describe("stop conditions", () => {
  it("continues while the result is open, the model is still calling tools, and both limits have room", () => {
    const history = call(
      started(),
      "keys",
      "client",
      ["send-keys", "--agent-id", "OLI-1", "--session-id", SESSION, "--keys", "a"],
      0,
      "",
    );
    expect(decide(history, 200, 1_000, 60_000)).toEqual({ _tag: "continue" });
  });

  it("stops when ./ctrl test-results exits 0", () => {
    const history = call(
      started(),
      "close",
      "ctrl",
      ["test-results", "--agent-id", "OLI-1", "--id", "result-1", "--status", "success"],
      0,
      "closed\n",
    );
    expect(decide(history, 200, 1_000, 60_000)).toEqual({
      _tag: "stop",
      reason: "result-closed",
    });
  });

  it("does not treat a failed test-results, a diagnose, or a refused call as a closed result", () => {
    const failed = call(
      started(),
      "close",
      "ctrl",
      ["test-results", "--agent-id", "OLI-1", "--id", "result-1", "--status", "success"],
      1,
      "test-results: result result-1 is passed\n",
    );
    expect(decide(failed, 200, 1_000, 60_000)).toEqual({ _tag: "continue" });

    const diagnosed = call(
      started(),
      "review",
      "ctrl",
      [
        "diagnose",
        "--session-id",
        SESSION,
        "--verdict",
        "passed",
        "--summary",
        "proof is on screen",
        "--model",
        MODEL,
      ],
      0,
      "diagnosed\n",
    );
    expect(decide(diagnosed, 200, 1_000, 60_000)).toEqual({ _tag: "continue" });

    const called = ok(
      History.recordAssistant(started(), {
        content: null,
        toolCalls: [{ id: "bad", name: "bash", arguments: '{"args":["ls"]}' }],
      }),
    );
    const refused = ok(
      History.recordToolResult(called, {
        toolCallId: "bad",
        content: 'unknown tool "bash"',
        exitCode: null,
      }),
    );
    expect(decide(refused, 200, 1_000, 60_000)).toEqual({ _tag: "continue" });
  });

  it("does not close the result when a later turn reuses an id", () => {
    const typed = call(
      started(),
      "c1",
      "client",
      ["send-keys", "--agent-id", "OLI-1", "--session-id", SESSION, "--keys", "a"],
      0,
      "",
    );
    const reused = call(
      typed,
      "c1",
      "ctrl",
      ["test-results", "--agent-id", "OLI-1", "--id", "result-1", "--status", "success"],
      1,
      "test-results: result result-1 is passed\n",
    );
    expect(decide(reused, 200, 1_000, 60_000)).toEqual({ _tag: "continue" });

    const closed = call(
      typed,
      "c1",
      "ctrl",
      ["test-results", "--agent-id", "OLI-1", "--id", "result-1", "--status", "success"],
      0,
      "closed\n",
    );
    expect(decide(closed, 200, 1_000, 60_000)).toEqual({ _tag: "stop", reason: "result-closed" });
  });

  it("stops at the step limit, which counts tool calls", () => {
    const history = call(
      started(),
      "keys",
      "client",
      ["send-keys", "--agent-id", "OLI-1", "--session-id", SESSION, "--keys", "a"],
      0,
      "",
    );
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
    const closed = call(
      started(),
      "close",
      "ctrl",
      ["test-results", "--agent-id", "OLI-1", "--id", "result-1", "--status", "failed"],
      0,
      "closed\n",
    );
    expect(decide(closed, 1, 5_000, 1_000)).toEqual({ _tag: "stop", reason: "result-closed" });

    const called = ok(
      History.recordAssistant(started(), {
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
    const answered = ok(
      History.recordToolResult(called, { toolCallId: "keys", content: "", exitCode: 0 }),
    );
    const quiet = ok(History.recordAssistant(answered, { content: "enough", toolCalls: [] }));
    expect(decide(quiet, 1, 5_000, 1_000)).toEqual({ _tag: "stop", reason: "step-limit" });

    const stopped = ok(History.recordAssistant(started(), { content: "enough", toolCalls: [] }));
    expect(decide(stopped, 200, 5_000, 1_000)).toEqual({ _tag: "stop", reason: "model-stopped" });
  });
});
