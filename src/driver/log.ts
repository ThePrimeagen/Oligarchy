import { Schema } from "effect";

export const Kind = Schema.Literals([
  "request",
  "assistant",
  "start",
  "running",
  "intent",
  "command",
  "refusal",
  "stop",
  "failure",
]).annotate({ identifier: "@oligarchy/driver/log/Kind" });
export type Kind = typeof Kind.Type;

export class Event extends Schema.Class<Event>("@oligarchy/driver/log/Event")({
  step: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  kind: Kind,
  text: Schema.String,
}) {}

const EventLine = Schema.fromJsonString(Schema.toCodecJson(Event));
const encodeEvent = Schema.encodeSync(EventLine);

export const line = (event: Event): string => `${encodeEvent(event)}\n`;

export const decodeLine = Schema.decodeUnknownSync(EventLine);
