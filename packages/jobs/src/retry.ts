import { Effect, Schedule } from "effect";
import type * as LinearErrors from "@oligarchy/linear/errors";

// A Linear read a job makes (a board column, the team a ticket is filed on). A failure Linear
// says is worth asking again is asked once more, a moment later, rather than failing the caller.
// Not a write: one that landed but whose answer was lost would be sent over newer state.
export const linearRead = <A, R>(read: Effect.Effect<A, LinearErrors.LinearError, R>) =>
  read.pipe(
    Effect.retry({
      times: 1,
      schedule: Schedule.spaced("2 seconds"),
      while: (error) => error.retryable === true,
    }),
  );
