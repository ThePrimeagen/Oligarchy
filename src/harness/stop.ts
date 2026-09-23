import { Duration, Result } from "effect";
import * as History from "./history.ts";
import * as Tools from "./tools.ts";

export type StopReason = "result-closed" | "step-limit" | "model-stopped" | "ceiling";

export type Decision =
  | { readonly _tag: "continue" }
  | { readonly _tag: "stop"; readonly reason: StopReason };

export type Input = {
  readonly history: History.History;
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

const closedBy = (call: History.ToolCall, exitCode: number): boolean => {
  const line = Tools.commandLine({ name: call.name, arguments: call.arguments });
  if (Result.isFailure(line)) {
    return false;
  }
  return Tools.closesResult(line.success, exitCode);
};

// A drive or mint is done when ./ctrl test-results exits 0. Until then the result
// is pending or running, and an exit with it still open is the driver quitting.
// A diagnose's result was closed before the diagnose was queued, so this is the
// test result alone. Ids are unique only within a turn, so a result pairs with
// the call it follows: a later turn that reuses an id must not inherit an earlier exit.
const resultClosed = (history: History.History): boolean => {
  for (let i = 0; i < history.messages.length; i++) {
    const message = history.messages[i];
    if (message === undefined || message.role !== "assistant") {
      continue;
    }
    let callIndex = 0;
    for (let j = i + 1; j < history.messages.length; j++) {
      const next = history.messages[j];
      if (next === undefined || next.role === "assistant") {
        break;
      }
      if (next.role !== "tool") {
        continue;
      }
      const call = message.toolCalls[callIndex];
      callIndex++;
      if (call === undefined || next.exitCode === null || next.toolCallId !== call.id) {
        continue;
      }
      if (closedBy(call, next.exitCode)) {
        return true;
      }
    }
  }
  return false;
};

const stop = (reason: StopReason): Decision => ({ _tag: "stop", reason });

// The first match is the reason a late check reports. A closed result is the
// driver finishing; the step limit is the storm; the model stopping is it
// choosing to end; the ceiling is the clock.
export const decide = (input: Input): Decision => {
  if (resultClosed(input.history)) {
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
