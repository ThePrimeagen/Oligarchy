import { Effect, Exit, Schema } from "effect";

// ---------------------------------------------------------------------------
// Brands and vocabularies
// ---------------------------------------------------------------------------

export const SessionId = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("SessionId"))
  .annotate({ identifier: "@oligarchy/shared/domain/SessionId" });
export type SessionId = typeof SessionId.Type;
export const isSessionId: (value: string) => value is SessionId = Schema.is(SessionId);

export const AgentId = Schema.NonEmptyString.pipe(Schema.brand("AgentId")).annotate({
  identifier: "@oligarchy/shared/domain/AgentId",
});
export type AgentId = typeof AgentId.Type;

export const ImageId = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("ImageId"))
  .annotate({ identifier: "@oligarchy/shared/domain/ImageId" });
export type ImageId = typeof ImageId.Type;

export const SessionStatus = Schema.Literals([
  "downloading",
  "running",
  "succeeded",
  "failed",
  "aborted",
  "timed_out",
]).annotate({ identifier: "@oligarchy/shared/domain/SessionStatus" });
export type SessionStatus = typeof SessionStatus.Type;

export const SessionStartStatus = Schema.Literals(["downloading", "running"]).annotate({
  identifier: "@oligarchy/shared/domain/SessionStartStatus",
});
export type SessionStartStatus = typeof SessionStartStatus.Type;

export const SessionEndStatus = Schema.Literals([
  "succeeded",
  "failed",
  "aborted",
  "timed_out",
]).annotate({
  identifier: "@oligarchy/shared/domain/SessionEndStatus",
});
export type SessionEndStatus = typeof SessionEndStatus.Type;

export const StopStatus = Schema.Literals(["succeeded", "failed", "aborted"]).annotate({
  identifier: "@oligarchy/shared/domain/StopStatus",
});
export type StopStatus = typeof StopStatus.Type;

export const FollowStatus = Schema.Literals([
  "pending",
  "running",
  "succeeded",
  "failed",
  "aborted",
  "timed_out",
]).annotate({ identifier: "@oligarchy/shared/domain/FollowStatus" });
export type FollowStatus = typeof FollowStatus.Type;

export const ActionState = Schema.Literals(["completed", "failed"]).annotate({
  identifier: "@oligarchy/shared/domain/ActionState",
});
export type ActionState = typeof ActionState.Type;

export const ActionName = Schema.Literals([
  "send-keys",
  "send-mouse",
  "get-image",
  "get-serial",
]).annotate({
  identifier: "@oligarchy/shared/domain/ActionName",
});
export type ActionName = typeof ActionName.Type;

export const LogLevel = Schema.Literals(["info", "warning", "error", "fatal"]).annotate({
  identifier: "@oligarchy/shared/domain/LogLevel",
});
export type LogLevel = typeof LogLevel.Type;

export const MouseButton = Schema.Literals([
  "left",
  "middle",
  "right",
  "wheel-up",
  "wheel-down",
]).annotate({
  identifier: "@oligarchy/shared/domain/MouseButton",
});
export type MouseButton = typeof MouseButton.Type;

export const QemuDisplay = Schema.Literals([
  "none",
  "gtk",
  "sdl",
  "egl-headless",
  "spice-app",
  "dbus",
]).annotate({ identifier: "@oligarchy/shared/domain/QemuDisplay" });
export type QemuDisplay = typeof QemuDisplay.Type;

export const TestResultStatus = Schema.Literals([
  "pending",
  "running",
  "passed",
  "failed",
  "aborted",
  "timed_out",
]).annotate({ identifier: "@oligarchy/shared/domain/TestResultStatus" });
export type TestResultStatus = typeof TestResultStatus.Type;

export const SessionConfig = Schema.Struct({
  iso: Schema.String,
  disk: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "@oligarchy/shared/domain/SessionConfig" });
export type SessionConfig = typeof SessionConfig.Type;

// ---------------------------------------------------------------------------
// The follow stream: one JSON line per event, keyed on `type`
// ---------------------------------------------------------------------------

export const FollowEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("session"), status: FollowStatus }),
  Schema.Struct({
    type: Schema.Literal("intent"),
    state: Schema.Literal("started"),
    message: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("intent"),
    state: Schema.Literals(["completed", "cancelled"]),
  }),
  Schema.Struct({
    type: Schema.Literal("action"),
    id: Schema.Int,
    name: ActionName,
    state: Schema.Literal("running"),
  }),
  Schema.Struct({ type: Schema.Literal("action"), id: Schema.Int, state: ActionState }),
  Schema.Struct({ type: Schema.Literal("image"), id: Schema.String, png: Schema.String }),
]).annotate({ identifier: "@oligarchy/shared/domain/FollowEvent" });
export type FollowEvent = typeof FollowEvent.Type;

export const FollowEventLine = Schema.fromJsonString(Schema.toCodecJson(FollowEvent));

const encodeFollowEvent = Schema.encodeSync(FollowEventLine);
const decodeFollowEvent = Schema.decodeUnknownEffect(FollowEventLine);

