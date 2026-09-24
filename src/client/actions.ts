import {
  Array as Arr,
  Cause,
  Console,
  Effect,
  Exit,
  FileSystem,
  Option,
  Path,
  Result,
  Schema,
  Stdio,
  Stream,
} from "effect";
import * as CliError from "effect/unstable/cli/CliError";
import * as Config from "../config.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Render from "../observability/render.ts";
import * as Contract from "../shared/contract.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";
import * as Flags from "./flags.ts";
import * as ProxyClient from "./proxy-client.ts";

// Every action reads the token before anything else, so `OLIGARCHY_TOKEN is not set` precedes
// the local checks and the request alike.
const connect = Effect.fn("client.connect")(function* (serverUrl: string) {
  const token = yield* Config.oligarchyToken;
  return yield* ProxyClient.connect({ serverUrl, token });
});

const localIso = Effect.fn("client.localIso")(function* (iso: string) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const absolute = path.resolve(iso);
  yield* fs.stat(absolute).pipe(
    Effect.mapError((error) =>
      Errors.CommandError.make({
        message: `iso: ${ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), error.message)}`,
      }),
    ),
  );
  return absolute;
});

const emit = Effect.fn("client.emit")(function* (output: Option.Option<string>, bytes: Uint8Array) {
  if (Option.isSome(output)) {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFile(output.value, bytes, { mode: 0o644 });
    return;
  }
  const stdio = yield* Stdio.Stdio;
  yield* Stream.run(Stream.make(bytes), stdio.stdout());
});

export type Shared = {
  readonly agentId: string;
  readonly serverUrl: string;
};

export type StartInput = Shared & {
  readonly iso: string;
  readonly disk: Option.Option<string>;
  readonly resume: boolean;
};

export const start = Effect.fn("client.start")(function* (input: StartInput) {
  const proxy = yield* connect(input.serverUrl);
  const path = yield* Path.Path;
  if (input.resume && Option.isSome(input.disk)) {
    return yield* new CliError.UserError({
      cause: new Error("--resume with --disk"),
      userMessage: "start: --resume boots the minted disk; --disk cannot be given",
    });
  }
  if (input.resume) {
    const iso = Domain.isIsoUrl(input.iso) ? input.iso : path.resolve(input.iso);
    const started = yield* proxy.start(
      Contract.StartBody.make({ iso, agent: input.agentId, mode: "resume" }),
    );
    return yield* Console.log(started.id);
  }
  const iso = Domain.isIsoUrl(input.iso) ? input.iso : yield* localIso(input.iso);
  const body = Option.match(input.disk, {
    onNone: () => Contract.StartBody.make({ iso, agent: input.agentId }),
    onSome: (disk) =>
      Contract.StartBody.make({ iso, disk: path.resolve(disk), agent: input.agentId }),
  });
  const started = yield* proxy.start(body);
  return yield* Console.log(started.id);
});

export type ReserveInput = Shared & {
  readonly server: Option.Option<Domain.ServerUrl>;
};

export const reserve = Effect.fn("client.reserve")(function* (input: ReserveInput) {
  const proxy = yield* connect(input.serverUrl);
  const body = Option.match(input.server, {
    onNone: () => Contract.ReserveAgentBody.make({ agent: input.agentId }),
    onSome: (server) => Contract.ReserveAgentBody.make({ agent: input.agentId, server }),
  });
  yield* proxy.reserve(body);
});

export const relinquish = Effect.fn("client.relinquish")(function* (input: Shared) {
  const proxy = yield* connect(input.serverUrl);
  yield* proxy.relinquish(Contract.ReserveAgentBody.make({ agent: input.agentId }));
});

export type CaptureInput = Shared & {
  readonly sessionId: string;
  readonly output: Option.Option<string>;
};

export const getImage = Effect.fn("client.getImage")(function* (input: CaptureInput) {
  const proxy = yield* connect(input.serverUrl);
  const bytes = yield* proxy.image(input.sessionId, input.agentId);
  yield* emit(input.output, bytes);
});

export const getSerial = Effect.fn("client.getSerial")(function* (input: CaptureInput) {
  const proxy = yield* connect(input.serverUrl);
  const bytes = yield* proxy.serial(input.sessionId, input.agentId);
  yield* emit(input.output, bytes);
});

