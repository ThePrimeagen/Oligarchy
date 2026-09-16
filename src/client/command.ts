import { Array as Arr, Console, Effect, FileSystem, Option, Path, Stdio, Stream } from "effect";
import * as CliError from "effect/unstable/cli/CliError";
import * as Command from "effect/unstable/cli/Command";
import * as Config from "../config.ts";
import * as ExternalFailure from "../external-failure.ts";
import * as Contract from "../shared/contract.ts";
import * as Domain from "../shared/domain.ts";
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

// A local ISO is checked here so the message names the file, before the proxy is asked. The
// message is Node's own (`ENOENT: no such file or directory, stat '…'`), as v1 printed it, not
// the platform wrapper's.
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

const startFlags = { ...Flags.shared, iso: Flags.iso, disk: Flags.disk, resume: Flags.resume };

const start = Command.make(
  "start",
  startFlags,
  Effect.fn("client.start")(function* (input: Input<typeof startFlags>) {
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
  }),
).pipe(
  Command.withDescription(
    "Boot a machine from an ISO, or with --resume from its minted disk; consumes a reservation held for --agent-id; prints the session id",
  ),
);

const reserveFlags = { ...Flags.shared, server: Flags.server };

// A driver's own reservation, for the agent the dispatcher did not reserve for, or one pinned to
// a server the dispatcher's ranking would not pick: minting installs on every server in turn.
const reserve = Command.make(
  "reserve",
  reserveFlags,
  Effect.fn("client.reserve")(function* (input: Input<typeof reserveFlags>) {
    const proxy = yield* connect(input.serverUrl);
    const body = Option.match(input.server, {
      onNone: () => Contract.ReserveAgentBody.make({ agent: input.agentId }),
      onSome: (server) => Contract.ReserveAgentBody.make({ agent: input.agentId, server }),
    });
    yield* proxy.reserve(body);
  }),
).pipe(
  Command.withDescription(
    "Hold a slot for --agent-id that its next start consumes, on the best-ranked server or the one --server names",
  ),
);

// The way out of a start that keeps failing: whatever the dispatcher's reservation for this agent
// became is given back at once, instead of holding a --max-jobs slot until it expires unused.
const relinquish = Command.make(
  "relinquish",
  Flags.shared,
  Effect.fn("client.relinquish")(function* (input: Input<typeof Flags.shared>) {
    const proxy = yield* connect(input.serverUrl);
    yield* proxy.relinquish(Contract.ReserveAgentBody.make({ agent: input.agentId }));
  }),
).pipe(
  Command.withDescription(
    "Give back what --agent-id holds: an unused reservation, or its running machine, stopped as aborted",
  ),
);

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
  toX: Flags.toX,
  toY: Flags.toY,
  modifier: Flags.modifier,
  press: Flags.press,
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
    // The wire carries a point or none; only here do the two flags have names to refuse by.
    if (Option.isSome(input.toX) !== Option.isSome(input.toY)) {
      return yield* Errors.CommandError.make({
        message: "send-mouse: --to-x and --to-y go together",
      });
    }
    const body = Contract.SendMouseBody.make(
      Object.assign(
        { id: input.sessionId, x: input.x, y: input.y, agent: input.agentId },
        Option.isSome(input.button) ? { button: input.button.value } : undefined,
        Option.isSome(input.clicks) ? { clicks: input.clicks.value } : undefined,
        Option.isSome(input.toX) && Option.isSome(input.toY)
          ? { to: { x: input.toX.value, y: input.toY.value } }
          : undefined,
        Arr.isReadonlyArrayNonEmpty(input.modifier) ? { modifiers: input.modifier } : undefined,
        Option.isSome(input.press) ? { press: input.press.value } : undefined,
      ),
    );
    return yield* proxy.sendMouse(body);
  }),
).pipe(
  Command.withDescription(
    "Move the mouse to a point on the screenshot; click, scroll, drag to --to-x --to-y, or hold or release --button, with --modifier keys held",
  ),
);

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

const saveFlags = { ...Flags.shared, sessionId: Flags.sessionId };

const save = Command.make(
  "save",
  saveFlags,
  Effect.fn("client.save")(function* (input: Input<typeof saveFlags>) {
    const proxy = yield* connect(input.serverUrl);
    yield* proxy.save(Contract.SaveBody.make({ id: input.sessionId, agent: input.agentId }));
    yield* Console.log("saved");
  }),
).pipe(
  Command.withDescription(
    "Power the machine off and keep its disk as the minted disk of the iso it booted; ends the session",
  ),
);

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
    Command.withDescription("Drive a guest machine through the qemu server"),
    Command.withSubcommands([
      start,
      reserve,
      relinquish,
      getImage,
      getSerial,
      sendKeys,
      sendMouse,
      intent,
      stop,
      save,
      follow,
    ]),
  );
