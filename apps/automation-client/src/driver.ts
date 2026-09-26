export const BIN = "./driver";

// A run holds a dispatch slot for as long as it lives. The driver stops itself at the
// run ceiling in oligarchy.json, which is this long; past it the client kills the child
// and the job says so, so a driver that ignores its own ceiling still frees the slot.
// A diagnose is not this program: it still runs under opencode.
export const CEILING = "1.5 hours";

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
