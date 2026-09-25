import { Effect, ErrorReporter, type LogLevel, Schema } from "effect";
import * as Domain from "@oligarchy/shared/domain";

// Each error here is waiting for the package that raises it (monorepo-plan.md's error table)
// and moves out in the phase that creates it. The domain errors are @oligarchy/shared/errors.

export class MissingVariable extends Schema.TaggedError<MissingVariable>(
  "@oligarchy/shared/errors/MissingVariable",
)("MissingVariable", { name: Schema.String }) {
  override get message(): string {
    return `${this.name} is not set`;
  }
}

// The harness loop appended a message the history cannot hold. The caller built
// the turn; the model did not.
export class HistoryError extends Schema.TaggedError<HistoryError>(
  "@oligarchy/shared/errors/HistoryError",
)("HistoryError", { message: Schema.String }) {}

// A model's tool call is not a command a driver runs. The text goes back to the
// model as the tool result.
export class ToolError extends Schema.TaggedError<ToolError>("@oligarchy/shared/errors/ToolError")(
  "ToolError",
  { message: Schema.String },
) {}

// OpenRouter answered and refused the request: a 4xx other than 429. The status is the HTTP
// status; the message is the body's.
export class OpenRouterRefusal extends Schema.TaggedError<OpenRouterRefusal>(
  "@oligarchy/shared/errors/OpenRouterRefusal",
)("OpenRouterRefusal", { status: Schema.Int, message: Schema.String }) {}

// OpenRouter did not produce a completion: nothing was listening, the header or chunk timeout
// fired, a 429 or 5xx could not be retried inside the run ceiling, or the stream died. A refused
// request is OpenRouterRefusal, not this.
export class OpenRouterUnreachable extends Schema.TaggedError<OpenRouterUnreachable>(
  "@oligarchy/shared/errors/OpenRouterUnreachable",
)("OpenRouterUnreachable", { message: Schema.String, cause: Schema.Defect() }) {}

export class DatabaseError extends Schema.TaggedError<DatabaseError>(
  "@oligarchy/shared/errors/DatabaseError",
)("DatabaseError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class QmpError extends Schema.TaggedError<QmpError>("@oligarchy/shared/errors/QmpError")(
  "QmpError",
  {
    command: Schema.String,
    class: Schema.String,
    desc: Schema.String,
    raw: Domain.QmpFailure,
  },
) {
  override get message(): string {
    return `${this.class}: ${this.desc}`;
  }
}

export class QmpTimeout extends Schema.TaggedError<QmpTimeout>(
  "@oligarchy/shared/errors/QmpTimeout",
)("QmpTimeout", { command: Schema.String }) {
  override get message(): string {
    return `qemu: ${this.command} timed out`;
  }
}

export class QmpClosed extends Schema.TaggedError<QmpClosed>("@oligarchy/shared/errors/QmpClosed")(
  "QmpClosed",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

export class QmpProtocolError extends Schema.TaggedError<QmpProtocolError>(
  "@oligarchy/shared/errors/QmpProtocolError",
)("QmpProtocolError", { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) }) {}

export class QemuStartError extends Schema.TaggedError<QemuStartError>(
  "@oligarchy/shared/errors/QemuStartError",
)("QemuStartError", { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) }) {}

export class HostRequirementsMissing extends Schema.TaggedError<HostRequirementsMissing>(
  "@oligarchy/shared/errors/HostRequirementsMissing",
)("HostRequirementsMissing", { missing: Schema.Array(Schema.String) }) {
  override get message(): string {
    return `missing host requirements:\n${this.missing.join("\n")}`;
  }
}

export class IsoError extends Schema.TaggedError<IsoError>("@oligarchy/shared/errors/IsoError")(
  "IsoError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class KeysError extends Schema.TaggedError<KeysError>("@oligarchy/shared/errors/KeysError")(
  "KeysError",
  { message: Schema.String },
) {}

export class ProxyRefusal extends Schema.TaggedError<ProxyRefusal>(
  "@oligarchy/shared/errors/ProxyRefusal",
)("ProxyRefusal", { status: Schema.Int, message: Schema.String }) {}

export class ProxyUnreachable extends Schema.TaggedError<ProxyUnreachable>(
  "@oligarchy/shared/errors/ProxyUnreachable",
)("ProxyUnreachable", { message: Schema.String, cause: Schema.Defect() }) {}

export class LinearError extends Schema.TaggedError<LinearError>(
  "@oligarchy/shared/errors/LinearError",
)("LinearError", {
  operation: Schema.String,
  message: Schema.String,
  status: Schema.optionalKey(Schema.Int),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

// POST /run to an automation-client: unreachable, or a non-2xx. Not an API error — the
// automation server turns it into a failed job.
export class AutomationClientError extends Schema.TaggedError<AutomationClientError>(
  "@oligarchy/shared/errors/AutomationClientError",
)("AutomationClientError", {
  message: Schema.String,
  status: Schema.optionalKey(Schema.Int),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

const JOB_NOT_FOUND = `Job had "running" status but 404'd.`;

// An automation client answering 404 for a job the database has running. No correct run leaves
// the two disagreeing, so it is always reported.
export class JobNotFound extends Schema.TaggedError<JobNotFound>(
  "@oligarchy/shared/errors/JobNotFound",
)("JobNotFound", {
  message: Schema.Literal(JOB_NOT_FOUND).pipe(
    Schema.withConstructorDefault(Effect.succeed(JOB_NOT_FOUND)),
  ),
  jobId: Schema.String,
  url: Schema.String,
  cause: Schema.Defect(),
}) {}

// A prompt template that cannot be read, or names a placeholder its renderer has no value for.
export class PromptError extends Schema.TaggedError<PromptError>(
  "@oligarchy/shared/errors/PromptError",
)("PromptError", { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) }) {}

export class CliFailed extends Schema.TaggedError<CliFailed>("@oligarchy/shared/errors/CliFailed")(
  "CliFailed",
  {
    command: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class PngDecodeError extends Schema.TaggedError<PngDecodeError>(
  "@oligarchy/shared/errors/PngDecodeError",
)("PngDecodeError", { message: Schema.String }) {}

// An error or fatal log line as the reporter receives it: the text is its message, the level its
// severity, and the cause (when the line has one) is what Sentry is handed.
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
