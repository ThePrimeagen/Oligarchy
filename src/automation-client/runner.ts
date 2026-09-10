import { Context, Effect, type Scope } from "effect";
import type * as Errors from "../shared/errors.ts";

export type RunInput = {
  readonly key: string;
  readonly prompt: string;
};

export type RunOutcome = {
  readonly session: string;
  readonly text: string;
};

export type Shape = {
  readonly name: string;
  readonly model: string;
  /** @effect-expect-leaking Scope */
  readonly run: (input: RunInput) => Effect.Effect<RunOutcome, Errors.RunFailed, Scope.Scope>;
};

export class AgentRunner extends Context.Service<AgentRunner, Shape>()(
  "@oligarchy/automation-client/AgentRunner",
) {}
