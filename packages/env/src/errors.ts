import { Schema } from "effect";

// A variable the process needs and no source set: rendered as its name alone, never a value.
export class MissingVariable extends Schema.TaggedError<MissingVariable>(
  "@oligarchy/shared/errors/MissingVariable",
)("MissingVariable", { name: Schema.String }) {
  override get message(): string {
    return `${this.name} is not set`;
  }
}
