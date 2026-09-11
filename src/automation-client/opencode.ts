import { Effect } from "effect";
import * as Cli from "../cli.ts";
import * as Errors from "../shared/errors.ts";

export const BIN = "opencode";

export const args = (prompt: string): ReadonlyArray<string> => ["run", "--", prompt];

export const run = (prompt: string) =>
  Cli.run(BIN, args(prompt)).pipe(
    Effect.mapError((error) => Errors.RunFailed.make({ message: error.message, cause: error })),
  );