export type SendKeysInput = Shared & {
  readonly sessionId: string;
  readonly keys: string;
  readonly encoding: string;
};

export const sendKeys = Effect.fn("client.sendKeys")(function* (input: SendKeysInput) {
  const proxy = yield* connect(input.serverUrl);
  yield* proxy.sendKeys(
    Contract.SendKeysBody.make({
      id: input.sessionId,
      keys: input.keys,
      encoding: input.encoding,
      agent: input.agentId,
    }),
  );
});

export type PointInput = Shared & {
  readonly sessionId: string;
  readonly x: number;
  readonly y: number;
};

export const mouseMove = Effect.fn("client.mouse.move")(function* (input: PointInput) {
  const proxy = yield* connect(input.serverUrl);
  yield* proxy.mouseMove(
    Contract.MouseMoveBody.make({
      id: input.sessionId,
      x: input.x,
      y: input.y,
      agent: input.agentId,
    }),
  );
});

export type ClickInput = PointInput & {
  readonly button: Domain.ClickButton;
  readonly modifier: ReadonlyArray<Domain.MouseModifier>;
};

const clickBody = (input: ClickInput) =>
  Contract.MouseClickBody.make(
    Object.assign(
      { id: input.sessionId, x: input.x, y: input.y, button: input.button, agent: input.agentId },
      Arr.isReadonlyArrayNonEmpty(input.modifier) ? { modifiers: input.modifier } : undefined,
    ),
  );

export const mouseClick = Effect.fn("client.mouse.click")(function* (input: ClickInput) {
  const proxy = yield* connect(input.serverUrl);
  yield* proxy.mouseClick(clickBody(input));
});

export const mouseDoubleClick = Effect.fn("client.mouse.doubleClick")(function* (
  input: ClickInput,
) {
  const proxy = yield* connect(input.serverUrl);
  yield* proxy.mouseDoubleClick(clickBody(input));
});

export type ScrollInput = PointInput & {
  readonly direction: Domain.ScrollDirection;
  readonly ticks: number;
};

export const mouseScroll = Effect.fn("client.mouse.scroll")(function* (input: ScrollInput) {
  const proxy = yield* connect(input.serverUrl);
  yield* proxy.mouseScroll(
    Contract.MouseScrollBody.make({
      id: input.sessionId,
      x: input.x,
      y: input.y,
      direction: input.direction,
      ticks: input.ticks,
      agent: input.agentId,
    }),
  );
});

export type DragInput = Shared & {
  readonly sessionId: string;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly button: Domain.ClickButton;
  readonly modifier: ReadonlyArray<Domain.MouseModifier>;
};

export const mouseDrag = Effect.fn("client.mouse.drag")(function* (input: DragInput) {
  const proxy = yield* connect(input.serverUrl);
  yield* proxy.mouseDrag(
    Contract.MouseDragBody.make(
      Object.assign(
        {
          id: input.sessionId,
          from: { x: input.fromX, y: input.fromY },
          to: { x: input.toX, y: input.toY },
          button: input.button,
          agent: input.agentId,
        },
        Arr.isReadonlyArrayNonEmpty(input.modifier) ? { modifiers: input.modifier } : undefined,
      ),
    ),
  );
});

export type ButtonInput = PointInput & {
  readonly button: Domain.ClickButton;
};

const buttonBody = (input: ButtonInput) =>
  Contract.MouseButtonBody.make({
    id: input.sessionId,
    x: input.x,
    y: input.y,
    button: input.button,
    agent: input.agentId,
  });

export const mouseHold = Effect.fn("client.mouse.hold")(function* (input: ButtonInput) {
  const proxy = yield* connect(input.serverUrl);
  yield* proxy.mouseHold(buttonBody(input));
});

export const mouseRelease = Effect.fn("client.mouse.release")(function* (input: ButtonInput) {
  const proxy = yield* connect(input.serverUrl);
  yield* proxy.mouseRelease(buttonBody(input));
});

export type IntentStartInput = Shared & {
  readonly sessionId: string;
  readonly testResultId: string;
  readonly message: string;
};

