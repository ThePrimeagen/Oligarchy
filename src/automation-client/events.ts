import { Option, Schema } from "effect";

const Line = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    sessionID: Schema.String,
    part: Schema.Struct({ text: Schema.String }),
  }),
  Schema.Struct({ type: Schema.Literal("step_start"), sessionID: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("error"),
    sessionID: Schema.String,
    error: Schema.Struct({
      name: Schema.String,
      data: Schema.optionalKey(Schema.Struct({ message: Schema.optionalKey(Schema.String) })),
    }),
  }),
  Schema.Struct({ type: Schema.String, sessionID: Schema.String }),
]).annotate({ identifier: "@oligarchy/automation-client/events/Line" });

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.toCodecJson(Line)));

export type State = {
  readonly session: Option.Option<string>;
  readonly text: string;
  readonly error: Option.Option<string>;
  readonly ignored: number;
};

export const empty: State = {
  session: Option.none(),
  text: "",
  error: Option.none(),
  ignored: 0,
};

export const fold = (state: State, line: string): State => {
  const decoded = decode(line);
  if (Option.isNone(decoded)) {
    return { ...state, ignored: state.ignored + 1 };
  }
  const event = decoded.value;
  if ("part" in event) {
    return { ...state, session: Option.some(event.sessionID), text: state.text + event.part.text };
  }
  if ("error" in event) {
    return {
      ...state,
      session: Option.some(event.sessionID),
      error: Option.some(event.error.data?.message ?? event.error.name),
    };
  }
  if (event.type === "step_start") {
    return { ...state, session: Option.some(event.sessionID), text: "" };
  }
  return { ...state, session: Option.some(event.sessionID), ignored: state.ignored + 1 };
};
