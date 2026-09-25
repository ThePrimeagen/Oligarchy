import {
  Array as Arr,
  Config as EffectConfig,
  Console,
  Effect,
  Exit,
  FileSystem,
  Option,
  Path,
  Schema,
  Stdio,
  Stream,
  Terminal,
} from "effect";
import * as CliError from "effect/unstable/cli/CliError";
import * as Flag from "effect/unstable/cli/Flag";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as ExternalFailure from "@oligarchy/log/external-failure";
import * as Contract from "@oligarchy/routes/contract";
import * as Domain from "@oligarchy/shared/domain";
import * as SharedErrors from "@oligarchy/shared/errors";
import * as Config from "../config.ts";
import * as EnvFile from "../env-file.ts";
import * as Flags from "./flags.ts";
import * as ProxyClient from "./proxy-client.ts";

// Every action reads the token before anything else, so `OLIGARCHY_TOKEN is not set` precedes
// the local checks and the request alike.
const connect = Effect.fn("client.connect")(function* (serverUrl: string) {
  const token = yield* Config.oligarchyToken;
  return yield* ProxyClient.connect({ serverUrl, token });
});

// A local ISO is checked here so the message names the file, before the proxy is asked. The
// message is Node's own (`ENOENT: no such file or directory, stat '…'`), as v1 printed it, not
// the platform wrapper's.
const localIso = Effect.fn("client.localIso")(function* (iso: string) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const absolute = path.resolve(iso);
  yield* fs.stat(absolute).pipe(
    Effect.mapError((error) =>
      SharedErrors.CommandError.make({
        message: `iso: ${ExternalFailure.describeThrowable(ExternalFailure.causeOf(error), error.message)}`,
      }),
    ),
  );
  return absolute;
});

// Bytes go to the file with -o, else raw to stdout without ending it.
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
    // --iso names which minted disk to boot; the iso itself is neither attached nor read, so
    // a local path is sent as given (made absolute) without checking that the file exists.
    const iso = Domain.isIsoUrl(input.iso) ? input.iso : path.resolve(input.iso);
    const started = yield* proxy.start(
      Contract.StartBody.make({ iso, agent: input.agentId, mode: "resume" }),
    );
    return yield* Console.log(started.id);
  }
  // Fresh boots the iso itself: a local file must exist, and is named to the server absolute.
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

type AnyFlag = Flag.Flag<unknown>;

type FlagSpec = {
  readonly name: string;
  readonly aliases: ReadonlyArray<string>;
  readonly boolean: boolean;
};

// Flag.parse names a terminal and a process spawner in its type. These flags never prompt
// and never spawn, so both stay unused.
const unusedTerminal = Terminal.make({
  columns: Effect.succeed(0),
  rows: Effect.succeed(0),
  readInput: Effect.die("client flags do not read the terminal"),
  readLine: Effect.die("client flags do not read the terminal"),
  display: () => Effect.die("client flags do not display on a terminal"),
});

const unusedSpawner = ChildProcessSpawner.make(() =>
  Effect.die("client flags do not spawn a process"),
);

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

const tagOf = (value: object): string | undefined =>
  "_tag" in value && typeof value._tag === "string" ? value._tag : undefined;

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

// The flag's name, aliases and boolean-ness live on the Single node inside the combinators.
// Eight hops is past every combinator we apply; the bound stops a cycle from spinning.
const specOf = (flag: AnyFlag): FlagSpec | undefined => {
  let current: object = flag;
  for (let hop = 0; hop < 8; hop += 1) {
    if (tagOf(current) === "Single") {
      if (!("name" in current) || typeof current.name !== "string") {
        return undefined;
      }
      const aliases = "aliases" in current && isStringArray(current.aliases) ? current.aliases : [];
      const primitive =
        "primitiveType" in current && isObject(current.primitiveType)
          ? current.primitiveType
          : undefined;
      return {
        name: current.name,
        aliases,
        boolean: primitive !== undefined && tagOf(primitive) === "Boolean",
      };
    }
    if (!("param" in current) || !isObject(current.param)) {
      return undefined;
    }
    current = current.param;
  }
  return undefined;
};

// The words Flag.boolean accepts, decoded with the same schema the flag uses.
const booleanWord = (value: string): boolean =>
  Exit.isSuccess(Schema.decodeUnknownExit(EffectConfig.Boolean)(value));

const reject = (message: string) => SharedErrors.CommandError.make({ message });