export const intentStart = Effect.fn("client.intentStart")(function* (input: IntentStartInput) {
  const proxy = yield* connect(input.serverUrl);
  yield* proxy.intentStart(
    Contract.IntentStartBody.make({
      id: input.sessionId,
      agent: input.agentId,
      test_result_id: input.testResultId,
      message: input.message,
    }),
  );
});

export type IntentEndInput = Shared & {
  readonly sessionId: string;
};

export const intentEnd = Effect.fn("client.intentEnd")(function* (input: IntentEndInput) {
  const proxy = yield* connect(input.serverUrl);
  yield* proxy.intentEnd(
    Contract.IntentEndBody.make({ id: input.sessionId, agent: input.agentId }),
  );
});

export type StopInput = Shared & {
  readonly sessionId: string;
  readonly status: Option.Option<Domain.StopStatus>;
  readonly reason: Option.Option<string>;
};

export const stop = Effect.fn("client.stop")(function* (input: StopInput) {
  const proxy = yield* connect(input.serverUrl);
  const base = { id: input.sessionId, agent: input.agentId };
  const withStatus = Option.match(input.status, {
    onNone: () => base,
    onSome: (status) => ({ ...base, status }),
  });
  const body = Option.match(input.reason, {
    onNone: () => Contract.StopBody.make(withStatus),
    onSome: (reason) => Contract.StopBody.make({ ...withStatus, reason }),
  });
  yield* proxy.stop(body);
});

export type SaveInput = Shared & {
  readonly sessionId: string;
};

export const save = Effect.fn("client.save")(function* (input: SaveInput) {
  const proxy = yield* connect(input.serverUrl);
  yield* proxy.save(Contract.SaveBody.make({ id: input.sessionId, agent: input.agentId }));
  yield* Console.log("saved");
});

export const follow = Effect.fn("client.follow")(function* (input: SaveInput) {
  const proxy = yield* connect(input.serverUrl);
  const stdio = yield* Stdio.Stdio;
  const stream = yield* proxy.follow(input.sessionId);
  yield* Stream.run(stream, stdio.stdout());
});

// The name the model writes is the function. `mouse click` is mouseClick.
export const byName = {
  start,
  reserve,
  relinquish,
  "get-image": getImage,
  "get-serial": getSerial,
  "send-keys": sendKeys,
  "mouse move": mouseMove,
  "mouse click": mouseClick,
  "mouse double-click": mouseDoubleClick,
  "mouse scroll": mouseScroll,
  "mouse drag": mouseDrag,
  "mouse hold": mouseHold,
  "mouse release": mouseRelease,
  "intent start": intentStart,
  "intent end": intentEnd,
  stop,
  save,
  follow,
} as const;

type ActionName = keyof typeof byName;

const isActionName = (name: string): name is ActionName =>
  Object.prototype.hasOwnProperty.call(byName, name);

type Mode = "value" | "switch" | "repeat";

type Field = {
  readonly key: string;
  readonly names: ReadonlyArray<string>;
  readonly mode: Mode;
};

const fail = (message: string): Result.Result<never, Errors.CommandError> =>
  Result.fail(Errors.CommandError.make({ message }));

const shown = (name: string, short: boolean): string => (short ? `-${name}` : `--${name}`);

const readFlags = (
  tokens: ReadonlyArray<string>,
  fields: ReadonlyArray<Field>,
): Result.Result<ReadonlyMap<string, ReadonlyArray<string>>, Errors.CommandError> => {
  const byFlag = new Map<string, Field>();
  for (const field of fields) {
    for (const name of field.names) {
      byFlag.set(name, field);
    }
  }
  const values = new Map<string, Array<string>>();
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (!token.startsWith("-")) {
      return fail(`unexpected argument ${token}`);
    }
    const short = !token.startsWith("--");
    const body = short ? token.slice(1) : token.slice(2);
    const eq = body.indexOf("=");
    const name = eq === -1 ? body : body.slice(0, eq);
    const inline = eq === -1 ? undefined : body.slice(eq + 1);
    if (name === "") {
      return fail(`unknown flag ${token}`);
    }
    const field = byFlag.get(name);
    if (field === undefined) {
      return fail(`unknown flag ${shown(name, short)}`);
    }
    index += 1;
    let value = inline;
    if (value === undefined) {
      if (field.mode === "switch") {
        value = "true";
      } else {
        const next = tokens[index];
        if (next === undefined || next.startsWith("-")) {
          return fail(`missing value for ${shown(name, short)}`);
        }
        value = next;
        index += 1;
      }
    }
    const list = values.get(field.key) ?? [];
    if (field.mode !== "repeat" && list.length > 0) {
      return fail(`duplicate flag --${field.key}`);
    }
    list.push(value);
    values.set(field.key, list);
  }
  return Result.succeed(values);
};

