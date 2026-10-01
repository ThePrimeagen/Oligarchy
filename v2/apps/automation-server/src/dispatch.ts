import * as Async from "@oligarchy/async";

// Hands the pending jobs to live automation clients every interval until signal aborts. It hands
// out none yet.
export const dispatch = (
  options: { readonly interval: number },
  signal: AbortSignal,
): Promise<void> => Async.tick(() => undefined, options.interval, signal);
