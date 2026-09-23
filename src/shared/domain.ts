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

// The key of a post-run error type: what a diagnosis carries and an operator types. snake_case
// so it reads in a table, a shell and a GROUP BY without quoting.
export const ErrorTypeKey = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_]*$/, {
    message: "key must be snake_case: a-z, 0-9 and _, starting with a letter",
  }),
)
  .pipe(Schema.brand("ErrorTypeKey"))
  .annotate({ identifier: "@oligarchy/shared/domain/ErrorTypeKey" });
export type ErrorTypeKey = typeof ErrorTypeKey.Type;

export const SessionStatus = Schema.Literals([
  "downloading",
  "running",
  "succeeded",
  "failed",
  "aborted",
  "timed_out",
  "completed",
  "errored",
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
  "completed",
  "errored",
]).annotate({
  identifier: "@oligarchy/shared/domain/SessionEndStatus",
});
export type SessionEndStatus = typeof SessionEndStatus.Type;

export const StopStatus = Schema.Literals(["succeeded", "failed", "aborted", "completed"]).annotate(
  {
    identifier: "@oligarchy/shared/domain/StopStatus",
  },
);
export type StopStatus = typeof StopStatus.Type;

export const FollowStatus = Schema.Literals([
  "pending",
  "running",
  "succeeded",
  "failed",
  "aborted",
  "timed_out",
  "completed",
  "errored",
]).annotate({ identifier: "@oligarchy/shared/domain/FollowStatus" });
export type FollowStatus = typeof FollowStatus.Type;

export const ActionState = Schema.Literals(["completed", "failed"]).annotate({
  identifier: "@oligarchy/shared/domain/ActionState",
});
export type ActionState = typeof ActionState.Type;

export const ActionName = Schema.Literals([
  "send-keys",
  "mouse-move",
  "mouse-click",
  "mouse-double-click",
  "mouse-scroll",
  "mouse-drag",
  "mouse-hold",
  "mouse-release",
  "get-image",
  "get-serial",
  "save",
]).annotate({
  identifier: "@oligarchy/shared/domain/ActionName",
});
export type ActionName = typeof ActionName.Type;

export const LogLevel = Schema.Literals(["info", "warning", "error", "fatal"]).annotate({
  identifier: "@oligarchy/shared/domain/LogLevel",
});
export type LogLevel = typeof LogLevel.Type;

// The buttons a click, a drag, a hold or a release take; the wheel is a scroll, never a click.
export const ClickButton = Schema.Literals(["left", "middle", "right"]).annotate({
  identifier: "@oligarchy/shared/domain/ClickButton",
});
export type ClickButton = typeof ClickButton.Type;

// Which way a scroll turns the wheel.
export const ScrollDirection = Schema.Literals(["up", "down", "left", "right"]).annotate({
  identifier: "@oligarchy/shared/domain/ScrollDirection",
});
export type ScrollDirection = typeof ScrollDirection.Type;

// A key held around a click or a drag, by the name a driver writes; qemu/qemu.ts maps it to a
// qcode.
export const MouseModifier = Schema.Literals(["shift", "ctrl", "alt", "super"]).annotate({
  identifier: "@oligarchy/shared/domain/MouseModifier",
});
export type MouseModifier = typeof MouseModifier.Type;

// A point on the screenshot as fractions of its width and height, 0 the top-left edge, 1 the
// bottom-right; the range is checked by the handler with a fixed message.
export const ScreenPoint = Schema.Struct({ x: Schema.Number, y: Schema.Number }).annotate({
  identifier: "@oligarchy/shared/domain/ScreenPoint",
});
export type ScreenPoint = typeof ScreenPoint.Type;

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
  "completed",
  "errored",
]).annotate({ identifier: "@oligarchy/shared/domain/TestResultStatus" });
export type TestResultStatus = typeof TestResultStatus.Type;

