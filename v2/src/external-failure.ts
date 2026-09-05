import { Option, Schema } from "effect";

// Serialises a thrown value into log annotations, an `actions.response`, or an error message.
// Errors themselves carry `cause: Schema.Defect()`; this is only for the record.
export class ExternalFailure extends Schema.Class<ExternalFailure>(
  "@oligarchy/external-failure/ExternalFailure",
)({
  name: Schema.String,
  message: Schema.String,
  stack: Schema.optionalKey(Schema.String),
  code: Schema.optionalKey(Schema.String),
}) {}

const errorInstance = Schema.decodeUnknownOption(Schema.ErrorInstance());

// Struct probes see own properties only; an Error's `name` lives on its prototype, hence the
// instance probe beside it.
const fields = Schema.decodeUnknownOption(
  Schema.Struct({
    name: Schema.optionalKey(Schema.String),
    message: Schema.optionalKey(Schema.String),
    stack: Schema.optionalKey(Schema.String),
    code: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
  }),
);

const messageField = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));

const causeField = Schema.decodeUnknownOption(Schema.Struct({ cause: Schema.Unknown }));

const messageOf = (cause: unknown): string | undefined => {
  const error = errorInstance(cause);
  if (Option.isSome(error)) {
    return error.value.message;
  }
  return Option.getOrUndefined(Option.map(messageField(cause), (found) => found.message));
};

export const externalFailure = (cause: unknown): ExternalFailure => {
  const error = Option.getOrUndefined(errorInstance(cause));
  const found = Option.getOrUndefined(fields(cause));
  const base = {
    name: error?.name ?? found?.name ?? "ExternalFailure",
    message: error?.message ?? found?.message ?? String(cause),
  };
  const stack = error?.stack ?? found?.stack;
  const code = found?.code;
  return ExternalFailure.make(
    Object.assign(
      base,
      stack === undefined ? undefined : { stack },
      code === undefined ? undefined : { code: String(code) },
    ),
  );
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
