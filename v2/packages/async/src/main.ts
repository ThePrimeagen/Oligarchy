import * as jarl from "jarl";

// Stopped because a signal aborted. When the signal's own reason is an Aborted (the app's is),
// that one comes back, so its message says why.
export const Aborted = jarl.error.define("Aborted");
export type Aborted = InstanceType<typeof Aborted>;

export const TimedOut = jarl.error.define("TimedOut");
export type TimedOut = InstanceType<typeof TimedOut>;

const abortedBy = (signal: AbortSignal): Aborted =>
  jarl.error.is(signal.reason, Aborted) ? signal.reason : new Aborted("aborted");

// A call, not a property read, so TypeScript does not keep `aborted` narrowed across an await.
const isAborted = (signal: AbortSignal | undefined): signal is AbortSignal =>
  signal?.aborted === true;

// Ok after delay milliseconds; Aborted as soon as signal aborts, and at once if it already has.
export const sleep = (delay: number, signal: AbortSignal): Promise<jarl.Result<void, Aborted>> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(jarl.err(abortedBy(signal)));
      return;
    }
    const stop = () => {
      clearTimeout(timer);
      resolve(jarl.err(abortedBy(signal)));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve(jarl.ok(undefined));
    }, delay);
    signal.addEventListener("abort", stop, { once: true });
  });

// count is the most times fn is called. repeat returns whatever fn returns.
// An error is tried again while a call remains and errorFilter is missing or
// returns true. false returns that error and does not use the rest of the count.
// delay is the wait before each call after the first; signal aborting ends the
// wait, and the calls, with Aborted.
export const repeat = <A extends readonly unknown[], T, E>(
  fn: (...args: A) => Promise<jarl.Result<T, E>>,
  count: number,
  options: {
    readonly errorFilter?: (error: E) => boolean;
    readonly delay?: number;
    readonly signal?: AbortSignal;
  } = {},
): ((...args: A) => Promise<jarl.Result<T, E | Aborted>>) => {
  return async (...args) => {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("repeat count must be at least 1");
    }
    const { signal, delay, errorFilter } = options;
    if (isAborted(signal)) {
      return jarl.err(abortedBy(signal));
    }
    let result = await fn(...args);
    for (let made = 1; made < count && !result.ok; made += 1) {
      if (errorFilter !== undefined && !errorFilter(result.error)) {
        return result;
      }
      // Without a delay the next call follows at once, with no timer between them.
      if (delay !== undefined) {
        const slept = await sleep(delay, signal ?? new AbortController().signal);
        if (!slept.ok) {
          return slept;
        }
      } else if (isAborted(signal)) {
        return jarl.err(abortedBy(signal));
      }
      result = await fn(...args);
    }
    return result;
  };
};

// Calls fn every interval milliseconds, each interval counted from when the last call ended, so
// two calls never run at once. Settles once signal aborts and the call in flight has returned.
export const tick = async (
  fn: (signal: AbortSignal) => unknown,
  interval: number,
  signal: AbortSignal,
): Promise<void> => {
  for (;;) {
    const slept = await sleep(interval, signal);
    if (!slept.ok) {
      return;
    }
    try {
      await fn(signal);
    } catch {
      // A throw ends that call, not the ticking.
    }
  }
};

// Gives fn a deadline. fn's signal aborts delay milliseconds from now, or when signal aborts, with
// signal's reason. The answer is fn's, or TimedOut at the deadline for an fn still running.
export const timeout = <T, E>(
  fn: (signal: AbortSignal) => Promise<jarl.Result<T, E>>,
  delay: number,
  signal: AbortSignal = new AbortController().signal,
): Promise<jarl.Result<T, E | TimedOut>> =>
  new Promise((resolve, reject) => {
    const inner = new AbortController();
    const forward = () => inner.abort(signal.reason);
    let settled = false;
    // True for the first answer only; every later one, a late throw from fn included, is dropped.
    const first = (): boolean => {
      if (settled) {
        return false;
      }
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", forward);
      return true;
    };
    const timer = setTimeout(() => {
      const timedOut = new TimedOut(`timed out after ${String(delay)} ms`);
      inner.abort(timedOut);
      if (first()) {
        resolve(jarl.err(timedOut));
      }
    }, delay);
    if (signal.aborted) {
      forward();
    } else {
      signal.addEventListener("abort", forward, { once: true });
    }
    fn(inner.signal).then(
      (result) => {
        if (first()) {
          resolve(result);
        }
      },
      (caught: unknown) => {
        if (first()) {
          reject(caught);
        }
      },
    );
  });
