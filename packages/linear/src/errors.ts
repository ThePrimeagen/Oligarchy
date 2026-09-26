import { Schema } from "effect";

// One failed call to the Linear API: the operation it was for, a message that names what Linear
// said, the HTTP status when it was not a 2xx, and the transport or decode failure as the cause.
// `retryable` is set when asking again could answer: no answer, no connection, a 429 or a 5xx.
export class LinearError extends Schema.TaggedError<LinearError>(
  "@oligarchy/shared/errors/LinearError",
)("LinearError", {
  operation: Schema.String,
  message: Schema.String,
  status: Schema.optionalKey(Schema.Int),
  retryable: Schema.optionalKey(Schema.Boolean),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}
