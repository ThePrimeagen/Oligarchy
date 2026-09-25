import { Duration, Effect, FileSystem, Schema } from "effect";
import * as Contract from "@oligarchy/routes/contract";
import * as Render from "../observability/render.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

// The harness's configuration, the checked-in file beside the package. The
// OpenRouter token stays in the environment: a token key in this file is
// refused. There is no default. A missing or malformed file fails startup,
// and a bad field is named in the failure.
export const PATH = decodeURIComponent(new URL("../../oligarchy.json", import.meta.url).pathname);

// A request that never receives a first byte, or a next chunk, must fail
// before the run ceiling kills the whole job. Zero and Infinity do neither.
const PositiveDuration = Schema.DurationFromString.check(
  Schema.makeFilter(
    (duration: Duration.Duration) => Duration.isFinite(duration) && Duration.toMillis(duration) > 0,
    { message: "duration must be finite and greater than zero" },
  ),
).annotate({ identifier: "@oligarchy/harness/config/PositiveDuration" });

const Timeouts = Schema.Struct({
  header: PositiveDuration,
  chunk: PositiveDuration,
}).annotate({ identifier: "@oligarchy/harness/config/Timeouts" });

const Models = Schema.Struct({
  drive: Domain.ModelId,
  diagnose: Domain.ModelId,
  mint: Domain.ModelId,
}).annotate({ identifier: "@oligarchy/harness/config/Models" });

// OpenRouter's reasoning effort, and opencode's --variant for a diagnose.
export const Effort = Schema.Literals(["minimal", "low", "medium", "high", "xhigh"]).annotate({
  identifier: "@oligarchy/harness/config/Effort",
});
export type Effort = typeof Effort.Type;

const Reasoning = Schema.Struct({
  drive: Effort,
  diagnose: Effort,
  mint: Effort,
}).annotate({ identifier: "@oligarchy/harness/config/Reasoning" });

// A send-keys storm has to stop before the run ceiling. The count lives in the file.
const StepLimit = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1, { message: "stepLimit must be at least 1" }),
).annotate({ identifier: "@oligarchy/harness/config/StepLimit" });

// Knobs for the harness loop. A 429 or 5xx with no Retry-After waits defaultRetry.
const Harness = Schema.Struct({
  defaultRetry: PositiveDuration,
}).annotate({ identifier: "@oligarchy/harness/config/Harness" });

export class AppConfig extends Schema.Class<AppConfig>("@oligarchy/harness/config/AppConfig")({
  models: Models,
  reasoning: Reasoning,
  openRouterBaseUrl: Contract.ServerUrl,
  timeouts: Timeouts,
  runCeiling: PositiveDuration,
  stepLimit: StepLimit,
  harness: Harness,
}) {}

// Header is reported before chunk, the same order the file writes them.
const underCeiling = Schema.makeFilter((config: AppConfig) => {
  if (Duration.Order(config.timeouts.header, config.runCeiling) >= 0) {
    return { path: ["timeouts", "header"], issue: "must be shorter than runCeiling" };
  }
  if (Duration.Order(config.timeouts.chunk, config.runCeiling) >= 0) {
    return { path: ["timeouts", "chunk"], issue: "must be shorter than runCeiling" };
  }
  if (Duration.Order(config.harness.defaultRetry, config.runCeiling) >= 0) {
    return { path: ["harness", "defaultRetry"], issue: "must be shorter than runCeiling" };
  }
  return undefined;
});

const File = AppConfig.check(underCeiling);

const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.toCodecJson(File)), {
  onExcessProperty: "error",
});

const refused = (error: unknown): Errors.CommandError =>
  Errors.CommandError.make({ message: `${PATH}: ${Render.headline(error)}` });

export const parse = (text: string): Effect.Effect<AppConfig, Errors.CommandError> =>
  decodeFile(text).pipe(Effect.mapError(refused));

// Absent is a failure, not a default: a guessed model or ceiling would run the fleet on the wrong one.
export const load: Effect.Effect<AppConfig, Errors.CommandError, FileSystem.FileSystem> =
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const there = yield* fs.exists(PATH).pipe(Effect.mapError(refused));
    if (!there) {
      return yield* Errors.CommandError.make({ message: `${PATH}: file is missing` });
    }
    const text = yield* fs.readFileString(PATH).pipe(Effect.mapError(refused));
    return yield* parse(text);
  });