const first = (
  values: ReadonlyMap<string, ReadonlyArray<string>>,
  key: string,
): string | undefined => values.get(key)?.[0];

const requireText = (
  values: ReadonlyMap<string, ReadonlyArray<string>>,
  key: string,
): Result.Result<string, Errors.CommandError> => {
  const value = first(values, key);
  if (value === undefined || value === "") {
    return fail(`missing --${key}`);
  }
  return Result.succeed(value);
};

const fromExit = <A>(
  exit: Exit.Exit<A, Schema.SchemaError>,
  flag: string,
): Result.Result<A, Errors.CommandError> => {
  if (Exit.isFailure(exit)) {
    return fail(`--${flag}: ${Render.headline(Cause.squash(exit.cause))}`);
  }
  return Result.succeed(exit.value);
};

const text = (
  values: ReadonlyMap<string, ReadonlyArray<string>>,
  key: string,
): Result.Result<string, Errors.CommandError> => {
  const raw = requireText(values, key);
  if (Result.isFailure(raw)) {
    return fail(raw.failure.message);
  }
  return fromExit(Schema.decodeUnknownExit(Schema.NonEmptyString)(raw.success), key);
};

const optionalText = (
  values: ReadonlyMap<string, ReadonlyArray<string>>,
  key: string,
): Result.Result<Option.Option<string>, Errors.CommandError> => {
  const value = first(values, key);
  if (value === undefined) {
    return Result.succeed(Option.none());
  }
  return Result.succeed(Option.some(value));
};

const point = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }, { message: "must be in 0..1" }),
);

const fromPoint = Schema.Number.check(
  Schema.isBetween(
    { minimum: 0, maximum: 1 },
    { message: "mouse drag: --from-x and --from-y must be in 0..1" },
  ),
);

const toPoint = Schema.Number.check(
  Schema.isBetween(
    { minimum: 0, maximum: 1 },
    { message: "mouse drag: --to-x and --to-y must be in 0..1" },
  ),
);

const ticksSchema = Schema.Number.check(
  Schema.isBetween(
    { minimum: 1, maximum: 100 },
    { message: "mouse scroll: --ticks must be in 1..100" },
  ),
);

const numberOf = (
  values: ReadonlyMap<string, ReadonlyArray<string>>,
  key: string,
  schema: typeof point,
): Result.Result<number, Errors.CommandError> => {
  const raw = requireText(values, key);
  if (Result.isFailure(raw)) {
    return fail(raw.failure.message);
  }
  const value = Number(raw.success);
  if (!Number.isFinite(value)) {
    return fail(`--${key} is not a number`);
  }
  return fromExit(Schema.decodeUnknownExit(schema)(value), key);
};

const sharedFields: ReadonlyArray<Field> = [
  { key: "agent-id", names: ["agent-id"], mode: "value" },
  { key: "server-url", names: ["server-url"], mode: "value" },
];

const sessionField: Field = { key: "session-id", names: ["session-id"], mode: "value" };

const outputField: Field = { key: "output", names: ["output", "o"], mode: "value" };

const buttonField: Field = { key: "button", names: ["button"], mode: "value" };

const modifierField: Field = { key: "modifier", names: ["modifier"], mode: "repeat" };

const pointFields: ReadonlyArray<Field> = [
  ...sharedFields,
  sessionField,
  { key: "x", names: ["x"], mode: "value" },
  { key: "y", names: ["y"], mode: "value" },
];