// A post-run reviewer's verdict on a session's test: did the proof land. Maintained by hand with
// the `diagnosis_verdict` pgEnum in `db/schema.ts`.
export const DiagnosisVerdict = Schema.Literals(["passed", "failed"]).annotate({
  identifier: "@oligarchy/shared/domain/DiagnosisVerdict",
});
export type DiagnosisVerdict = typeof DiagnosisVerdict.Type;

// An ISO named by url is downloaded and cached by the proxy; anything else is a path.
export const isIsoUrl = (iso: string): boolean =>
  iso.startsWith("http://") || iso.startsWith("https://");

// A server the reverse proxy forwards to, as an operator registers it: an http(s) url with a
// host, used exactly as given, as --server-url is.
export const ServerUrl = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      if (!URL.canParse(value)) {
        return false;
      }
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
    },
    { message: "url must be an http or https url" },
  ),
).annotate({ identifier: "@oligarchy/shared/domain/ServerUrl" });
export type ServerUrl = typeof ServerUrl.Type;

// What an operator calls a qemu server or automation-client: the name on the servers row
// and on each process_stats insert. No default — a host names itself.
export const ServerName = Schema.NonEmptyString.pipe(Schema.brand("ServerName")).annotate({
  identifier: "@oligarchy/shared/domain/ServerName",
});
export type ServerName = typeof ServerName.Type;

// How many jobs a qemu server or automation client runs at once, as --max-jobs names it: a
// reserve past it is refused. Start and run consume a reservation. A host that takes no jobs
// is not a server.
export const MaxJobs = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1, { message: "max-jobs must be at least 1" }),
).annotate({ identifier: "@oligarchy/shared/domain/MaxJobs" });
export type MaxJobs = typeof MaxJobs.Type;

// The automation steps for a test result, the twin of the automation_action pgEnum in
// src/db/schema.ts, maintained by hand together. A mint and a drive both boot a guest and so
// reserve one; a mint does not resume, it installs. A diagnose reads the session back and
// reserves a client only.
export const AutomationAction = Schema.Literals(["drive", "diagnose", "mint"]).annotate({
  identifier: "@oligarchy/shared/domain/AutomationAction",
});
export type AutomationAction = typeof AutomationAction.Type;

// An OpenCode model as `opencode run --model` takes it: the provider, a slash, the model's own
// id (which may hold slashes of its own: openrouter/deepseek/deepseek-v4.1-flash). Refused at
// the flag so a run is never dispatched as a model no client can launch.
export const ModelId = Schema.String.check(
  Schema.isPattern(/^[^\s/]+\/\S+$/, { message: "model must be provider/model" }),
).annotate({ identifier: "@oligarchy/shared/domain/ModelId" });
export type ModelId = typeof ModelId.Type;

// What a session boots: `fresh` is the iso on a blank disk, `resume` the machine's minted disk of
// that iso with no iso attached. Absent on the wire and in a row means fresh.
export const SessionMode = Schema.Literals(["fresh", "resume"]).annotate({
  identifier: "@oligarchy/shared/domain/SessionMode",
});
export type SessionMode = typeof SessionMode.Type;

export const SessionConfig = Schema.Struct({
  iso: Schema.String,
  disk: Schema.optionalKey(Schema.String),
  mode: Schema.optionalKey(SessionMode),
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

// QEMU's InputButton names: the wheel is four buttons, one per direction.
export const InputButton = Schema.Literals([
  "left",
  "middle",
  "right",
  "wheel-up",
  "wheel-down",
  "wheel-left",
  "wheel-right",
]).annotate({ identifier: "@oligarchy/shared/domain/InputButton" });
export type InputButton = typeof InputButton.Type;

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
    data: Schema.Struct({ button: InputButton, down: Schema.Boolean }),
  }),
  // A key held or let go on its own, unlike send-key's press-and-release: what keeps a
  // modifier down across the pointer events of one gesture.
  Schema.Struct({
    type: Schema.Literal("key"),
    data: Schema.Struct({ down: Schema.Boolean, key: QmpKey }),
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
  // The ACPI power button: the guest shuts itself down and QEMU exits.
  Schema.Struct({
    execute: Schema.Literal("system_powerdown"),
    arguments: Schema.Struct({}),
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
