import * as jarl from "jarl";

// count is the most times fn is called. An error is tried again while a call
// remains and errorFilter is missing or returns true. false returns that error
// and does not use the rest of the count.
export const repeat = <A extends readonly unknown[], T, E>(
  fn: (...args: A) => Promise<jarl.Result<T, E>>,
  count: number,
  errorFilter?: (error: E) => boolean,
): ((...args: A) => Promise<jarl.Result<T, E>>) => {
  return async (...args) => {
    let result: jarl.Result<T, E> | undefined;
    for (let made = 0; made < count; made++) {
      result = await fn(...args);
      if (result.ok) {
        return result;
      }
      const again = made + 1 < count && (errorFilter === undefined || errorFilter(result.error));
      if (!again) {
        return result;
      }
    }
    // count below 1 never enters the loop. There is no result to return.
    throw new Error("repeat count must be at least 1");
  };
};
