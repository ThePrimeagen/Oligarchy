import type * as jarl from "jarl";

// The wait before a read Linear did not answer is asked again.
export const READ_AGAIN_MS = 2_000;

// A Linear read a job makes (a board column, the team a ticket is filed on). One Linear did not
// answer is asked once more, a moment later, rather than failing the caller. Not a write: one
// that landed but whose answer was lost would be sent over newer state.
export const linearRead = async <R extends jarl.Result<unknown, unknown>>(
  _read: () => Promise<R>,
): Promise<R> => {
  throw new Error("not implemented");
};
