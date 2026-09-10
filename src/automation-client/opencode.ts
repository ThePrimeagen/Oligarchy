import { Effect } from "effect";
import * as Cli from "../cli.ts";
import * as Errors from "../shared/errors.ts";

export const BIN = "opencode";

export const run = (prompt: string, model: string) =>
  Cli.run(BIN, ["run", "--model", model, "--", prompt]).pipe(
    Effect.mapError((error) => Errors.RunFailed.make({ message: error.message, cause: error })),
  );
