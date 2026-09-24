import { Result, Schema } from "effect";
import * as Render from "../observability/render.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";
import type * as Tools from "../harness/tools.ts";

// One drive call. The harness already has the agent, the session, and the server, so none of
// those are fields. x and y are fractions of the screenshot.
const Unit = Schema.Finite.check(
  Schema.isBetween(
    { minimum: 0, maximum: 1 },
    { message: "a point is a fraction of the screenshot, 0..1" },
  ),
).annotate({
  identifier: "@oligarchy/driver/reply/Unit",
  description: "Fraction of the screenshot, from 0 to 1.",
});

const Ticks = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 100 }, { message: "ticks are 1..100" }),
).annotate({
  identifier: "@oligarchy/driver/reply/Ticks",
  description: "How many wheel clicks, from 1 to 100.",
});

const Point = { x: Unit, y: Unit };

const Click = {
  ...Point,
  button: Schema.optionalKey(Domain.ClickButton),
  modifier: Schema.optionalKey(Schema.Array(Domain.MouseModifier)),
};

export const Action = Schema.TaggedUnion({
  "send-keys": { keys: Schema.NonEmptyString },
  move: Point,
  click: Click,
  "double-click": Click,
  scroll: { ...Point, direction: Domain.ScrollDirection, ticks: Schema.optionalKey(Ticks) },
  drag: {
    fromX: Unit,
    fromY: Unit,
    toX: Unit,
    toY: Unit,
    button: Schema.optionalKey(Domain.ClickButton),
    modifier: Schema.optionalKey(Schema.Array(Domain.MouseModifier)),
  },
  hold: { ...Point, button: Schema.optionalKey(Domain.ClickButton) },
  release: { ...Point, button: Schema.optionalKey(Domain.ClickButton) },
  "get-image": {},
  "get-serial": {},
  start: {
    resume: Schema.optionalKey(Schema.Boolean),
    iso: Schema.optionalKey(Schema.NonEmptyString),
    disk: Schema.optionalKey(Schema.NonEmptyString),
  },
  stop: {
    status: Schema.optionalKey(Domain.StopStatus),
    reason: Schema.optionalKey(Schema.NonEmptyString),
  },
  save: {},
  reserve: {},
  relinquish: {},
  follow: {},
  // Not a client command. The loop goes to the next step.
  update_screenshot: {},
}).annotate({ identifier: "@oligarchy/driver/reply/Action" });
export type Action = typeof Action.Type;

export const Reply = Schema.Struct({
  reason: Schema.NonEmptyString.annotate({
    description: "Why this step, in a few words.",
  }),
  completes: Schema.Boolean.annotate({
    description: "True ends the run and does not run the action. False runs it.",
  }),
  action: Action,
}).annotate({ identifier: "@oligarchy/driver/reply/Reply" });
export type Reply = typeof Reply.Type;

// Inline every named schema. A $ref root is not a tool schema.
const document = Schema.toJsonSchemaDocument(Reply, { referencePolicy: () => undefined });

export const TOOL = {
  type: "function" as const,
  function: {
    name: "drive" as const,
    description: "One guest action, or the end of the run.",
    parameters: document.schema,
  },
};

const decodeReply = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.toCodecJson(Reply)), {
  onExcessProperty: "error",
});

const fail = (message: string): Result.Result<never, Errors.ToolError> =>
  Result.fail(Errors.ToolError.make({ message }));

export type Connection = {
  readonly agentId: string;
  readonly serverUrl: string;
  readonly sessionId: string | undefined;
};

// start, reserve, and relinquish name no session. Everything else does.
const needsSession = (action: Action): boolean =>
  action._tag !== "start" && action._tag !== "reserve" && action._tag !== "relinquish";

const flag = (name: string, value: string | undefined): ReadonlyArray<string> =>
  value === undefined ? [] : [`--${name}`, value];

const modifiers = (
  modifier: ReadonlyArray<Domain.MouseModifier> | undefined,
): ReadonlyArray<string> => {
  if (modifier === undefined) {
    return [];
  }
  const flags: Array<string> = [];
  for (const key of modifier) {
    flags.push("--modifier", key);
  }
  return flags;
};

const point = (x: number, y: number): ReadonlyArray<string> => ["--x", String(x), "--y", String(y)];

export const parse = (call: {
  readonly name: string;
  readonly arguments: string;
}): Result.Result<Reply, Errors.ToolError> => {
  if (call.name !== "drive") {
    return fail(`reply: unknown tool "${call.name}"`);
  }
  const decoded = decodeReply(call.arguments);
  if (Result.isFailure(decoded)) {
    return fail(`reply: ${Render.headline(decoded.failure)}`);
  }
  return Result.succeed(decoded.success);
};

// The typed action plus the connection the harness already holds.
export const command = (
  action: Action,
  connection: Connection,
): Result.Result<Tools.CommandLine, Errors.ToolError> => {
  if (action._tag === "update_screenshot") {
    return fail("client: update_screenshot is not a command");
  }
  const sessionId = connection.sessionId;
  if (needsSession(action) && sessionId === undefined) {
    return fail("client: this action needs a session");
  }
  const shared = [
    "--agent-id",
    connection.agentId,
    "--server-url",
    connection.serverUrl,
    ...(sessionId === undefined || !needsSession(action) ? [] : ["--session-id", sessionId]),
  ];
  const args = Action.match(action, {
    "send-keys": (value) => ["send-keys", ...shared, "--keys", value.keys],
    move: (value) => ["mouse", "move", ...shared, ...point(value.x, value.y)],
    click: (value) => [
      "mouse",
      "click",
      ...shared,
      ...point(value.x, value.y),
      ...flag("button", value.button),
      ...modifiers(value.modifier),
    ],
    "double-click": (value) => [
      "mouse",
      "double-click",
      ...shared,
      ...point(value.x, value.y),
      ...flag("button", value.button),
      ...modifiers(value.modifier),
    ],
    scroll: (value) => [
      "mouse",
      "scroll",
      ...shared,
      ...point(value.x, value.y),
      "--direction",
      value.direction,
      ...flag("ticks", value.ticks === undefined ? undefined : String(value.ticks)),
    ],
    drag: (value) => [
      "mouse",
      "drag",
      ...shared,
      "--from-x",
      String(value.fromX),
      "--from-y",
      String(value.fromY),
      "--to-x",
      String(value.toX),
      "--to-y",
      String(value.toY),
      ...flag("button", value.button),
      ...modifiers(value.modifier),
    ],
    hold: (value) => [
      "mouse",
      "hold",
      ...shared,
      ...point(value.x, value.y),
      ...flag("button", value.button),
    ],
    release: (value) => [
      "mouse",
      "release",
      ...shared,
      ...point(value.x, value.y),
      ...flag("button", value.button),
    ],
    "get-image": () => ["get-image", ...shared],
    "get-serial": () => ["get-serial", ...shared],
    start: (value) => [
      "start",
      ...shared,
      ...(value.resume === true ? ["--resume"] : []),
      ...flag("iso", value.iso),
      ...flag("disk", value.disk),
    ],
    stop: (value) => [
      "stop",
      ...shared,
      ...flag("status", value.status),
      ...flag("reason", value.reason),
    ],
    save: () => ["save", ...shared],
    reserve: () => ["reserve", ...shared],
    relinquish: () => ["relinquish", ...shared],
    follow: () => ["follow", ...shared],
    update_screenshot: () => [],
  });
  return Result.succeed({ bin: "./client", args });
};
