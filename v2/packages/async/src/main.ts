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

// Calls fn after every interval milliseconds. The returned function stops it.
export const tick = (fn: () => unknown, interval: number): (() => void) => {
  const id = setInterval(fn, interval);
  return () => {
    clearInterval(id);
  };
};
