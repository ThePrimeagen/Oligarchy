import { Effect } from "effect";
import * as Cli from "../cli.ts";
import * as Errors from "../shared/errors.ts";

export const BIN = "opencode";

export const run = (prompt: string) =>
  Cli.run(BIN, ["run", prompt]).pipe(
    Effect.mapError((error) => Errors.RunFailed.make({ message: error.message, cause: error })),
  );
