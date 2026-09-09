import { Effect, Layer } from "effect";
import * as Agents from "../../src/shared/agents.ts";
import type * as Domain from "../../src/shared/domain.ts";
import type * as Errors from "../../src/shared/errors.ts";

export type PromptCall = {
  readonly text: string;
  readonly choice: Domain.ModelChoice;
};

export type FakeAgents = {
  readonly calls: Array<PromptCall>;
  readonly layer: Layer.Layer<Agents.Agents>;
};

export const DEFAULT_AGENT_ID = "bc-11111111-1111-4111-8111-111111111111";

// What a Cursor cloud agent answers: its id and the page to watch it on.
export const cursorStarted = (agentId: string): Agents.Started => ({
  agentId,
  url: `https://cursor.com/agents/${agentId}`,
});

// The default is Cursor's, as it was: grok-4.6 at effort high, running fast.
export const CURSOR_DEFAULT: Domain.ModelChoice = {
  model: "grok-4.6",
  reasoning: "high",
  fast: true,
};

// An Agents that records every prompt and answers with a scripted start or failure; the started
// agent is a Cursor one unless the script says otherwise.
export const fakeAgents = (
  script: {
    readonly started?: Agents.Started;
    readonly failure?: Errors.AgentFailed | Errors.ModelUnavailable;
    readonly defaultModel?: Domain.ModelChoice;
  } = {},
): FakeAgents => {
  const calls: Array<PromptCall> = [];
  const service = Agents.Agents.of({
    defaultModel: script.defaultModel ?? CURSOR_DEFAULT,
    prompt: (text, choice) =>
      Effect.suspend(() => {
        calls.push({ text, choice });
        return script.failure === undefined
          ? Effect.succeed(script.started ?? cursorStarted(DEFAULT_AGENT_ID))
          : Effect.fail(script.failure);
      }),
  });
  return { calls, layer: Layer.succeed(Agents.Agents)(service) };
};