// Words before the first flag are the action. What follows is parsed by the same Flag
// values the ./client command declares.
const collect = Effect.fn("client.collect")(function* (
  tokens: ReadonlyArray<string>,
  declared: ReadonlyArray<AnyFlag>,
) {
  const specs: Array<FlagSpec> = [];
  for (const flag of [...declared, EnvFile.envFile.flag]) {
    const spec = specOf(flag);
    if (spec === undefined) {
      return yield* Effect.die("unreadable flag");
    }
    specs.push(spec);
  }
  const byLong = new Map<string, FlagSpec>();
  const byShort = new Map<string, FlagSpec>();
  for (const spec of specs) {
    byLong.set(spec.name, spec);
    for (const alias of spec.aliases) {
      byLong.set(alias, spec);
      if (alias.length === 1) {
        byShort.set(alias, spec);
      }
    }
  }
  const values: { [key: string]: Array<string> } = {};
  const push = (name: string, value: string) => {
    const current = values[name] ?? [];
    values[name] = [...current, value];
  };
  const readValue = (
    spec: FlagSpec,
    inline: string | undefined,
    index: number,
    shown: string,
  ):
    | { readonly _tag: "Value"; readonly value: string; readonly index: number }
    | { readonly _tag: "Fail"; readonly message: string } => {
    if (inline !== undefined) {
      return { _tag: "Value", value: inline, index };
    }
    if (spec.boolean) {
      const next = tokens[index];
      if (next !== undefined && !next.startsWith("-") && booleanWord(next)) {
        return { _tag: "Value", value: next, index: index + 1 };
      }
      return { _tag: "Value", value: "true", index };
    }
    const next = tokens[index];
    if (next === undefined || next.startsWith("-")) {
      return { _tag: "Fail", message: `missing value for ${shown}` };
    }
    return { _tag: "Value", value: next, index: index + 1 };
  };

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (!token.startsWith("-") || token === "-") {
      return yield* reject(`unexpected argument ${token}`);
    }
    index += 1;
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      const rawName = eq === -1 ? body : body.slice(0, eq);
      const inline = eq === -1 ? undefined : body.slice(eq + 1);
      if (rawName === "") {
        return yield* reject(`unknown flag ${token}`);
      }
      const negatedName = rawName.startsWith("no-") ? rawName.slice(3) : undefined;
      const negated = negatedName === undefined ? undefined : byLong.get(negatedName);
      if (negated?.boolean === true) {
        if (inline !== undefined) {
          return yield* reject(`--no-${negated.name} does not take a value`);
        }
        const next = tokens[index];
        if (next !== undefined && !next.startsWith("-") && booleanWord(next)) {
          return yield* reject(`--no-${negated.name} does not take a value`);
        }
        push(negated.name, "false");
        continue;
      }
      const spec = byLong.get(rawName);
      if (spec === undefined) {
        return yield* reject(`unknown flag --${rawName}`);
      }
      const read = readValue(spec, inline, index, `--${spec.name}`);
      if (read._tag === "Fail") {
        return yield* reject(read.message);
      }
      index = read.index;
      push(spec.name, read.value);
      continue;
    }
    const body = token.slice(1);
    const eq = body.indexOf("=");
    const chars = eq === -1 ? body : body.slice(0, eq);
    const inline = eq === -1 ? undefined : body.slice(eq + 1);
    if (chars.length !== 1) {
      return yield* reject(`unknown flag -${chars[0] ?? ""}`);
    }
    const spec = byShort.get(chars);
    if (spec === undefined) {
      return yield* reject(`unknown flag -${chars}`);
    }
    const read = readValue(spec, inline, index, `-${chars}`);
    if (read._tag === "Fail") {
      return yield* reject(read.message);
    }
    index = read.index;
    push(spec.name, read.value);
  }
  // --env-file is accepted so it is not an unknown flag. The process already loaded its
  // environment; the value is not applied again.
  return values;
});

const take = <A>(flag: Flag.Flag<A>, flags: { readonly [key: string]: ReadonlyArray<string> }) =>
  flag.parse({ flags, arguments: [] }).pipe(
    Effect.map((parsed) => parsed[1]),
    Effect.mapError((error) => SharedErrors.CommandError.make({ message: error.message })),
    Effect.provideService(Terminal.Terminal, unusedTerminal),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, unusedSpawner),
  );

const sharedFlags: ReadonlyArray<AnyFlag> = [Flags.shared.agentId, Flags.shared.serverUrl];

