import { Schema } from "effect";

export class CliFailed extends Schema.TaggedError<CliFailed>("@oligarchy/shared/errors/CliFailed")(
  "CliFailed",
  {
    command: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}
