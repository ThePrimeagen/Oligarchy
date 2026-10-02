import type * as OpenRouter from "@oligarchy/openrouter";
import type * as Qemu from "@oligarchy/qemu-http-tools";
import type * as Stores from "@oligarchy/stores";
import type * as jarl from "jarl";

export type Answer<T, E> = Promise<jarl.Result<T, E>>;

// The job's pinned definition and test run; neither a caller's prompt nor a suite supplies the
// ISO, instructions or boot mode.
export type JobHarnessData = {
  readonly jobId: string;
  readonly runId: string;
  readonly action: Stores.Tests.JobAction;
  readonly name: string;
  readonly description: string;
  readonly instruction: string;
  readonly proof: string;
  readonly iso: string;
  readonly serverUrl: string;
  readonly resume: boolean;
};

export type Previous = {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
};

// What the model is told of the run so far.
export type Turn = {
  readonly progress: string;
  readonly response?: string;
  readonly previous?: Previous;
};

// One thing done under a step: a guest move and what came of it, or a reply the harness refused.
export type Action =
  | {
      readonly kind: "move";
      readonly name: string;
      readonly reason: string;
      readonly arguments: Readonly<Record<string, unknown>>;
      readonly outcome: string;
    }
  | { readonly kind: "refused"; readonly outcome: string };

// One ActionList line, its intent and everything done under it, oldest first.
export type Step = {
  readonly step: number;
  readonly intent: string;
  readonly actions: Array<Action>;
};

// The job's guest, and the lines of the open step the prompt shows: its intent, then its newest
// actions.
export type Options = Qemu.Options & {
  readonly recentActions: number;
};

// A guest move carries only its tool's own arguments; step and reason are taken out.
export type GuestMove = {
  readonly kind: "guest";
  readonly step: number;
  readonly reason: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
};

export type Move = { readonly kind: "done" } | GuestMove;

export type Ask = {
  readonly model: string;
  readonly reasoning: OpenRouter.Effort;
  readonly deadline: number;
};

export type End = { readonly status: Qemu.StopStatus; readonly reason?: string };