const sharedOf = Effect.fn("client.shared")(function* (flags: {
  readonly [key: string]: ReadonlyArray<string>;
}) {
  return {
    agentId: yield* take(Flags.shared.agentId, flags),
    serverUrl: yield* take(Flags.shared.serverUrl, flags),
  } satisfies Shared;
});

const runStart = Effect.fn("client.call.start")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof start,
) {
  const flags = yield* collect(tokens, [...sharedFlags, Flags.iso, Flags.disk, Flags.resume]);
  return yield* action({
    ...(yield* sharedOf(flags)),
    iso: yield* take(Flags.iso, flags),
    disk: yield* take(Flags.disk, flags),
    resume: yield* take(Flags.resume, flags),
  });
});

const runReserve = Effect.fn("client.call.reserve")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof reserve,
) {
  const flags = yield* collect(tokens, [...sharedFlags, Flags.server]);
  return yield* action({
    ...(yield* sharedOf(flags)),
    server: yield* take(Flags.server, flags),
  });
});

const runRelinquish = Effect.fn("client.call.relinquish")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof relinquish,
) {
  const flags = yield* collect(tokens, sharedFlags);
  return yield* action(yield* sharedOf(flags));
});

const outputFlag = Flags.output("output");

const runCapture = Effect.fn("client.call.capture")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof getImage | typeof getSerial,
) {
  const flags = yield* collect(tokens, [...sharedFlags, Flags.sessionId, outputFlag]);
  return yield* action({
    ...(yield* sharedOf(flags)),
    sessionId: yield* take(Flags.sessionId, flags),
    output: yield* take(outputFlag, flags),
  });
});

const runSendKeys = Effect.fn("client.call.sendKeys")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof sendKeys,
) {
  const flags = yield* collect(tokens, [
    ...sharedFlags,
    Flags.sessionId,
    Flags.keys,
    Flags.encoding,
  ]);
  return yield* action({
    ...(yield* sharedOf(flags)),
    sessionId: yield* take(Flags.sessionId, flags),
    keys: yield* take(Flags.keys, flags),
    encoding: yield* take(Flags.encoding, flags),
  });
});

const pointFlags: ReadonlyArray<AnyFlag> = [...sharedFlags, Flags.sessionId, Flags.x, Flags.y];

const runMove = Effect.fn("client.call.mouseMove")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof mouseMove,
) {
  const flags = yield* collect(tokens, pointFlags);
  return yield* action({
    ...(yield* sharedOf(flags)),
    sessionId: yield* take(Flags.sessionId, flags),
    x: yield* take(Flags.x, flags),
    y: yield* take(Flags.y, flags),
  });
});

const runClick = Effect.fn("client.call.mouseClick")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof mouseClick | typeof mouseDoubleClick,
) {
  const flags = yield* collect(tokens, [...pointFlags, Flags.button, Flags.modifier]);
  return yield* action({
    ...(yield* sharedOf(flags)),
    sessionId: yield* take(Flags.sessionId, flags),
    x: yield* take(Flags.x, flags),
    y: yield* take(Flags.y, flags),
    button: yield* take(Flags.button, flags),
    modifier: yield* take(Flags.modifier, flags),
  });
});

const runScroll = Effect.fn("client.call.mouseScroll")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof mouseScroll,
) {
  const flags = yield* collect(tokens, [...pointFlags, Flags.direction, Flags.ticks]);
  return yield* action({
    ...(yield* sharedOf(flags)),
    sessionId: yield* take(Flags.sessionId, flags),
    x: yield* take(Flags.x, flags),
    y: yield* take(Flags.y, flags),
    direction: yield* take(Flags.direction, flags),
    ticks: yield* take(Flags.ticks, flags),
  });
});

const runDrag = Effect.fn("client.call.mouseDrag")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof mouseDrag,
) {
  const flags = yield* collect(tokens, [
    ...sharedFlags,
    Flags.sessionId,
    Flags.fromX,
    Flags.fromY,
    Flags.toX,
    Flags.toY,
    Flags.button,
    Flags.modifier,
  ]);
  return yield* action({
    ...(yield* sharedOf(flags)),
    sessionId: yield* take(Flags.sessionId, flags),
    fromX: yield* take(Flags.fromX, flags),
    fromY: yield* take(Flags.fromY, flags),
    toX: yield* take(Flags.toX, flags),
    toY: yield* take(Flags.toY, flags),
    button: yield* take(Flags.button, flags),
    modifier: yield* take(Flags.modifier, flags),
  });
});

