import { Duration } from "effect";
import * as History from "./history.ts";

export type StopReason = "result-closed" | "step-limit" | "model-stopped" | "ceiling";

export type Decision =
  | { readonly _tag: "continue" }
  | { readonly _tag: "stop"; readonly reason: StopReason };

export type Input = {
  readonly history: History.History;
  // The harness marks a result started and completed, and opens intents. The
  // model does not. This is that mark: the result is no longer open.
  readonly resultClosed: boolean;
  readonly stepLimit: number;
  readonly elapsed: Duration.Duration;
  readonly ceiling: Duration.Duration;
};

// stepLimit counts tool calls. It exists so a send-keys storm stops before the run ceiling.
const toolCalls = (history: History.History): number => {
  let count = 0;
  for (const message of history.messages) {
    if (message.role === "assistant") {
      count += message.toolCalls.length;
    }
  }
  return count;
};

const modelStopped = (history: History.History): boolean => {
  const last = history.messages[history.messages.length - 1];
  if (last === undefined) {
    return false;
  }
  return last.role === "assistant" && last.toolCalls.length === 0;
};

const stop = (reason: StopReason): Decision => ({ _tag: "stop", reason });

// The first match is the reason a late check reports. A closed result is the
// harness finishing the run; the step limit is the storm; the model stopping
// is it choosing to end; the ceiling is the clock.
export const decide = (input: Input): Decision => {
  if (input.resultClosed) {
    return stop("result-closed");
  }
  if (toolCalls(input.history) >= input.stepLimit) {
    return stop("step-limit");
  }
  if (modelStopped(input.history)) {
    return stop("model-stopped");
  }
  if (Duration.Order(input.elapsed, input.ceiling) >= 0) {
    return stop("ceiling");
  }
  return { _tag: "continue" };
};
