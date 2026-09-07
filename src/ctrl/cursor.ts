import { Agent, type ModelSelection } from "@cursor/sdk";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import * as ExternalFailure from "../external-failure.ts";
import * as Errors from "../shared/errors.ts";

export type Model = ModelSelection;

export const REPOSITORY = "https://github.com/ThePrimeagen/Oligarchy";

export const GROK_4_6_FAST_XHIGH: Model = {
  id: "grok-4.6",
  params: [
    { id: "effort", value: "xhigh" },
    { id: "fast", value: "true" },
  ],
};

export const agentUrl = (agentId: string): string => `https://cursor.com/agents/${agentId}`;

// The one string a driver is told to record with `ctrl test start --model`: the id, then the
// effort value, then `fast` when set, then any other param as `id-value` — the shape cursor-agent
// spells its own slugs (`gpt-5.6-luna-none-fast`), so local and cloud drivers record alike.
export const modelLabel = (model: Model): string =>
  [
    model.id,
    ...(model.params ?? []).flatMap((param) => {
      if (param.id === "effort") return [param.value];
      if (param.id === "fast") return param.value === "true" ? ["fast"] : [];
      return [`${param.id}-${param.value}`];
    }),
  ].join("-");

export type CursorAgentsService = {
  readonly prompt: (
    text: string,
    model?: Model,
  ) => Effect.Effect<{ readonly agentId: string }, Errors.CursorAgentFailed>;
};

// The SDK's errors carry `isRetryable` as an own field; anything else thrown is terminal.
const retryFlag = Schema.decodeUnknownOption(Schema.Struct({ isRetryable: Schema.Boolean }));

export const cursorAgentFailed = (thrown: unknown): Errors.CursorAgentFailed =>
  Errors.CursorAgentFailed.make({
    message: ExternalFailure.describeThrowable(thrown, "cursor: agent request failed"),
    retryable: Option.match(retryFlag(thrown), {
      onNone: () => false,
      onSome: (found) => found.isRetryable,
    }),
    cause: thrown,
  });

const makeCursorAgents = (apiKey: Redacted.Redacted): Effect.Effect<CursorAgentsService> =>
  Effect.succeed({
    // send resolves once the cloud run exists; the agent keeps working after close().
    prompt: Effect.fn("CursorAgents.prompt")(function* (text: string, model?: Model) {
      return yield* Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () =>
            Agent.create({
              apiKey: Redacted.value(apiKey),
              model: model ?? GROK_4_6_FAST_XHIGH,
              cloud: { repos: [{ url: REPOSITORY }] },
            }),
          catch: cursorAgentFailed,
        }),
        (agent) =>
          Effect.tryPromise({ try: () => agent.send(text), catch: cursorAgentFailed }).pipe(
            Effect.as({ agentId: agent.agentId }),
          ),
        (agent) =>
          Effect.sync(() => {
            agent.close();
          }),
      );
    }),
  } satisfies CursorAgentsService);

export class CursorAgents extends Context.Service<CursorAgents>()("@oligarchy/ctrl/CursorAgents", {
  make: makeCursorAgents,
}) {
  static readonly layer = (apiKey: Redacted.Redacted): Layer.Layer<CursorAgents> =>
    Layer.effect(this)(this.make(apiKey));
}
