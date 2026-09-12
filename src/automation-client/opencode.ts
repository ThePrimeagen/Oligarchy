export const BIN = "opencode";

// A run holds a dispatch slot for as long as it lives, and opencode sleeps out a provider's
// retry-after in silence: a daily quota answers with the seconds to midnight, and `opencode run`
// only exits on idle (anomalyco/opencode#40747). Drives have taken up to fifteen minutes,
// diagnoses under four; past the ceiling the run is killed and the job says so.
export const CEILING = "30 minutes";

// A headless run has nobody to answer a permission prompt. --auto approves the root session's
// asks, but a subagent the driver spawns asks into the void and the run deadlocks
// (anomalyco/opencode#36868), so the two permissions that default to ask are allowed outright
// for every session: a screenshot read outside the working directory, the same get-image
// repeated while a guest boots. Explicit denies still hold. OpenRouter streams have no timeout
// of their own (anomalyco/opencode#37580): three minutes without a first byte or a next chunk
// aborts the request, which opencode retries, rather than holding the run to its ceiling.
const CONFIG = JSON.stringify({
  permission: { external_directory: "allow", doom_loop: "allow" },
  provider: { openrouter: { options: { headerTimeout: 180_000, chunkTimeout: 180_000 } } },
});

export const ENV = { OPENCODE_CONFIG_CONTENT: CONFIG } as const;

export const args = (prompt: string, model: string): ReadonlyArray<string> => [
  "run",
  "--auto",
  "--model",
  model,
  "--",
  prompt,
];
