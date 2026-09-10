import { Effect } from "effect";
import * as Cli from "../cli.ts";
import * as Errors from "../shared/errors.ts";

export const BIN = "opencode";

// --auto: a headless run has nobody to answer a permission prompt. Without it opencode rejects
// the call that asked (a screenshot read outside the working directory, the same get-image
// repeated while a guest boots) and exits 0 having said nothing. Explicit denies still hold.
export const run = (prompt: string, model: string) =>
  Cli.run(BIN, ["run", "--auto", "--model", model, "--", prompt]).pipe(
    Effect.mapError((error) => Errors.RunFailed.make({ message: error.message, cause: error })),
  );
