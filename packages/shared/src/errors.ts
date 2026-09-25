import { Schema } from "effect";

// A CLI's local refusal: one sentence naming the flags, printed as it is. Every process raises
// it, which is what puts it here; an error one package raises lives with that package.
export class CommandError extends Schema.TaggedError<CommandError>(
  "@oligarchy/shared/errors/CommandError",
)("CommandError", { message: Schema.String }) {}