const serverUrlOf = Effect.fn("client.serverUrl")(function* (
  values: ReadonlyMap<string, ReadonlyArray<string>>,
) {
  const given = first(values, "server-url");
  if (given !== undefined && given !== "") {
    return given;
  }
  return yield* Config.serverUrl.pipe(Effect.orElseSucceed(() => Config.DEFAULT_SERVER_URL));
});

const sharedOf = Effect.fn("client.shared")(function* (
  values: ReadonlyMap<string, ReadonlyArray<string>>,
) {
  const agent = text(values, "agent-id");
  if (Result.isFailure(agent)) {
    return yield* agent.failure;
  }
  return {
    agentId: agent.success,
    serverUrl: yield* serverUrlOf(values),
  } satisfies Shared;
});

const fieldsOf = (
  tokens: ReadonlyArray<string>,
  fields: ReadonlyArray<Field>,
): Effect.Effect<ReadonlyMap<string, ReadonlyArray<string>>, Errors.CommandError> =>
  Effect.fromResult(readFlags(tokens, fields));

const sessionOf = (
  values: ReadonlyMap<string, ReadonlyArray<string>>,
): Result.Result<string, Errors.CommandError> => text(values, "session-id");

const pointOf = (
  values: ReadonlyMap<string, ReadonlyArray<string>>,
): Result.Result<{ readonly x: number; readonly y: number }, Errors.CommandError> => {
  const x = numberOf(values, "x", point);
  if (Result.isFailure(x)) {
    return fail(x.failure.message);
  }
  const y = numberOf(values, "y", point);
  if (Result.isFailure(y)) {
    return fail(y.failure.message);
  }
  return Result.succeed({ x: x.success, y: y.success });
};

const buttonOf = (
  values: ReadonlyMap<string, ReadonlyArray<string>>,
): Result.Result<Domain.ClickButton, Errors.CommandError> => {
  const raw = first(values, "button") ?? "left";
  return fromExit(Schema.decodeUnknownExit(Domain.ClickButton)(raw), "button");
};

const modifiersOf = (
  values: ReadonlyMap<string, ReadonlyArray<string>>,
): Result.Result<ReadonlyArray<Domain.MouseModifier>, Errors.CommandError> => {
  const raw = values.get("modifier") ?? [];
  const modifiers: Array<Domain.MouseModifier> = [];
  for (const value of raw) {
    const one = fromExit(Schema.decodeUnknownExit(Domain.MouseModifier)(value), "modifier");
    if (Result.isFailure(one)) {
      return fail(one.failure.message);
    }
    modifiers.push(one.success);
  }
  return Result.succeed(modifiers);
};

const runStart = Effect.fn("client.call.start")(function* (tokens: ReadonlyArray<string>) {
  const values = yield* fieldsOf(tokens, [
    ...sharedFields,
    { key: "iso", names: ["iso"], mode: "value" },
    { key: "disk", names: ["disk"], mode: "value" },
    { key: "resume", names: ["resume"], mode: "switch" },
  ]);
  const shared = yield* sharedOf(values);
  const disk = optionalText(values, "disk");
  if (Result.isFailure(disk)) {
    return yield* disk.failure;
  }
  return yield* start({
    ...shared,
    iso: first(values, "iso") ?? Flags.DEFAULT_ISO,
    disk: disk.success,
    resume: first(values, "resume") === "true",
  });
});

const runReserve = Effect.fn("client.call.reserve")(function* (tokens: ReadonlyArray<string>) {
  const values = yield* fieldsOf(tokens, [
    ...sharedFields,
    { key: "server", names: ["server"], mode: "value" },
  ]);
  const shared = yield* sharedOf(values);
  const raw = first(values, "server");
  const server =
    raw === undefined
      ? Option.none<Domain.ServerUrl>()
      : Option.some(
          yield* Effect.fromResult(
            fromExit(Schema.decodeUnknownExit(Domain.ServerUrl)(raw), "server"),
          ),
        );
  return yield* reserve({
    ...shared,
    server,
  });
});

const runRelinquish = Effect.fn("client.call.relinquish")(function* (
  tokens: ReadonlyArray<string>,
) {
  const values = yield* fieldsOf(tokens, sharedFields);
  return yield* relinquish(yield* sharedOf(values));
});

