import * as Async from "@oligarchy/async";
import * as Linear from "@oligarchy/linear";
import * as jarl from "jarl";

// The wait before a read Linear did not answer is asked again.
export const READ_AGAIN_MS = 2_000;

const NEVER = new AbortController().signal;

// A Linear read a job makes (a board column, the team a ticket is filed on). One Linear did not
// answer is asked once more, a moment later, rather than failing the caller. Not a write: one
// that landed but whose answer was lost would be sent over newer state.
export const linearRead = async <R extends jarl.Result<unknown, unknown>>(
  read: () => Promise<R>,
): Promise<R> => {
  const first = await read();
  if (first.ok || !Linear.retryable(first.error)) {
    return first;
  }
  await Async.sleep(READ_AGAIN_MS, NEVER);
  return read();
};
