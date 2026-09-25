import { Effect, Schema } from "effect";

// What a session boots: `fresh` is the iso on a blank disk, `resume` the machine's minted disk of
// that iso with no iso attached. Absent on the wire and in a row means fresh.
export const SessionMode = Schema.Literals(["fresh", "resume"]).annotate({
  identifier: "@oligarchy/shared/domain/SessionMode",
});
export type SessionMode = typeof SessionMode.Type;

export const StopStatus = Schema.Literals(["succeeded", "failed", "aborted", "completed"]).annotate(
  {
    identifier: "@oligarchy/shared/domain/StopStatus",
  },
);
export type StopStatus = typeof StopStatus.Type;

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

// The automation steps for a test result, the twin of the automation_action pgEnum in
// src/db/schema.ts, maintained by hand together. A mint and a drive both boot a guest and so
// reserve one; a mint does not resume, it installs. A diagnose reads the session back and
// reserves a client only.
export const AutomationAction = Schema.Literals(["drive", "diagnose", "mint"]).annotate({
  identifier: "@oligarchy/shared/domain/AutomationAction",
});
export type AutomationAction = typeof AutomationAction.Type;

export class StartBody extends Schema.Class<StartBody>("@oligarchy/shared/contract/StartBody")({
  iso: Schema.NonEmptyString,
  disk: Schema.optionalKey(Schema.String),
  agent: Schema.NonEmptyString,
  // Absent means fresh: only a resume says so.
  mode: Schema.optionalKey(SessionMode),
}) {}

export class StartResponse extends Schema.Class<StartResponse>(
  "@oligarchy/shared/contract/StartResponse",
)({
  id: Schema.String,
}) {}

// The wire carries the STRING "true", as it always has.
export class Ok extends Schema.Class<Ok>("@oligarchy/shared/contract/Ok")({
  ok: Schema.Literal("true").pipe(Schema.withConstructorDefault(Effect.succeed("true"))),
}) {}

// Query fields for /image and /serial; a plain object so the client passes it as the query.
export const SessionQuery = { id: Schema.String, agent: Schema.NonEmptyString };

export class SendKeysBody extends Schema.Class<SendKeysBody>(
  "@oligarchy/shared/contract/SendKeysBody",
)({
  id: Schema.String,
  keys: Schema.String,
  encoding: Schema.optionalKey(Schema.String),
  agent: Schema.NonEmptyString,
}) {}

// The mouse operations, one body each. Points stay plain numbers: the range check is a
// handler-level BadRequest with a fixed message, as it always was.
export class MouseMoveBody extends Schema.Class<MouseMoveBody>(
  "@oligarchy/shared/contract/MouseMoveBody",
)({
  id: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  agent: Schema.NonEmptyString,
}) {}

// A click and a double-click: the button, and the keys held around it.
export class MouseClickBody extends Schema.Class<MouseClickBody>(
  "@oligarchy/shared/contract/MouseClickBody",
)({
  id: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  button: ClickButton,
  modifiers: Schema.optionalKey(Schema.NonEmptyArray(MouseModifier)),
  agent: Schema.NonEmptyString,
}) {}

export class MouseScrollBody extends Schema.Class<MouseScrollBody>(
  "@oligarchy/shared/contract/MouseScrollBody",
)({
  id: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  direction: ScrollDirection,
  ticks: Schema.Number,
  agent: Schema.NonEmptyString,
}) {}

// The button goes down at `from`, the pointer moves to `to` in steps, the button comes up.
export class MouseDragBody extends Schema.Class<MouseDragBody>(
  "@oligarchy/shared/contract/MouseDragBody",
)({
  id: Schema.String,
  from: ScreenPoint,
  to: ScreenPoint,
  button: ClickButton,
  modifiers: Schema.optionalKey(Schema.NonEmptyArray(MouseModifier)),
  agent: Schema.NonEmptyString,
}) {}

// A hold and a release: a button at a point, half a click each.
export class MouseButtonBody extends Schema.Class<MouseButtonBody>(
  "@oligarchy/shared/contract/MouseButtonBody",
)({
  id: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  button: ClickButton,
  agent: Schema.NonEmptyString,
}) {}

export class StopBody extends Schema.Class<StopBody>("@oligarchy/shared/contract/StopBody")({
  id: Schema.String,
  agent: Schema.NonEmptyString,
  status: Schema.optionalKey(StopStatus),
  reason: Schema.optionalKey(Schema.String),
}) {}

export class SaveBody extends Schema.Class<SaveBody>("@oligarchy/shared/contract/SaveBody")({
  id: Schema.String,
  agent: Schema.NonEmptyString,
}) {}

export class IntentStartBody extends Schema.Class<IntentStartBody>(
  "@oligarchy/shared/contract/IntentStartBody",
)({
  id: Schema.String,
  agent: Schema.NonEmptyString,
  test_result_id: Schema.NonEmptyString,
  message: Schema.NonEmptyString,
}) {}

export class IntentEndBody extends Schema.Class<IntentEndBody>(
  "@oligarchy/shared/contract/IntentEndBody",
)({
  id: Schema.String,
  agent: Schema.NonEmptyString,
}) {}