export const encodeFollowLine = (event: FollowEvent): string => `${encodeFollowEvent(event)}\n`;

export const decodeFollowLine = (line: string): Effect.Effect<FollowEvent, Schema.SchemaError> =>
  decodeFollowEvent(line);

// ---------------------------------------------------------------------------
// QMP wire: QEMU's field names, never renamed
// ---------------------------------------------------------------------------

export const QmpArguments = Schema.Record(Schema.String, Schema.Json);

export const QmpKey = Schema.Struct({
  type: Schema.Literals(["qcode", "number"]),
  data: Schema.Union([Schema.String, Schema.Number]),
}).annotate({ identifier: "@oligarchy/shared/domain/QmpKey" });
export type QmpKey = typeof QmpKey.Type;

export const QmpInputEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("abs"),
    data: Schema.Struct({ axis: Schema.Literals(["x", "y"]), value: Schema.Int }),
  }),
  Schema.Struct({
    type: Schema.Literal("btn"),
    data: Schema.Struct({ button: MouseButton, down: Schema.Boolean }),
  }),
]).annotate({ identifier: "@oligarchy/shared/domain/QmpInputEvent" });
export type QmpInputEvent = typeof QmpInputEvent.Type;

export const QmpCommand = Schema.Union([
  Schema.Struct({
    execute: Schema.Literal("qmp_capabilities"),
    arguments: Schema.Struct({}),
    id: Schema.Int,
  }),
  Schema.Struct({
    execute: Schema.Literal("send-key"),
    arguments: Schema.Struct({ keys: Schema.Array(QmpKey) }),
    id: Schema.Int,
  }),
  Schema.Struct({
    execute: Schema.Literal("screendump"),
    arguments: Schema.Struct({ filename: Schema.String, format: Schema.Literal("png") }),
    id: Schema.Int,
  }),
  Schema.Struct({
    execute: Schema.Literal("input-send-event"),
    arguments: Schema.Struct({ events: Schema.Array(QmpInputEvent) }),
    id: Schema.Int,
  }),
]).annotate({ identifier: "@oligarchy/shared/domain/QmpCommand" });
export type QmpCommand = typeof QmpCommand.Type;

export const QmpGreeting = Schema.Struct({
  QMP: Schema.Struct({ version: Schema.Json, capabilities: Schema.Array(Schema.Json) }),
}).annotate({ identifier: "@oligarchy/shared/domain/QmpGreeting" });
export type QmpGreeting = typeof QmpGreeting.Type;

export const QmpSuccess = Schema.Struct({
  return: Schema.Json,
  id: Schema.optionalKey(Schema.Json),
}).annotate({ identifier: "@oligarchy/shared/domain/QmpSuccess" });
export type QmpSuccess = typeof QmpSuccess.Type;

export const QmpErrorBody = Schema.Struct({ class: Schema.String, desc: Schema.String }).annotate({
  identifier: "@oligarchy/shared/domain/QmpErrorBody",
});
export type QmpErrorBody = typeof QmpErrorBody.Type;

export const QmpFailure = Schema.Struct({
  error: QmpErrorBody,
  id: Schema.optionalKey(Schema.Json),
}).annotate({ identifier: "@oligarchy/shared/domain/QmpFailure" });
export type QmpFailure = typeof QmpFailure.Type;

export const QmpEvent = Schema.Struct({
  event: Schema.String,
  data: Schema.optionalKey(Schema.Json),
  timestamp: Schema.optionalKey(
    Schema.Struct({ seconds: Schema.Number, microseconds: Schema.Number }),
  ),
}).annotate({ identifier: "@oligarchy/shared/domain/QmpEvent" });
export type QmpEvent = typeof QmpEvent.Type;

export const QmpInbound = Schema.Union([QmpGreeting, QmpSuccess, QmpFailure, QmpEvent]).annotate({
  identifier: "@oligarchy/shared/domain/QmpInbound",
});
export type QmpInbound = typeof QmpInbound.Type;

const QmpInboundLine = Schema.fromJsonString(Schema.toCodecJson(QmpInbound));
const QmpCommandLine = Schema.fromJsonString(Schema.toCodecJson(QmpCommand));

// Exit-returning because it runs inside the synchronous socket data callback.
export const decodeQmpInbound: (text: string) => Exit.Exit<QmpInbound, Schema.SchemaError> =
  Schema.decodeUnknownExit(QmpInboundLine);

const encodeQmpCommandLine = Schema.encodeSync(QmpCommandLine);

export const encodeQmpCommand = (command: QmpCommand): string =>
  `${encodeQmpCommandLine(command)}\n`;

export const QmpExchangeOutcome = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("completed"),
    response: Schema.Union([QmpGreeting, QmpSuccess]),
  }),
  Schema.Struct({
    state: Schema.Literal("failed"),
    response: Schema.Union([QmpFailure, Schema.String]),
  }),
]).annotate({ identifier: "@oligarchy/shared/domain/QmpExchangeOutcome" });
export type QmpExchangeOutcome = typeof QmpExchangeOutcome.Type;
