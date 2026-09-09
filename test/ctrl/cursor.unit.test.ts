import { describe, expect, it as plain } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Result } from "effect";
import * as Cursor from "../../src/ctrl/cursor.ts";
import * as Domain from "../../src/shared/domain.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as Catalog from "../support/cursor-catalog.ts";
import * as FakeCursor from "../support/fake-cursor.ts";

const prompt = (text: string, choice?: Domain.ModelChoice) =>
  Effect.flatMap(Cursor.CursorAgents, (agents) =>
    choice === undefined ? agents.prompt(text) : agents.prompt(text, choice),
  );

const selected = (choice: Domain.ModelChoice) =>
  Result.getOrThrow(Cursor.select(choice, Catalog.CATALOG));

const refused = (choice: Domain.ModelChoice): Errors.ModelUnavailable => {
  const result = Cursor.select(choice, Catalog.CATALOG);
  if (Result.isSuccess(result)) {
    throw new Error(`expected ${JSON.stringify(choice)} to be refused`);
  }
  return result.failure;
};

// The catalog is the vendor's word on what a model takes; the choice is ours. `select` says the
// choice in the vendor's params, or refuses it naming what the model does take.
describe("select happy path", () => {
  plain("the default is grok-4.6 at effort high, running fast", () => {
    expect(selected(Domain.DEFAULT_MODEL)).toEqual({
      id: "grok-4.6",
      params: [
        { id: "effort", value: "high" },
        { id: "fast", value: "true" },
      ],
    });
  });

  plain("a model asked for by id alone carries no params: the vendor's defaults apply", () => {
    expect(selected({ model: "composer-2.5" })).toEqual({ id: "composer-2.5", params: [] });
    expect(selected({ model: "gemini-3.1-pro" })).toEqual({ id: "gemini-3.1-pro", params: [] });
  });

  plain("an alias names the model and the selection carries the alias as given", () => {
    expect(selected({ model: "opus", reasoning: "max" })).toEqual({
      id: "opus",
      params: [{ id: "effort", value: "max" }],
    });
  });

  plain("reasoning lands on the parameter the vendor spells it as", () => {
    expect(selected({ model: "claude-opus-5", reasoning: "low" }).params).toEqual([
      { id: "effort", value: "low" },
    ]);
    expect(selected({ model: "gpt-5.5", reasoning: "none" }).params).toEqual([
      { id: "reasoning", value: "none" },
    ]);
    expect(selected({ model: "gemini-3.8-flash", reasoning: "medium" }).params).toEqual([
      { id: "reasoning_effort", value: "medium" },
    ]);
  });

  plain("xhigh is extra-high on a model that spells it so", () => {
    expect(selected({ model: "gpt-5.5", reasoning: "xhigh", fast: true }).params).toEqual([
      { id: "reasoning", value: "extra-high" },
      { id: "fast", value: "true" },
    ]);
  });

  plain("fast false is sent as the vendor's false, not left out", () => {
    expect(selected({ model: "grok-4.6", reasoning: "medium", fast: false }).params).toEqual([
      { id: "effort", value: "medium" },
      { id: "fast", value: "false" },
    ]);
  });
});

describe("select unhappy path", () => {
  plain("a model the catalog does not list is refused by name", () => {
    expect(refused({ model: "grok-9", reasoning: "high" })).toMatchObject({
      _tag: "ModelUnavailable",
      model: "grok-9",
      message: 'unknown model "grok-9"',
    });
    expect(refused({ model: "" }).message).toBe('unknown model ""');
  });

  plain("a model without a fast switch refuses fast, true or false", () => {
    expect(refused({ model: "gemini-3.8-flash", fast: true })).toMatchObject({
      model: "gemini-3.8-flash",
      message: 'model "gemini-3.8-flash" has no fast mode',
    });
    expect(refused({ model: "gemini-3.1-pro", fast: false }).message).toBe(
      'model "gemini-3.1-pro" has no fast mode',
    );
  });

  plain("a model without a reasoning parameter refuses every level", () => {
    expect(refused({ model: "composer-2.5", reasoning: "high" })).toMatchObject({
      model: "composer-2.5",
      message: 'model "composer-2.5" has no reasoning level',
    });
    expect(refused({ model: "gemini-3.1-pro", reasoning: "none" }).message).toBe(
      'model "gemini-3.1-pro" has no reasoning level',
    );
  });

  plain("a level the model does not offer is refused naming the ones it does", () => {
    expect(refused({ model: "grok-4.6", reasoning: "max" })).toMatchObject({
      model: "grok-4.6",
      message: 'model "grok-4.6" has no reasoning level "max"; it has low, medium, high, xhigh',
    });
    expect(refused({ model: "gemini-3.8-flash", reasoning: "xhigh" }).message).toBe(
      'model "gemini-3.8-flash" has no reasoning level "xhigh"; it has low, medium, high',
    );
    expect(refused({ model: "grok-4.6", reasoning: "none", fast: true }).message).toBe(
      'model "grok-4.6" has no reasoning level "none"; it has low, medium, high, xhigh',
    );
  });

  plain("the model is checked first, then reasoning, then fast", () => {
    expect(refused({ model: "nope", reasoning: "max", fast: true }).message).toBe(
      'unknown model "nope"',
    );
    expect(refused({ model: "composer-2.5", reasoning: "max", fast: true }).message).toBe(
      'model "composer-2.5" has no reasoning level',
    );
  });
});

describe("CursorAgents.prompt happy path", () => {
  it.effect("returns the agent id and records the prompt text and the choice", () =>
    Effect.gen(function* () {
      const cursor = FakeCursor.fakeCursor({ agentId: "bc-42" });
      const created = yield* prompt("Review Linear ticket OLI-42 and complete your task.", {
        model: "grok-4.6",
        reasoning: "xhigh",
        fast: true,
      }).pipe(Effect.provide(cursor.layer));
      expect(created).toEqual({ agentId: "bc-42" });
      expect(cursor.calls).toEqual([
        {
          text: "Review Linear ticket OLI-42 and complete your task.",
          choice: { model: "grok-4.6", reasoning: "xhigh", fast: true },
        },
      ]);
    }),
  );

  it.effect("without a choice the agent starts on the default", () =>
    Effect.gen(function* () {
      const cursor = FakeCursor.fakeCursor();
      yield* prompt("hello").pipe(Effect.provide(cursor.layer));
      expect(cursor.calls).toEqual([{ text: "hello", choice: undefined }]);
    }),
  );

  plain("kicks off on the repository and links the agent by id", () => {
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
      expect(error).toMatchObject({ message: "Invalid API key", retryable: false });
    }),
  );

  it.effect("surfaces a model the catalog refuses as ModelUnavailable, before any agent", () =>
    Effect.gen(function* () {
      const failure = Errors.ModelUnavailable.make({
        model: "grok-9",
        message: 'unknown model "grok-9"',
      });
      const cursor = FakeCursor.fakeCursor({ failure });
      const error = yield* Effect.flip(prompt("hello", { model: "grok-9" })).pipe(
        Effect.provide(cursor.layer),
      );
      expect(error).toBe(failure);
    }),
  );

  plain("classifies a thrown SDK error by its message and retry flag", () => {
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

  plain("falls back to a fixed message for a thrown value without one", () => {
    const failure = Cursor.cursorAgentFailed("boom");
    expect(failure).toMatchObject({
      message: "cursor: agent request failed",
      retryable: false,
      cause: "boom",
    });
  });
});
