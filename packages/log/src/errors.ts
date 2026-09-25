import { ErrorReporter, type LogLevel, Schema } from "effect";

// An error or fatal log line as the reporter receives it: the text is its message, the level its
// severity, and the cause (when the line has one) is what Sentry is handed. The identifier is
// the one Sentry has always grouped on, so it stays where the line was first reported from.
export class LogLine extends Schema.TaggedError<LogLine>("@oligarchy/observability/log/LogLine")(
  "LogLine",
  {
    text: Schema.String,
    level: Schema.Literals(["error", "fatal"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.text;
  }
  override get [ErrorReporter.severity](): LogLevel.Severity {
    return this.level === "fatal" ? "Fatal" : "Error";
  }
}
