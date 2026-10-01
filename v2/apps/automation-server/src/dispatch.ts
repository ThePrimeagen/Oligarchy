import * as Async from "@oligarchy/async";

const INTERVAL_MS = 30_000;

// Hands the pending jobs to live automation clients every interval until signal aborts. It hands
// out none yet.
export const dispatch = (signal: AbortSignal): Promise<void> =>
  Async.tick(() => undefined, INTERVAL_MS, signal);
