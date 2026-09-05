import { Console, Effect, FileSystem, Option, Path, Stdio, Stream } from "effect";
import { Command } from "effect/unstable/cli";
import * as Config from "../config.ts";
import * as Contract from "../shared/contract.ts";
import * as Errors from "../shared/errors.ts";
import * as Flags from "./flags.ts";
import * as ProxyClient from "./proxy-client.ts";

type Input<F extends Command.Command.Config> = Command.Command.Config.Infer<F>;

// Every handler reads the token before anything else, so `OLIGARCHY_TOKEN is not set` precedes
// the local checks and the request alike.
const connect = Effect.fn("client.connect")(function* (serverUrl: string) {
  const token = yield* Config.oligarchyToken;
  return yield* ProxyClient.connect({ serverUrl, token });
});

const isUrl = (iso: string): boolean => iso.startsWith("http://") || iso.startsWith("https://");

// A local ISO is checked here so the message names the file, before the proxy is asked.
const localIso = Effect.fn("client.localIso")(function* (iso: string) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const absolute = path.resolve(iso);
  yield* fs
    .stat(absolute)
    .pipe(
      Effect.mapError((error) => Errors.CommandError.make({ message: `iso: ${error.message}` })),
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

const startFlags = { ...Flags.shared, iso: Flags.iso, disk: Flags.disk };

const start = Command.make(
  "start",
  startFlags,
  Effect.fn("client.start")(function* (input: Input<typeof startFlags>) {
    const proxy = yield* connect(input.serverUrl);
    const path = yield* Path.Path;
    const iso = isUrl(input.iso) ? input.iso : yield* localIso(input.iso);
    const body = Option.match(input.disk, {
      onNone: () => Contract.StartBody.make({ iso, agent: input.agentId }),
      onSome: (disk) =>
        Contract.StartBody.make({ iso, disk: path.resolve(disk), agent: input.agentId }),
    });
    const started = yield* proxy.start(body);
    yield* Console.log(started.id);
  }),
).pipe(Command.withDescription("Boot a machine from an ISO; prints the session id"));

const getImageFlags = { ...Flags.shared, sessionId: Flags.sessionId, output: Flags.output("PNG") };

const getImage = Command.make(
  "get-image",
  getImageFlags,
  Effect.fn("client.getImage")(function* (input: Input<typeof getImageFlags>) {
    const proxy = yield* connect(input.serverUrl);
    const bytes = yield* proxy.image(input.sessionId, input.agentId);
    yield* emit(input.output, bytes);
  }),
).pipe(Command.withDescription("Screenshot the machine as a PNG"));

const getSerialFlags = {
  ...Flags.shared,
  sessionId: Flags.sessionId,
  output: Flags.output("serial log"),
};

const getSerial = Command.make(
  "get-serial",
  getSerialFlags,
  Effect.fn("client.getSerial")(function* (input: Input<typeof getSerialFlags>) {
    const proxy = yield* connect(input.serverUrl);
    const bytes = yield* proxy.serial(input.sessionId, input.agentId);
    yield* emit(input.output, bytes);
  }),
).pipe(Command.withDescription("Read the machine's serial console log"));

const sendKeysFlags = {
  ...Flags.shared,
  sessionId: Flags.sessionId,
  keys: Flags.keys,
  encoding: Flags.encoding,
};

const sendKeys = Command.make(
  "send-keys",
  sendKeysFlags,
  Effect.fn("client.sendKeys")(function* (input: Input<typeof sendKeysFlags>) {
    const proxy = yield* connect(input.serverUrl);
    yield* proxy.sendKeys(
      Contract.SendKeysBody.make({
        id: input.sessionId,
        keys: input.keys,
        encoding: input.encoding,
        agent: input.agentId,
      }),
    );
  }),
).pipe(Command.withDescription("Type a key string into the machine"));

const sendMouseFlags = {
  ...Flags.shared,
  sessionId: Flags.sessionId,
  x: Flags.x,
  y: Flags.y,
  button: Flags.button,
  clicks: Flags.clicks,
};

const sendMouse = Command.make(
  "send-mouse",
  sendMouseFlags,
  Effect.fn("client.sendMouse")(function* (input: Input<typeof sendMouseFlags>) {
    const proxy = yield* connect(input.serverUrl);
    // The proxy moves and ignores clicks when there is no button; say so here instead.
    if (Option.isSome(input.clicks) && Option.isNone(input.button)) {
      return yield* Errors.CommandError.make({ message: "send-mouse: --clicks needs --button" });
    }
    const base = { id: input.sessionId, x: input.x, y: input.y, agent: input.agentId };
    const body = Option.match(input.button, {
      onNone: () => Contract.SendMouseBody.make(base),
      onSome: (button) =>
        Option.match(input.clicks, {
          onNone: () => Contract.SendMouseBody.make({ ...base, button }),
          onSome: (clicks) => Contract.SendMouseBody.make({ ...base, button, clicks }),
        }),
    });
    return yield* proxy.sendMouse(body);
  }),
).pipe(Command.withDescription("Move the mouse to a point on the screenshot and optionally click"));

const intentStartFlags = {
  ...Flags.shared,
  sessionId: Flags.sessionId,
  testResultId: Flags.testResultId,
  message: Flags.message,
};

const intentStart = Command.make(
  "start",
  intentStartFlags,
  Effect.fn("client.intentStart")(function* (input: Input<typeof intentStartFlags>) {
    const proxy = yield* connect(input.serverUrl);
    yield* proxy.intentStart(
      Contract.IntentStartBody.make({
        id: input.sessionId,
        agent: input.agentId,
        test_result_id: input.testResultId,
        message: input.message,
      }),
    );
  }),
).pipe(Command.withDescription("Announce what you are about to do"));

const intentEndFlags = { ...Flags.shared, sessionId: Flags.sessionId };

const intentEnd = Command.make(
  "end",
  intentEndFlags,
  Effect.fn("client.intentEnd")(function* (input: Input<typeof intentEndFlags>) {
    const proxy = yield* connect(input.serverUrl);
    yield* proxy.intentEnd(
      Contract.IntentEndBody.make({ id: input.sessionId, agent: input.agentId }),
    );
  }),
).pipe(Command.withDescription("Close the open intent"));

const intent = Command.make("intent").pipe(
  Command.withDescription("Bracket a step of the test with start and end"),
  Command.withSubcommands([intentStart, intentEnd]),
);

const stopFlags = {
  ...Flags.shared,
  sessionId: Flags.sessionId,
  status: Flags.status,
  reason: Flags.reason,
};

const stop = Command.make(
  "stop",
  stopFlags,
  Effect.fn("client.stop")(function* (input: Input<typeof stopFlags>) {
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
  }),
).pipe(Command.withDescription("Stop the machine, with a verdict when the test is over"));

const followFlags = { ...Flags.shared, sessionId: Flags.sessionId };

const follow = Command.make(
  "follow",
  followFlags,
  Effect.fn("client.follow")(function* (input: Input<typeof followFlags>) {
    const proxy = yield* connect(input.serverUrl);
    const stdio = yield* Stdio.Stdio;
    const stream = yield* proxy.follow(input.sessionId);
    yield* Stream.run(stream, stdio.stdout());
  }),
).pipe(Command.withDescription("Stream the session's event lines until it ends"));

export const makeClientCommand = () =>
  Command.make("client").pipe(
    Command.withDescription("Drive a guest machine through the oligarchy proxy"),
    Command.withSubcommands([
      start,
      getImage,
      getSerial,
      sendKeys,
      sendMouse,
      intent,
      stop,
      follow,
    ]),
  );