const captureFields: ReadonlyArray<Field> = [...sharedFields, sessionField, outputField];

const runCapture = Effect.fn("client.call.capture")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof getImage | typeof getSerial,
) {
  const values = yield* fieldsOf(tokens, captureFields);
  const shared = yield* sharedOf(values);
  const sessionId = sessionOf(values);
  if (Result.isFailure(sessionId)) {
    return yield* sessionId.failure;
  }
  const output = optionalText(values, "output");
  if (Result.isFailure(output)) {
    return yield* output.failure;
  }
  return yield* action({ ...shared, sessionId: sessionId.success, output: output.success });
});

const runSendKeys = Effect.fn("client.call.sendKeys")(function* (tokens: ReadonlyArray<string>) {
  const values = yield* fieldsOf(tokens, [
    ...sharedFields,
    sessionField,
    { key: "keys", names: ["keys"], mode: "value" },
    { key: "encoding", names: ["encoding"], mode: "value" },
  ]);
  const shared = yield* sharedOf(values);
  const sessionId = sessionOf(values);
  if (Result.isFailure(sessionId)) {
    return yield* sessionId.failure;
  }
  const keys = requireText(values, "keys");
  if (Result.isFailure(keys)) {
    return yield* keys.failure;
  }
  return yield* sendKeys({
    ...shared,
    sessionId: sessionId.success,
    keys: keys.success,
    encoding: first(values, "encoding") ?? Flags.DEFAULT_ENCODING,
  });
});

const runMove = Effect.fn("client.call.mouseMove")(function* (tokens: ReadonlyArray<string>) {
  const values = yield* fieldsOf(tokens, pointFields);
  const shared = yield* sharedOf(values);
  const sessionId = sessionOf(values);
  if (Result.isFailure(sessionId)) {
    return yield* sessionId.failure;
  }
  const at = pointOf(values);
  if (Result.isFailure(at)) {
    return yield* at.failure;
  }
  return yield* mouseMove({ ...shared, sessionId: sessionId.success, ...at.success });
});

const clickFields: ReadonlyArray<Field> = [...pointFields, buttonField, modifierField];

const runClick = Effect.fn("client.call.mouseClick")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof mouseClick | typeof mouseDoubleClick,
) {
  const values = yield* fieldsOf(tokens, clickFields);
  const shared = yield* sharedOf(values);
  const sessionId = sessionOf(values);
  if (Result.isFailure(sessionId)) {
    return yield* sessionId.failure;
  }
  const at = pointOf(values);
  if (Result.isFailure(at)) {
    return yield* at.failure;
  }
  const button = buttonOf(values);
  if (Result.isFailure(button)) {
    return yield* button.failure;
  }
  const modifier = modifiersOf(values);
  if (Result.isFailure(modifier)) {
    return yield* modifier.failure;
  }
  return yield* action({
    ...shared,
    sessionId: sessionId.success,
    ...at.success,
    button: button.success,
    modifier: modifier.success,
  });
});

const runScroll = Effect.fn("client.call.mouseScroll")(function* (tokens: ReadonlyArray<string>) {
  const values = yield* fieldsOf(tokens, [
    ...pointFields,
    { key: "direction", names: ["direction"], mode: "value" },
    { key: "ticks", names: ["ticks"], mode: "value" },
  ]);
  const shared = yield* sharedOf(values);
  const sessionId = sessionOf(values);
  if (Result.isFailure(sessionId)) {
    return yield* sessionId.failure;
  }
  const at = pointOf(values);
  if (Result.isFailure(at)) {
    return yield* at.failure;
  }
  const direction = (() => {
    const raw = requireText(values, "direction");
    if (Result.isFailure(raw)) {
      return fail(raw.failure.message);
    }
    return fromExit(Schema.decodeUnknownExit(Domain.ScrollDirection)(raw.success), "direction");
  })();
  if (Result.isFailure(direction)) {
    return yield* direction.failure;
  }
  const rawTicks = first(values, "ticks");
  const ticks =
    rawTicks === undefined
      ? Result.succeed(1)
      : (() => {
          const parsed = numberOf(values, "ticks", ticksSchema);
          if (Result.isFailure(parsed) || Number.isInteger(parsed.success)) {
            return parsed;
          }
          return fail("mouse scroll: --ticks must be in 1..100");
        })();
  if (Result.isFailure(ticks)) {
    return yield* ticks.failure;
  }
  return yield* mouseScroll({
    ...shared,
    sessionId: sessionId.success,
    ...at.success,
    direction: direction.success,
    ticks: ticks.success,
  });
});

