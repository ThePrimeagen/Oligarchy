import { Effect, ErrorReporter, Schema, SchemaAST, SchemaTransformation } from "effect";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

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

// `not found` unless the caller names what was not found (a server url nobody registered), under
// the agent that asked when one did.
export class NotFound extends Schema.TaggedError<NotFound>("@oligarchy/shared/errors/NotFound")(
  "NotFound",
  {
    message: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed("not found"))),
    agentId: Schema.optionalKey(Schema.String),
  },
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

// A save the machine did not carry through: the guest would not power off, or its disk could not
// be kept. 502 as StartFailed: the machine, not the caller, failed the request.
export class SaveFailed extends Schema.TaggedError<SaveFailed>(
  "@oligarchy/shared/errors/SaveFailed",
)(
  "SaveFailed",
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

// A server behind the reverse proxy that did not answer as a server does: unreachable, a refused
// probe, or a 200 that is not stats or not an id. The message names the url and the reason.
export class ServerFailed extends Schema.TaggedError<ServerFailed>(
  "@oligarchy/shared/errors/ServerFailed",
)(
  "ServerFailed",
  {
    message: Schema.String,
    url: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
    sessionId: Schema.optionalKey(Schema.String),
    agentId: Schema.optionalKey(Schema.String),
  },
  { httpApiStatus: 502 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

// A start with nowhere to go: no server registered, or none answering its probe.
export class NoServer extends Schema.TaggedError<NoServer>("@oligarchy/shared/errors/NoServer")(
  "NoServer",
  { message: Schema.String, agentId: Schema.optionalKey(Schema.String) },
  { httpApiStatus: 503 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

export class RunFailed extends Schema.TaggedError<RunFailed>("@oligarchy/shared/errors/RunFailed")(
  "RunFailed",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
  { httpApiStatus: 500 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

// A run POST /abort ended. 409, not RunFailed's 500: the run did not fail, and the job is closed
// by the abort that stopped it, not by whoever waited on /run.
export class RunAborted extends Schema.TaggedError<RunAborted>(
  "@oligarchy/shared/errors/RunAborted",
)(
  "RunAborted",
  { message: fixedMessage("run aborted"), agentId: Schema.optionalKey(Schema.String) },
  { httpApiStatus: 409 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

// A reserve refused because the process already holds --max-jobs jobs. 503: the server is
// temporarily unable to take the work (RFC 9110 §15.6.4), not the caller's mistake; the caller
// places it elsewhere or retries later. Start and run do not answer this: they consume a
// reservation.
export class AtCapacity extends Schema.TaggedError<AtCapacity>(
  "@oligarchy/shared/errors/AtCapacity",
)(
  "AtCapacity",
  { message: Schema.String, agentId: Schema.optionalKey(Schema.String) },
  { httpApiStatus: 503 },
) {
  override readonly [ErrorReporter.ignore] = true;
}

// A resume reserve on a machine that has room and does not hold this iso's minted disk.
// 409, not 503: the machine is not full, and a 503 is placed elsewhere. The message names
// the slots setting it up would add. Not Conflict: that one belongs to /follow and requires
// a session id.
export class SetupNeeded extends Schema.TaggedError<SetupNeeded>(
  "@oligarchy/shared/errors/SetupNeeded",
)(
  "SetupNeeded",
  { message: Schema.String, agentId: Schema.optionalKey(Schema.String) },
  { httpApiStatus: 409 },
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
  | SaveFailed
  | Internal
  | ServerFailed
  | NoServer
  | RunFailed
  | RunAborted
  | AtCapacity
  | SetupNeeded;

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
  SaveFailed,
  Internal,
  ServerFailed,
  NoServer,
  RunFailed,
  RunAborted,
  AtCapacity,
  SetupNeeded,
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
  (message) => ({ _tag: "NotFound", message }) as const,
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
export const SaveFailedWire = wireError(
  SaveFailed,
  (message) => ({ _tag: "SaveFailed", message, sessionId: "", agentId: "" }) as const,
);
// A decoded Internal has no defect to carry: the wire only says "internal error".
export const InternalWire = wireError(
  Internal,
  () => ({ _tag: "Internal", message: "internal error", cause: null }) as const,
);
export const ServerFailedWire = wireError(
  ServerFailed,
  (message) => ({ _tag: "ServerFailed", message, url: "" }) as const,
);
export const NoServerWire = wireError(
  NoServer,
  (message) => ({ _tag: "NoServer", message }) as const,
);
export const RunFailedWire = wireError(
  RunFailed,
  (message) => ({ _tag: "RunFailed", message }) as const,
);
export const RunAbortedWire = wireError(
  RunAborted,
  () => ({ _tag: "RunAborted", message: "run aborted" }) as const,
);
export const AtCapacityWire = wireError(
  AtCapacity,
  (message) => ({ _tag: "AtCapacity", message }) as const,
);
export const SetupNeededWire = wireError(
  SetupNeeded,
  (message) => ({ _tag: "SetupNeeded", message }) as const,
);
