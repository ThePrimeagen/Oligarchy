// Settles once signal aborts, or at once if it already has. An app's main awaits its own signal
// with it, to run until it is stopped.
export const waitForAbort = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