const runButton = Effect.fn("client.call.mouseButton")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof mouseHold | typeof mouseRelease,
) {
  const flags = yield* collect(tokens, [...pointFlags, Flags.button]);
  return yield* action({
    ...(yield* sharedOf(flags)),
    sessionId: yield* take(Flags.sessionId, flags),
    x: yield* take(Flags.x, flags),
    y: yield* take(Flags.y, flags),
    button: yield* take(Flags.button, flags),
  });
});

const runIntentStart = Effect.fn("client.call.intentStart")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof intentStart,
) {
  const flags = yield* collect(tokens, [
    ...sharedFlags,
    Flags.sessionId,
    Flags.testResultId,
    Flags.message,
  ]);
  return yield* action({
    ...(yield* sharedOf(flags)),
    sessionId: yield* take(Flags.sessionId, flags),
    testResultId: yield* take(Flags.testResultId, flags),
    message: yield* take(Flags.message, flags),
  });
});

const runIntentEnd = Effect.fn("client.call.intentEnd")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof intentEnd,
) {
  const flags = yield* collect(tokens, [...sharedFlags, Flags.sessionId]);
  return yield* action({
    ...(yield* sharedOf(flags)),
    sessionId: yield* take(Flags.sessionId, flags),
  });
});

const runStop = Effect.fn("client.call.stop")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof stop,
) {
  const flags = yield* collect(tokens, [
    ...sharedFlags,
    Flags.sessionId,
    Flags.status,
    Flags.reason,
  ]);
  return yield* action({
    ...(yield* sharedOf(flags)),
    sessionId: yield* take(Flags.sessionId, flags),
    status: yield* take(Flags.status, flags),
    reason: yield* take(Flags.reason, flags),
  });
});

const runSave = Effect.fn("client.call.save")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof save,
) {
  const flags = yield* collect(tokens, [...sharedFlags, Flags.sessionId]);
  return yield* action({
    ...(yield* sharedOf(flags)),
    sessionId: yield* take(Flags.sessionId, flags),
  });
});

const runFollow = Effect.fn("client.call.follow")(function* (
  tokens: ReadonlyArray<string>,
  action: typeof follow,
) {
  const flags = yield* collect(tokens, [...sharedFlags, Flags.sessionId]);
  return yield* action({
    ...(yield* sharedOf(flags)),
    sessionId: yield* take(Flags.sessionId, flags),
  });
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

const dispatch = Effect.fn("client.dispatch")(function* (
  name: ActionName,
  tokens: ReadonlyArray<string>,
) {
  switch (name) {
    case "start":
      return yield* runStart(tokens, byName[name]);
    case "reserve":
      return yield* runReserve(tokens, byName[name]);
    case "relinquish":
      return yield* runRelinquish(tokens, byName[name]);
    case "get-image":
      return yield* runCapture(tokens, byName[name]);
    case "get-serial":
      return yield* runCapture(tokens, byName[name]);
    case "send-keys":
      return yield* runSendKeys(tokens, byName[name]);
    case "mouse move":
      return yield* runMove(tokens, byName[name]);
    case "mouse click":
      return yield* runClick(tokens, byName[name]);
    case "mouse double-click":
      return yield* runClick(tokens, byName[name]);
    case "mouse scroll":
      return yield* runScroll(tokens, byName[name]);
    case "mouse drag":
      return yield* runDrag(tokens, byName[name]);
    case "mouse hold":
      return yield* runButton(tokens, byName[name]);
    case "mouse release":
      return yield* runButton(tokens, byName[name]);
    case "intent start":
      return yield* runIntentStart(tokens, byName[name]);
    case "intent end":
      return yield* runIntentEnd(tokens, byName[name]);
    case "stop":
      return yield* runStop(tokens, byName[name]);
    case "save":
      return yield* runSave(tokens, byName[name]);
    case "follow":
      return yield* runFollow(tokens, byName[name]);
  }
  return yield* SharedErrors.CommandError.make({ message: "unknown action" });
});

// Find the action by the words the model wrote, then call that function.
export const call = Effect.fn("client.call")(function* (args: ReadonlyArray<string>) {
  const { name, tokens } = actionOf(args);
  if (!isActionName(name)) {
    const label = name === "" ? "missing action" : `unknown action ${name}`;
    return yield* SharedErrors.CommandError.make({ message: label });
  }
  return yield* dispatch(name, tokens);
});
