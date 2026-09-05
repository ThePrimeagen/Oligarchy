import { Option, Schema } from "effect";

const errorInstance = Schema.decodeUnknownOption(Schema.ErrorInstance());

// Struct probes see own properties only, and a TaggedError's `message` is a prototype getter;
// hence the instance probe first.
const messageField = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));

const causeField = Schema.decodeUnknownOption(Schema.Struct({ cause: Schema.Unknown }));

export const messageOf = (cause: unknown): string | undefined => {
  const error = errorInstance(cause);
  if (Option.isSome(error)) {
    return error.value.message;
  }
  return Option.getOrUndefined(Option.map(messageField(cause), (found) => found.message));
};

export const describeThrowable = (cause: unknown, fallback: string): string =>
  messageOf(cause) ?? fallback;

// The nested `cause` when the value carries one (drizzle buries the driver's reason there),
// else the value itself.
export const causeOf = (cause: unknown): unknown =>
  Option.match(causeField(cause), {
    onNone: () => cause,
    onSome: (found) => found.cause ?? cause,
  });
