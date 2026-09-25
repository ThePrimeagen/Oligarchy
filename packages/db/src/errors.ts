import { Schema } from "effect";

// One failed database operation: the driver's own message, the operation it was, and the
// driver error's cause when it has one, so the headline reads `Failed query: …: connect …`.
export class DatabaseError extends Schema.TaggedError<DatabaseError>(
  "@oligarchy/shared/errors/DatabaseError",
)("DatabaseError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}
