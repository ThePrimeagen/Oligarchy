import { Duration } from "effect";

export const BIN = "./driver";

// A run holds a dispatch slot for as long as it lives. The driver stops itself at the run
// ceiling in oligarchy.json, but checks it between turns: past it, the turn in flight (one model
// request, up to its header timeout) still ends, then the driver stops the guest and closes the
// result failed with the ceiling, and the diagnosis judges it. The client kills the child only
// this long after the run ceiling, so that end lands and only a driver that ignores its own
// ceiling is killed, and the job says so. A diagnose is not this program: it runs under opencode.
export const GRACE = Duration.minutes(10);

export const ceiling = (runCeiling: Duration.Duration): Duration.Duration =>
  Duration.sum(runCeiling, GRACE);

// The driver appends one JSON line per step. /tmp exists on every host this process
// runs on, so the path does not depend on a data dir this client does not have.
// The agent id is the ticket, which is the only identity this process is given.
export const debugLog = (agentId: string): string => `/tmp/oligarchy-driver-${agentId}.jsonl`;

export const args = (input: {
  readonly prompt: string;
  readonly agentId: string;
  readonly action: "drive" | "mint";
}): ReadonlyArray<string> => [
  "--action",
  input.action,
  "--prompt",
  input.prompt,
  "--agent-id",
  input.agentId,
  "--debug-log",
  debugLog(input.agentId),
];