export class Memory extends Schema.Class<Memory>("@oligarchy/shared/contract/Memory")({
  totalBytes: Schema.Int,
  usedBytes: Schema.Int,
  freeBytes: Schema.Int,
}) {}

// Percent busy: mean and the percentiles over the sampler's five-minute window, and the mean
// over its newest one, two and three minutes.
export class Cpu extends Schema.Class<Cpu>("@oligarchy/shared/contract/Cpu")({
  cores: Schema.Int,
  mean: Schema.Number,
  mean1m: Schema.Number,
  mean2m: Schema.Number,
  mean3m: Schema.Number,
  p10: Schema.Number,
  p25: Schema.Number,
  p75: Schema.Number,
  p90: Schema.Number,
}) {}

export class Stats extends Schema.Class<Stats>("@oligarchy/shared/contract/Stats")({
  qemus: Schema.Int,
  memory: Memory,
  cpu: Cpu,
}) {}

// POST and DELETE /servers on the reverse proxy: the one server the operator names.
export class ServerBody extends Schema.Class<ServerBody>("@oligarchy/shared/contract/ServerBody")({
  url: ServerUrl,
}) {}

// One registered server as GET /servers reports it; stats is null when its probe failed.
export class Server extends Schema.Class<Server>("@oligarchy/shared/contract/Server")({
  url: Schema.String,
  stats: Schema.NullOr(Stats),
}) {}

export class Servers extends Schema.Class<Servers>("@oligarchy/shared/contract/Servers")({
  servers: Schema.Array(Server),
}) {}

// GET /minted?iso=: any name is a fair question; a name nothing was saved under is not minted.
export const MintedQuery = { iso: Schema.NonEmptyString };

// A qemu server's answer: whether this machine holds the iso's minted disk.
export class Minted extends Schema.Class<Minted>("@oligarchy/shared/contract/Minted")({
  iso: Schema.String,
  minted: Schema.Boolean,
}) {}

// The reverse proxy's answer, one row per registered qemu server; unreachable is a server that
// gave no answer of its own.
export const MintedState = Schema.Literals(["minted", "unminted", "unreachable"]).annotate({
  identifier: "@oligarchy/shared/contract/MintedState",
});
export type MintedState = typeof MintedState.Type;

export class MintedServer extends Schema.Class<MintedServer>(
  "@oligarchy/shared/contract/MintedServer",
)({
  url: Schema.String,
  state: MintedState,
}) {}

export class MintedServers extends Schema.Class<MintedServers>(
  "@oligarchy/shared/contract/MintedServers",
)({
  iso: Schema.String,
  servers: Schema.Array(MintedServer),
}) {}

export class RunBody extends Schema.Class<RunBody>("@oligarchy/shared/contract/RunBody")({
  prompt: Schema.String,
  // The ticket is the agent id. The harness looks up the result, the definition, the
  // proof, the server, and whether start resumes. The model does not send any of those.
  ticket: Schema.NonEmptyString,
}) {}

// What an automation client is asked to hold for a ticket: a mint and a drive take a guest slot
// and a client slot, a diagnose a client slot alone. resume is the iso a drive must boot.
export class ReserveBody extends Schema.Class<ReserveBody>(
  "@oligarchy/shared/contract/ReserveBody",
)({
  ticket: Schema.NonEmptyString,
  action: AutomationAction,
  // Absent is a diagnose or a fresh drive. The key is left off, never sent as null.
  // A mint requires it: the qemu server the setup lock named. The handler refuses a mint without one.
  resume: Schema.optionalKey(Schema.NonEmptyString),
  server: Schema.optionalKey(ServerUrl),
}) {}

export class ReserveAgentBody extends Schema.Class<ReserveAgentBody>(
  "@oligarchy/shared/contract/ReserveAgentBody",
)({
  agent: Schema.NonEmptyString,
  // The one server this reserve may land on, by the url the fleet knows it under. The proxy
  // sends the reserve there and nowhere else. That server refuses it when the url is not its own.
  server: Schema.optionalKey(ServerUrl),
  // Present when this reserve is a resume: the iso url whose minted disk the slot must boot.
  // Absent is a fresh placement.
  resume: Schema.optionalKey(Schema.NonEmptyString),
}) {}

// The automation client's abort: what it runs for the ticket, one job at a time.
export class AbortBody extends Schema.Class<AbortBody>("@oligarchy/shared/contract/AbortBody")({
  ticket: Schema.NonEmptyString,
}) {}

// The automation server's abort names the job: a ticket has one drive and one diagnose, and the
// dashboard's click is on one of them, so a stale click cannot stop the other.
export class AbortJobBody extends Schema.Class<AbortJobBody>(
  "@oligarchy/shared/contract/AbortJobBody",
)({
  ticket: Schema.NonEmptyString,
  action: AutomationAction,
}) {}

const STORED_IMAGE_ORIGIN = "https://oligarchy.trm.sh";

export const StoredImageUrl = (id: string): string => `${STORED_IMAGE_ORIGIN}/images/${id}`;