const runDrag = Effect.fn("client.call.mouseDrag")(function* (tokens: ReadonlyArray<string>) {
  const values = yield* fieldsOf(tokens, [
    ...sharedFields,
    sessionField,
    { key: "from-x", names: ["from-x"], mode: "value" },
    { key: "from-y", names: ["from-y"], mode: "value" },
    { key: "to-x", names: ["to-x"], mode: "value" },
    { key: "to-y", names: ["to-y"], mode: "value" },
    buttonField,
    modifierField,
  ]);
  const shared = yield* sharedOf(values);
  const sessionId = sessionOf(values);
  if (Result.isFailure(sessionId)) {
    return yield* sessionId.failure;
  }
  const fromX = numberOf(values, "from-x", fromPoint);
  if (Result.isFailure(fromX)) {
    return yield* fromX.failure;
  }
  const fromY = numberOf(values, "from-y", fromPoint);
  if (Result.isFailure(fromY)) {
    return yield* fromY.failure;
  }
  const toX = numberOf(values, "to-x", toPoint);
  if (Result.isFailure(toX)) {
    return yield* toX.failure;
  }
  const toY = numberOf(values, "to-y", toPoint);
  if (Result.isFailure(toY)) {
    return yield* toY.failure;
  }
  const button = buttonOf(values);
  if (Result.isFailure(button)) {
    return yield* button.failure;
  }
  const modifier = modifiersOf(values);
  if (Result.isFailure(modifier)) {
    return yield* modifier.failure;
  }
  return yield* mouseDrag({
    ...shared,
    sessionId: sessionId.success,
    fromX: fromX.success,
    fromY: fromY.success,
    toX: toX.success,
    toY: toY.success,
    button: button.success,
    modifier: modifier.success,
  });
});

const runButton = Effect.fn("client.call.mouseButton")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof mouseHold | typeof mouseRelease,
) {
  const values = yield* fieldsOf(tokens, [...pointFields, buttonField]);
  const shared = yield* sharedOf(values);
  const sessionId = sessionOf(values);
  if (Result.isFailure(sessionId)) {
    return yield* sessionId.failure;
  }
  const at = pointOf(values);
  if (Result.isFailure(at)) {
    return yield* at.failure;
  }
  const button = buttonOf(values);
  if (Result.isFailure(button)) {
    return yield* button.failure;
  }
  return yield* action({
    ...shared,
    sessionId: sessionId.success,
    ...at.success,
    button: button.success,
  });
});

const runIntentStart = Effect.fn("client.call.intentStart")(function* (
  tokens: ReadonlyArray<string>,
) {
  const values = yield* fieldsOf(tokens, [
    ...sharedFields,
    sessionField,
    { key: "test-result-id", names: ["test-result-id"], mode: "value" },
    { key: "message", names: ["message"], mode: "value" },
  ]);
  const shared = yield* sharedOf(values);
  const sessionId = sessionOf(values);
  if (Result.isFailure(sessionId)) {
    return yield* sessionId.failure;
  }
  const testResultId = text(values, "test-result-id");
  if (Result.isFailure(testResultId)) {
    return yield* testResultId.failure;
  }
  const message = text(values, "message");
  if (Result.isFailure(message)) {
    return yield* message.failure;
  }
  return yield* intentStart({
    ...shared,
    sessionId: sessionId.success,
    testResultId: testResultId.success,
    message: message.success,
  });
});

const runIntentEnd = Effect.fn("client.call.intentEnd")(function* (tokens: ReadonlyArray<string>) {
  const values = yield* fieldsOf(tokens, [...sharedFields, sessionField]);
  const shared = yield* sharedOf(values);
  const sessionId = sessionOf(values);
  if (Result.isFailure(sessionId)) {
    return yield* sessionId.failure;
  }
  return yield* intentEnd({ ...shared, sessionId: sessionId.success });
});

