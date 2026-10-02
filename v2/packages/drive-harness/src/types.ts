import type * as Http from "@oligarchy/http";
import type * as OpenRouter from "@oligarchy/openrouter";
import type * as Qemu from "@oligarchy/qemu-http-tools";
import type * as Stores from "@oligarchy/stores";
import type * as jarl from "jarl";
import type * as Moves from "./move.ts";

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

// What the model is told of the run so far.
export type Turn = {
  readonly reasons: string;
  readonly response?: string;
  readonly previous?: {
    readonly name: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  };
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
  // The system prompt, as `prompt` rendered it for this turn.
  readonly prompt: string;
  // The last screenshot, PNG, when the last move took one.
  readonly screen?: Uint8Array;
  readonly signal?: AbortSignal;
};

export type End = { readonly status: Qemu.StopStatus; readonly reason?: string };

// One drive or setup job's steps, in the order a driver takes them: load, start, then per model
// turn prompt, ask and act inside the step's intent, and finish. The loop's limits are the
// driver's.
export type DriveHarness = {
  readonly service: "driveHarness";
  readonly loadJobHarnessData: (jobId: string) => Stores.Tests.Found<JobHarnessData>;
  readonly start: (data: JobHarnessData) => Answer<void, Http.HttpFailure>;
  readonly openStep: (message: string) => Answer<void, Http.HttpFailure | Qemu.IntentOpen>;
  readonly closeStep: () => Answer<void, Http.HttpFailure>;
  readonly prompt: (data: JobHarnessData, turn: Turn) => string;
  readonly ask: (request: Ask) => Answer<Move, OpenRouter.Failure | Moves.ReplyInvalid>;
  readonly act: (move: GuestMove) => Answer<Qemu.Ran, Qemu.RunFailure>;
  // A setup that succeeded keeps its disk; anything else stops the guest with its status.
  readonly finish: (
    data: JobHarnessData,
    end: End,
  ) => Answer<void, Http.HttpFailure | Qemu.NotPoweredOff>;
};
