import { Schema } from "effect";

export class PngDecodeError extends Schema.TaggedError<PngDecodeError>(
  "@oligarchy/shared/errors/PngDecodeError",
)("PngDecodeError", { message: Schema.String }) {}