const runStop = Effect.fn("client.call.stop")(function* (tokens: ReadonlyArray<string>) {
  const values = yield* fieldsOf(tokens, [
    ...sharedFields,
    sessionField,
    { key: "status", names: ["status"], mode: "value" },
    { key: "reason", names: ["reason"], mode: "value" },
  ]);
  const shared = yield* sharedOf(values);
  const sessionId = sessionOf(values);
  if (Result.isFailure(sessionId)) {
    return yield* sessionId.failure;
  }
  const rawStatus = first(values, "status");
  const status =
    rawStatus === undefined
      ? Option.none<Domain.StopStatus>()
      : Option.some(
          yield* Effect.fromResult(
            fromExit(Schema.decodeUnknownExit(Domain.StopStatus)(rawStatus), "status"),
          ),
        );
  const reason = optionalText(values, "reason");
  if (Result.isFailure(reason)) {
    return yield* reason.failure;
  }
  return yield* stop({
    ...shared,
    sessionId: sessionId.success,
    status,
    reason: reason.success,
  });
});

const runSave = Effect.fn("client.call.save")(function* (tokens: ReadonlyArray<string>) {
  const values = yield* fieldsOf(tokens, [...sharedFields, sessionField]);
  const shared = yield* sharedOf(values);
  const sessionId = sessionOf(values);
  if (Result.isFailure(sessionId)) {
    return yield* sessionId.failure;
  }
  return yield* save({ ...shared, sessionId: sessionId.success });
});

const runFollow = Effect.fn("client.call.follow")(function* (tokens: ReadonlyArray<string>) {
  const values = yield* fieldsOf(tokens, [...sharedFields, sessionField]);
  const shared = yield* sharedOf(values);
  const sessionId = sessionOf(values);
  if (Result.isFailure(sessionId)) {
    return yield* sessionId.failure;
  }
  return yield* follow({ ...shared, sessionId: sessionId.success });
});

const actionOf = (
  args: ReadonlyArray<string>,
): { readonly name: string; readonly tokens: ReadonlyArray<string> } => {
  const words: Array<string> = [];
  let index = 0;
  while (index < args.length) {
    const token = args[index] ?? "";
    if (token.startsWith("-")) {
      break;
    }
    words.push(token);
    index += 1;
  }
  return { name: words.join(" "), tokens: args.slice(index) };
};

// Find the action by the words the model wrote, then call that function.
export const call = Effect.fn("client.call")(function* (args: ReadonlyArray<string>) {
  const { name, tokens } = actionOf(args);
  if (!isActionName(name)) {
    const label = name === "" ? "missing action" : `unknown action ${name}`;
    return yield* Errors.CommandError.make({ message: label });
  }
  switch (name) {
    case "start":
      return yield* runStart(tokens);
    case "reserve":
      return yield* runReserve(tokens);
    case "relinquish":
      return yield* runRelinquish(tokens);
    case "get-image":
      return yield* runCapture(tokens, getImage);
    case "get-serial":
      return yield* runCapture(tokens, getSerial);
    case "send-keys":
      return yield* runSendKeys(tokens);
    case "mouse move":
      return yield* runMove(tokens);
    case "mouse click":
      return yield* runClick(tokens, mouseClick);
    case "mouse double-click":
      return yield* runClick(tokens, mouseDoubleClick);
    case "mouse scroll":
      return yield* runScroll(tokens);
    case "mouse drag":
      return yield* runDrag(tokens);
    case "mouse hold":
      return yield* runButton(tokens, mouseHold);
    case "mouse release":
      return yield* runButton(tokens, mouseRelease);
    case "intent start":
      return yield* runIntentStart(tokens);
    case "intent end":
      return yield* runIntentEnd(tokens);
    case "stop":
      return yield* runStop(tokens);
    case "save":
      return yield* runSave(tokens);
    case "follow":
      return yield* runFollow(tokens);
  }
  return yield* Errors.CommandError.make({ message: "unknown action" });
});
