import type { ModelSelection } from "@cursor/sdk";
import { Effect, Layer } from "effect";
import * as Cursor from "../../src/ctrl/cursor.ts";
import type * as Errors from "../../src/shared/errors.ts";

export type PromptCall = {
  readonly text: string;
  readonly model: ModelSelection | undefined;
};

export type FakeCursor = {
  readonly calls: Array<PromptCall>;
  readonly layer: Layer.Layer<Cursor.CursorAgents>;
};

export const DEFAULT_AGENT_ID = "bc-11111111-1111-4111-8111-111111111111";

// A CursorAgents that records every prompt and answers with a scripted agent id or failure.
export const fakeCursor = (
  script: {
    readonly agentId?: string;
    readonly failure?: Errors.CursorAgentFailed;
  } = {},
): FakeCursor => {
  const calls: Array<PromptCall> = [];
  const service: Cursor.CursorAgentsService = {
    prompt: (text, model) =>
      Effect.suspend(() => {
        calls.push({ text, model });
        return script.failure === undefined
          ? Effect.succeed({ agentId: script.agentId ?? DEFAULT_AGENT_ID })
          : Effect.fail(script.failure);
      }),
  };
  return { calls, layer: Layer.succeed(Cursor.CursorAgents)(service) };
};
