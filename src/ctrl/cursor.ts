import { Agent, Cursor, type ModelListItem, type ModelSelection } from "@cursor/sdk";
import { Context, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import * as ExternalFailure from "../external-failure.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

export const REPOSITORY = "https://github.com/ThePrimeagen/Oligarchy";

export const agentUrl = (agentId: string): string => `https://cursor.com/agents/${agentId}`;

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
    // Older GPT models spell our xhigh as extra-high.
    const level =
      offered.find((value) => value === choice.reasoning) ??
      (choice.reasoning === "xhigh" ? offered.find((value) => value === "extra-high") : undefined);
    if (level === undefined) {
      return Result.fail(
        unavailable(
          choice.model,
          `model "${choice.model}" has no reasoning level "${choice.reasoning}"; it has ${offered.join(", ")}`,
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

export type CursorAgentsService = {
  readonly prompt: (
    text: string,
    choice?: Domain.ModelChoice,
  ) => Effect.Effect<
    { readonly agentId: string },
    Errors.ModelUnavailable | Errors.CursorAgentFailed
  >;
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
    // The catalog is asked each time: a choice is refused here, with what the model does take,
    // rather than by the backend once the agent exists. send resolves once the cloud run exists;
    // the agent keeps working after close().
    prompt: Effect.fn("CursorAgents.prompt")(function* (
      text: string,
      choice: Domain.ModelChoice = Domain.DEFAULT_MODEL,
    ) {
      const catalog = yield* Effect.tryPromise({
        try: () => Cursor.models.list({ apiKey: Redacted.value(apiKey) }),
        catch: cursorAgentFailed,
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
