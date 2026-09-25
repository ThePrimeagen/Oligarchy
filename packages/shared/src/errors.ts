import { Schema } from "effect";

// A CLI's local refusal: one sentence naming the flags, printed as it is. More than one package
// or app raises it, which is what puts it here; an error one raises lives with that one.
export class CommandError extends Schema.TaggedError<CommandError>(
  "@oligarchy/shared/errors/CommandError",
)("CommandError", { message: Schema.String }) {}
