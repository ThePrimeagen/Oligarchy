import { Agent, Cursor, type ModelListItem, type ModelSelection } from "@cursor/sdk";
import { Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import * as ExternalFailure from "../external-failure.ts";
import * as Agents from "../shared/agents.ts";
import type * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

export const REPOSITORY = "https://github.com/ThePrimeagen/Oligarchy";

export const agentUrl = (agentId: string): string => `https://cursor.com/agents/${agentId}`;

// What a Cursor agent runs on when no model is asked for: grok-4.6 at effort high, running fast.
export const DEFAULT_MODEL: Domain.ModelChoice = {
  model: "grok-4.6",
  reasoning: "high",
  fast: true,
};

// The catalog as `Cursor.models.list()` answers it: each model with the parameters it takes.
export type Catalog = ReadonlyArray<ModelListItem>;

// Every vendor has a knob for how hard the model thinks; these are the names the catalog uses.
const REASONING_PARAMS = ["effort", "reasoning", "reasoning_effort"];

const unavailable = (model: string, message: string): Errors.ModelUnavailable =>
  Errors.ModelUnavailable.make({ model, message });

// Says a choice in the vendor's own params, against what the catalog says the model takes: the
// model must be listed (by id or alias), a reasoning level must be one it offers, and fast needs
// the switch. What is not asked for is not sent, so the vendor's default stands for it.
export const select = (
  choice: Domain.ModelChoice,
  catalog: Catalog,
): Result.Result<ModelSelection, Errors.ModelUnavailable> => {
  const listed = catalog.find(
    (entry) => entry.id === choice.model || entry.aliases?.includes(choice.model) === true,
  );
  if (listed === undefined) {
    return Result.fail(unavailable(choice.model, `unknown model "${choice.model}"`));
  }
  const parameters = listed.parameters ?? [];
  const params: Array<{ readonly id: string; readonly value: string }> = [];
  if (choice.reasoning !== undefined) {
    const reasoning = parameters.find((parameter) => REASONING_PARAMS.includes(parameter.id));
    if (reasoning === undefined) {
      return Result.fail(
        unavailable(choice.model, `model "${choice.model}" has no reasoning level`),
      );
    }
    const offered = reasoning.values.map((entry) => entry.value);
    // Older GPT models spell our xhigh as extra-high; the refusal lists what can be asked for,
    // so it says xhigh there.
    const level =
      offered.find((value) => value === choice.reasoning) ??
      (choice.reasoning === "xhigh" ? offered.find((value) => value === "extra-high") : undefined);
    if (level === undefined) {
      const levels = offered.map((value) => (value === "extra-high" ? "xhigh" : value));
      return Result.fail(
        unavailable(
          choice.model,
          `model "${choice.model}" has no reasoning level "${choice.reasoning}"; it has ${levels.join(", ")}`,
        ),
      );
    }
    params.push({ id: reasoning.id, value: level });
  }
  if (choice.fast !== undefined) {
    if (!parameters.some((parameter) => parameter.id === "fast")) {
      return Result.fail(unavailable(choice.model, `model "${choice.model}" has no fast mode`));
    }
    params.push({ id: "fast", value: String(choice.fast) });
  }
  return Result.succeed({ id: choice.model, params });
};

// The SDK's errors carry `isRetryable` as an own field; anything else thrown is terminal.
const retryFlag = Schema.decodeUnknownOption(Schema.Struct({ isRetryable: Schema.Boolean }));

export const agentFailed = (thrown: unknown): Errors.AgentFailed =>
  Errors.AgentFailed.make({
    message: ExternalFailure.describeThrowable(thrown, "cursor: agent request failed"),
    retryable: Option.match(retryFlag(thrown), {
      onNone: () => false,
      onSome: (found) => found.isRetryable,
    }),
    cause: thrown,
  });

// Cursor cloud agents: one created on the repository per prompt, watched on cursor.com.
export const layer = (apiKey: Redacted.Redacted): Layer.Layer<Agents.Agents> =>
  Layer.succeed(Agents.Agents)(
    Agents.Agents.of({
      defaultModel: DEFAULT_MODEL,
      // The catalog is asked each time: a choice is refused here, with what the model does take,
      // rather than by the backend once the agent exists. send resolves once the cloud run
      // exists; the agent keeps working after close().
      prompt: Effect.fn("Cursor.prompt")(function* (text: string, choice: Domain.ModelChoice) {
        const catalog = yield* Effect.tryPromise({
          try: () => Cursor.models.list({ apiKey: Redacted.value(apiKey) }),
          catch: agentFailed,
        });
        const model = yield* Effect.fromResult(select(choice, catalog));
        return yield* Effect.acquireUseRelease(
          Effect.tryPromise({
            try: () =>
              Agent.create({
                apiKey: Redacted.value(apiKey),
                model,
                cloud: { repos: [{ url: REPOSITORY }] },
              }),
            catch: agentFailed,
          }),
          (agent) =>
            Effect.tryPromise({ try: () => agent.send(text), catch: agentFailed }).pipe(
              Effect.map((): Agents.Started => ({
                agentId: agent.agentId,
                url: agentUrl(agent.agentId),
              })),
            ),
          (agent) =>
            Effect.sync(() => {
              agent.close();
            }),
        );
      }),
    }),
  );
