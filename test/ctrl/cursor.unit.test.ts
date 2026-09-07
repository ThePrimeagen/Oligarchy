import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as Cursor from "../../src/ctrl/cursor.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeCursor from "../support/fake-cursor.ts";

const prompt = (text: string, model?: Cursor.Model) =>
  Effect.flatMap(Cursor.CursorAgents, (agents) =>
    model === undefined ? agents.prompt(text) : agents.prompt(text, model),
  );

describe("CursorAgents.prompt happy path", () => {
  it.effect("returns the agent id and records the prompt text", () =>
    Effect.gen(function* () {
      const cursor = FakeCursor.fakeCursor({ agentId: "bc-42" });
      const created = yield* prompt("Review Linear ticket OLI-42 and complete your task.").pipe(
        Effect.provide(cursor.layer),
      );
      expect(created).toEqual({ agentId: "bc-42" });
      expect(cursor.calls).toEqual([
        { text: "Review Linear ticket OLI-42 and complete your task.", model: undefined },
      ]);
    }),
  );

  it.effect("passes the model given instead of the default", () =>
    Effect.gen(function* () {
      const cursor = FakeCursor.fakeCursor();
      yield* prompt("hello", { id: "composer-2.5" }).pipe(Effect.provide(cursor.layer));
      expect(cursor.calls).toEqual([{ text: "hello", model: { id: "composer-2.5" } }]);
    }),
  );

  it("kicks off on the repository with Grok 4.6 fast, extra high, by default", () => {
    expect(Cursor.GROK_4_6_FAST_XHIGH).toEqual({
      id: "grok-4.6",
      params: [
        { id: "effort", value: "xhigh" },
        { id: "fast", value: "true" },
      ],
    });
    expect(Cursor.REPOSITORY).toBe("https://github.com/ThePrimeagen/Oligarchy");
    expect(Cursor.agentUrl("bc-42")).toBe("https://cursor.com/agents/bc-42");
  });
});

describe("CursorAgents.prompt unhappy path", () => {
  it.effect("surfaces the SDK's refusal as CursorAgentFailed", () =>
    Effect.gen(function* () {
      const failure = Errors.CursorAgentFailed.make({
        message: "Invalid API key",
        retryable: false,
        cause: new Error("Invalid API key"),
      });
      const cursor = FakeCursor.fakeCursor({ failure });
      const error = yield* Effect.flip(prompt("hello")).pipe(Effect.provide(cursor.layer));
      expect(error).toBe(failure);
      expect(error.message).toBe("Invalid API key");
      expect(error.retryable).toBe(false);
    }),
  );

  it("classifies a thrown SDK error by its message and retry flag", () => {
    const retryable = Cursor.cursorAgentFailed(
      Object.assign(new Error("rate limited"), { isRetryable: true }),
    );
    expect(retryable).toMatchObject({
      _tag: "CursorAgentFailed",
      message: "rate limited",
      retryable: true,
    });
    expect(retryable.cause).toBeInstanceOf(Error);

    const terminal = Cursor.cursorAgentFailed(
      Object.assign(new Error("Model 'grok-9' is not available or invalid"), {
        isRetryable: false,
      }),
    );
    expect(terminal).toMatchObject({
      message: "Model 'grok-9' is not available or invalid",
      retryable: false,
    });
  });

  it("falls back to a fixed message for a thrown value without one", () => {
    const failure = Cursor.cursorAgentFailed("boom");
    expect(failure).toMatchObject({
      message: "cursor: agent request failed",
      retryable: false,
      cause: "boom",
    });
  });
});
