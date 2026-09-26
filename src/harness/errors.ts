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

// OpenRouter did not produce a completion: nothing was listening, the header or chunk timeout
// fired, a 429 or 5xx could not be retried inside the run ceiling, or the stream died. A refused
// request is OpenRouterRefusal, not this.
export class OpenRouterUnreachable extends Schema.TaggedError<OpenRouterUnreachable>(
  "@oligarchy/shared/errors/OpenRouterUnreachable",
)("OpenRouterUnreachable", { message: Schema.String, cause: Schema.Defect() }) {}
