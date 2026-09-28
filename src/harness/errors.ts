import { Schema } from "effect";

// The harness loop appended a message the history cannot hold. The caller built
// the turn; the model did not.
export class HistoryError extends Schema.TaggedError<HistoryError>(
  "@oligarchy/shared/errors/HistoryError",
)("HistoryError", { message: Schema.String }) {}

// A model's tool call is not a command a driver runs. The text goes back to the
// model as the tool result.
export class ToolError extends Schema.TaggedError<ToolError>("@oligarchy/shared/errors/ToolError")(
  "ToolError",
  { message: Schema.String },
) {}

// OpenRouter answered and refused the request: a 4xx other than 429. The status is the HTTP
// status; the message is the body's.
export class OpenRouterRefusal extends Schema.TaggedError<OpenRouterRefusal>(
  "@oligarchy/shared/errors/OpenRouterRefusal",
)("OpenRouterRefusal", { status: Schema.Int, message: Schema.String }) {}

// OpenRouter did not produce a completion: nothing was listening, or the stream died. A refused
// request is OpenRouterRefusal, and a retry that would run past the ceiling OpenRouterPastCeiling,
// not this.
export class OpenRouterUnreachable extends Schema.TaggedError<OpenRouterUnreachable>(
  "@oligarchy/shared/errors/OpenRouterUnreachable",
)("OpenRouterUnreachable", { message: Schema.String, cause: Schema.Defect() }) {}

// A 429, a 5xx or a header or chunk timeout whose retry would wait past the run ceiling: the run
// has spent its time, which is the test's limit, as the ceiling is, not the service being down.
export class OpenRouterPastCeiling extends Schema.TaggedError<OpenRouterPastCeiling>(
  "@oligarchy/shared/errors/OpenRouterPastCeiling",
)("OpenRouterPastCeiling", { message: Schema.String }) {}
