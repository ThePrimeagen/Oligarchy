import { Effect } from "effect";

// The process environment the live chain reads, set for one body and put back after; a name
// mapped to undefined is held unset, since the machine running the tests may have it.
export const withProcessEnv = <A, E, R>(
  values: Record<string, string | undefined>,
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const before = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      return before;
    }),
    () => self,
    (before) =>
      Effect.sync(() => {
        for (const [key, value] of before) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }),
  );
