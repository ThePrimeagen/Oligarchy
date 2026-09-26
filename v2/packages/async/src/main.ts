import * as jarl from "jarl";

// count is the most times fn is called. repeat returns whatever fn returns.
// An error is tried again while a call remains and errorFilter is missing or
// returns true. false returns that error and does not use the rest of the count.
export const repeat = <A extends readonly unknown[], T, E>(
  fn: (...args: A) => Promise<jarl.Result<T, E>>,
  count: number,
  errorFilter?: (error: E) => boolean,
): ((...args: A) => Promise<jarl.Result<T, E>>) => {
  return async (...args) => {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("repeat count must be at least 1");
    }
    let result = await fn(...args);
    for (let made = 1; made < count && !result.ok; made += 1) {
      if (errorFilter !== undefined && !errorFilter(result.error)) {
        return result;
      }
      result = await fn(...args);
    }
    return result;
  };
};

// Calls fn after every interval milliseconds. Cancel clears the pending timeout.
export const tick = (fn: () => unknown, interval: number): (() => void) => {
  let timer: ReturnType<typeof setTimeout>;
  function run() {
    try {
      fn();
    } catch {
      // A throw stays in this turn.
    }
    timer = setTimeout(run, interval);
  }
  timer = setTimeout(run, interval);
  return () => {
    clearTimeout(timer);
  };
};

// Calls fn once after delay milliseconds. Cancel clears that timeout.
export const sleep = (fn: () => unknown, delay: number): (() => void) => {
  function run() {
    try {
      fn();
    } catch {
      // A throw stays in this turn.
    }
  }
  const timer = setTimeout(run, delay);
  return () => {
    clearTimeout(timer);
  };
};
