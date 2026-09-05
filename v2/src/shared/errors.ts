import {
  Effect,
  ErrorReporter,
  type LogLevel,
  Schema,
  SchemaAST,
  SchemaTransformation,
} from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";
import * as Domain from "./domain.ts";

// ---------------------------------------------------------------------------
// API errors: the wire body is { "error": "<message>" }; the class is what handlers raise.
// Every one is ErrorReporter.ignore'd: the ApiBoundary middleware logs each failed request once
// and that log line is the single Sentry report (with the cause when the status is 500 or above),
// so HttpApiBuilder's own reporting of the same failure is silenced.
// ---------------------------------------------------------------------------

const fixedMessage = <const M extends string>(message: M) =>
  Schema.Literal(message).pipe(Schema.withConstructorDefault(Effect.succeed(message)));

export class BadRequest extends Schema.TaggedError<BadRequest>(
  "@oligarchy/shared/errors/BadRequest",
)(
  "BadRequest",
  {
    message: Schema.String,
    sessionId: Schema.optionalKey(Schema.String),
    agentId: Schema.optionalKey(Schema.String),
  },
  { httpApiStatus: 400 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

export class Unauthorized extends Schema.TaggedError<Unauthorized>(
  "@oligarchy/shared/errors/Unauthorized",
)("Unauthorized", { message: fixedMessage("unauthorized") }, { httpApiStatus: 401 }) {
  override readonly [ErrorReporter.ignore] = true;
}

export class Forbidden extends Schema.TaggedError<Forbidden>("@oligarchy/shared/errors/Forbidden")(
  "Forbidden",
  { message: Schema.String, sessionId: Schema.String, agentId: Schema.String },
  { httpApiStatus: 403 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

export class UnknownSession extends Schema.TaggedError<UnknownSession>(
  "@oligarchy/shared/errors/UnknownSession",
)(
  "UnknownSession",
  { id: Schema.String, message: Schema.String, agentId: Schema.optionalKey(Schema.String) },
  { httpApiStatus: 404 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

export const unknownSession = (id: string, agentId?: string): UnknownSession =>
  agentId === undefined
    ? UnknownSession.make({ id, message: `unknown session "${id}"` })
    : UnknownSession.make({ id, message: `unknown session "${id}"`, agentId });

export class NotFound extends Schema.TaggedError<NotFound>("@oligarchy/shared/errors/NotFound")(
  "NotFound",
  { message: fixedMessage("not found") },
  { httpApiStatus: 404 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

export class Conflict extends Schema.TaggedError<Conflict>("@oligarchy/shared/errors/Conflict")(
  "Conflict",
  { message: Schema.String, sessionId: Schema.String },
  { httpApiStatus: 409 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

export class StartFailed extends Schema.TaggedError<StartFailed>(
  "@oligarchy/shared/errors/StartFailed",
)(
  "StartFailed",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
    sessionId: Schema.String,
    agentId: Schema.String,
  },
  { httpApiStatus: 502 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

export class ExchangeFailed extends Schema.TaggedError<ExchangeFailed>(
  "@oligarchy/shared/errors/ExchangeFailed",
)(
  "ExchangeFailed",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
    sessionId: Schema.String,
    agentId: Schema.String,
  },
  { httpApiStatus: 502 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

export class Internal extends Schema.TaggedError<Internal>("@oligarchy/shared/errors/Internal")(
  "Internal",
  {
    message: fixedMessage("internal error"),
    cause: Schema.Defect(),
    sessionId: Schema.optionalKey(Schema.String),
    agentId: Schema.optionalKey(Schema.String),
  },
  { httpApiStatus: 500 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

export type ApiError =
  | BadRequest
  | Unauthorized
  | Forbidden
  | UnknownSession
  | NotFound
  | Conflict
  | StartFailed
  | ExchangeFailed
  | Internal;

const resolveHttpApiStatus = SchemaAST.resolveAt("httpApiStatus");

// The status HttpApiSchema.status annotated; 500 is HttpApi's own default for an error schema.
export const httpStatus = (schema: Schema.Top): number => {
  const status = resolveHttpApiStatus(schema.ast);
  return typeof status === "number" ? status : 500;
};

// Total over ApiError's tags: dropping an arm, or adding a tag without one, does not compile.
const apiErrorClasses = {
  BadRequest,
  Unauthorized,
  Forbidden,
  UnknownSession,
  NotFound,
  Conflict,
  StartFailed,
  ExchangeFailed,
  Internal,
} satisfies Record<ApiError["_tag"], Schema.Top>;

export const apiStatus = (error: ApiError): number => httpStatus(apiErrorClasses[error._tag]);

const WireBody = Schema.Struct({ error: Schema.String });

// { error: string } on the wire, the class on the type side, the class's own status on the codec.
const wireError = <S extends Schema.Codec<unknown, { readonly message: string }>>(
  schema: S,
  fromMessage: (message: string) => S["Encoded"],
): Schema.Codec<S["Type"], { readonly error: string }> =>
  WireBody.pipe(
    Schema.decodeTo(
      schema,
      SchemaTransformation.transform<S["Encoded"], { readonly error: string }>({
        decode: ({ error }) => fromMessage(error),
        encode: (encoded) => ({ error: encoded.message }),
      }),
    ),
    HttpApiSchema.status(httpStatus(schema)),
  );

export const BadRequestWire = wireError(
  BadRequest,
  (message) => ({ _tag: "BadRequest", message }) as const,
);
export const UnauthorizedWire = wireError(
  Unauthorized,
  () => ({ _tag: "Unauthorized", message: "unauthorized" }) as const,
);
export const ForbiddenWire = wireError(
  Forbidden,
  (message) => ({ _tag: "Forbidden", message, sessionId: "", agentId: "" }) as const,
);
export const UnknownSessionWire = wireError(
  UnknownSession,
  (message) => ({ _tag: "UnknownSession", id: "", message }) as const,
);
export const NotFoundWire = wireError(
  NotFound,
  () => ({ _tag: "NotFound", message: "not found" }) as const,
);
export const ConflictWire = wireError(
  Conflict,
  (message) => ({ _tag: "Conflict", message, sessionId: "" }) as const,
);
export const StartFailedWire = wireError(
  StartFailed,
  (message) => ({ _tag: "StartFailed", message, sessionId: "", agentId: "" }) as const,
);
export const ExchangeFailedWire = wireError(
  ExchangeFailed,
  (message) => ({ _tag: "ExchangeFailed", message, sessionId: "", agentId: "" }) as const,
);
// A decoded Internal has no defect to carry: the wire only says "internal error".
export const InternalWire = wireError(
  Internal,
  () => ({ _tag: "Internal", message: "internal error", cause: null }) as const,
);

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class MissingVariable extends Schema.TaggedError<MissingVariable>(
  "@oligarchy/shared/errors/MissingVariable",
)("MissingVariable", { name: Schema.String }) {
  override get message(): string {
    return `${this.name} is not set`;
  }
}

export class CommandError extends Schema.TaggedError<CommandError>(
  "@oligarchy/shared/errors/CommandError",
)("CommandError", { message: Schema.String }) {}

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

export class CursorAgentFailed extends Schema.TaggedError<CursorAgentFailed>(
  "@oligarchy/shared/errors/CursorAgentFailed",
)("CursorAgentFailed", {
  message: Schema.String,
  retryable: Schema.Boolean,
  cause: Schema.Defect(),
}) {}

export class ChildExit extends Schema.TaggedError<ChildExit>("@oligarchy/shared/errors/ChildExit")(
  "ChildExit",
  {
    command: Schema.String,
    code: Schema.Int,
    stderr: Schema.String,
  },
) {
  override get message(): string {
    return this.stderr;
  }
}

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
