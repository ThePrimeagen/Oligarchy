import { Context, Effect, type Fiber, Option, Ref } from "effect";
import type * as Children from "./children.ts";
import type * as Image from "./image.ts";
import type * as Readline from "./readline.ts";

// What the process hands the REPL: decided once in main.ts, faked by tests.
export type HostShape = {
  readonly execPath: string;
  readonly imageProtocol: Image.ImageProtocol;
  readonly input: Readline.Input;
  readonly output: Readline.Output;
  // Resolves when the process is asked to leave (SIGTERM or SIGHUP).
  readonly termination: Effect.Effect<void>;
};

export class Host extends Context.Service<Host, HostShape>()("@oligarchy/session/Host") {}

export type Following = {
  readonly id: string;
  readonly kill: Effect.Effect<void>;
  // Resolves once the child has exited and the screen is back.
  readonly closed: Effect.Effect<void>;
};

export type Session = {
  readonly serverUrl: string;
  readonly agentId: Ref.Ref<string>;
  readonly sessionId: Ref.Ref<Option.Option<string>>;
  readonly intentOpen: Ref.Ref<boolean>;
  readonly startInFlight: Ref.Ref<Option.Option<Fiber.Fiber<Children.ChildResult>>>;
  readonly following: Ref.Ref<Option.Option<Following>>;
};

// The proxy keys one session per agent id (agent_runs primary key), so every start
// mints a fresh id; later commands and the stop must use the id that booted the session.
export const freshAgentId: Effect.Effect<string> = Effect.sync(
  () => `session-${crypto.randomUUID()}`,
);

export const make = (serverUrl: string): Effect.Effect<Session> =>
  Effect.gen(function* () {
    return {
      serverUrl,
      agentId: yield* Ref.make(yield* freshAgentId),
      sessionId: yield* Ref.make(Option.none<string>()),
      intentOpen: yield* Ref.make(false),
      startInFlight: yield* Ref.make(Option.none<Fiber.Fiber<Children.ChildResult>>()),
      following: yield* Ref.make(Option.none<Following>()),
    };
  });
