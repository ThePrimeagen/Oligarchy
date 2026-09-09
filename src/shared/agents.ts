import { Context, type Effect } from "effect";
import type * as Domain from "./domain.ts";
import type * as Errors from "./errors.ts";

// An agent as the program that runs it knows it: its id, and the page to watch it on when the
// program has one (a Cursor cloud agent does; a local opencode run has only its session id).
export type Started = {
  readonly agentId: string;
  readonly url?: string;
};

// The one interface every way of spawning an agent implements: hand the text to an agent on the
// model chosen, and answer once the agent exists. The default is the program's own, so "no model
// asked for" means the same thing to the caller labelling the prompt and to the program running it.
export type AgentsService = {
  readonly defaultModel: Domain.ModelChoice;
  readonly prompt: (
    text: string,
    choice: Domain.ModelChoice,
  ) => Effect.Effect<Started, Errors.ModelUnavailable | Errors.AgentFailed>;
};

export class Agents extends Context.Service<Agents, AgentsService>()("@oligarchy/shared/Agents") {}
