import * as jarl from "jarl";

// Stopped because a signal aborted. When the signal's own reason is an Aborted (the app's is),
// that one comes back, so its message says why.
export const Aborted = jarl.error.define("Aborted");
export type Aborted = InstanceType<typeof Aborted>;

export const TimedOut = jarl.error.define("TimedOut");
export type TimedOut = InstanceType<typeof TimedOut>;

const abortedBy = (signal: AbortSignal): Aborted =>
  jarl.error.is(signal.reason, Aborted) ? signal.reason : new Aborted("aborted");

// What a helper waits on when it was given no signal: one that never aborts.
const NEVER = new AbortController().signal;

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

// What an error calls for: call again after delay milliseconds, or stop and hand the error back.
export type Decision = { readonly retry: true; readonly delay: number } | { readonly retry: false };

const AGAIN: Decision = { retry: true, delay: 0 };

// count is the most times fn is called, whatever retry decides. repeat returns whatever fn
// returns. After an error, while a call remains, retry decides; with no retry every error is
// called again at once. signal aborting ends a wait, and the calls, with Aborted.
export const repeat = <A extends readonly unknown[], T, E>(
  fn: (...args: A) => Promise<jarl.Result<T, E>>,
  count: number,
  options: {
    readonly retry?: (error: E) => Decision;
    readonly signal?: AbortSignal;
  } = {},
): ((...args: A) => Promise<jarl.Result<T, E | Aborted>>) => {
  return async (...args) => {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("repeat count must be at least 1");
    }
    const { retry, signal = NEVER } = options;
    if (signal.aborted) {
      return jarl.err(abortedBy(signal));
    }
    let result = await fn(...args);
    for (let made = 1; made < count && jarl.is_err(result); made += 1) {
      const decision = retry === undefined ? AGAIN : retry(result.error);
      if (!decision.retry) {
        return result;
      }
      const slept = await sleep(decision.delay, signal);
      if (!slept.ok) {
        return slept;
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

// Gives fn a deadline. fn's signal aborts ms milliseconds from now, or when signal aborts, with
// signal's reason. The answer is fn's, or TimedOut at the deadline for an fn still running.
export const timeout = <T, E>(
  fn: (signal: AbortSignal) => Promise<jarl.Result<T, E>>,
  options: { readonly ms: number; readonly signal?: AbortSignal },
): Promise<jarl.Result<T, E | TimedOut>> =>
  new Promise((resolve, reject) => {
    const { ms, signal = NEVER } = options;
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
      const timedOut = new TimedOut(`timed out after ${String(ms)} ms`);
      inner.abort(timedOut);
      if (first()) {
        resolve(jarl.err(timedOut));
      }
    }, ms);
    if (signal.aborted) {
      forward();
    } else {
      signal.addEventListener("abort", forward, { once: true });
    }
    // A throw before fn returns its promise takes the rejection's path, so it cleans up too.
    new Promise<jarl.Result<T, E>>((answer) => answer(fn(inner.signal))).then(
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
