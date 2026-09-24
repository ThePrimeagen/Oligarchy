export const BIN = "./driver";

// A run holds a dispatch slot for as long as it lives. The driver stops itself at the
// run ceiling in oligarchy.json, which is this long; past it the client kills the child
// and the job says so, so a driver that ignores its own ceiling still frees the slot.
// A diagnose is not this program: it still runs under opencode.
export const CEILING = "1.5 hours";

// The driver appends one JSON line per step. /tmp exists on every host this process
// runs on, so the path does not depend on a data dir this client does not have.
export const debugLog = (testResultId: string): string =>
  `/tmp/oligarchy-driver-${testResultId}.jsonl`;

export const args = (input: {
  readonly prompt: string;
  readonly testDefinition: string;
  readonly testProof: string;
  readonly agentId: string;
  readonly serverUrl: string;
  readonly action: "drive" | "mint";
  readonly testResultId: string;
}): ReadonlyArray<string> => [
  "--action",
  input.action,
  "--prompt",
  input.prompt,
  "--test-definition",
  input.testDefinition,
  "--test-proof",
  input.testProof,
  "--agent-id",
  input.agentId,
  "--server-url",
  input.serverUrl,
  "--debug-log",
  debugLog(input.testResultId),
  "--test-result-id",
  input.testResultId,
];
