import { Effect } from "effect";
import * as Cli from "../cli.ts";
import * as Errors from "../shared/errors.ts";

export const BIN = "opencode";

// A run holds a dispatch slot for as long as it lives, and opencode sleeps out a provider's
// retry-after in silence: a daily quota answers with the seconds to midnight, and `opencode run`
// only exits on idle (anomalyco/opencode#40747). Drives have taken up to fifteen minutes,
// diagnoses under four; past the ceiling the run is killed and the job says so.
export const CEILING = "30 minutes";

// --auto: a headless run has nobody to answer a permission prompt. Without it opencode rejects
// the call that asked (a screenshot read outside the working directory, the same get-image
// repeated while a guest boots) and exits 0 having said nothing. Explicit denies still hold.
export const run = (prompt: string, model: string) =>
  Cli.run(BIN, ["run", "--auto", "--model", model, "--", prompt]).pipe(
    Effect.mapError((error) => Errors.RunFailed.make({ message: error.message, cause: error })),
    Effect.timeoutOrElse({
      duration: CEILING,
      orElse: () => Errors.RunFailed.make({ message: `opencode run exceeded ${CEILING}` }),
    }),
  );
