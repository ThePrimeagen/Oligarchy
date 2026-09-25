import * as Command from "effect/unstable/cli/Command";
import * as EnvFile from "@oligarchy/env/env-file";
import * as Actions from "./actions.ts";
import * as Flags from "./flags.ts";

const startFlags = { ...Flags.shared, iso: Flags.iso, disk: Flags.disk, resume: Flags.resume };

const start = Command.make("start", startFlags, Actions.start).pipe(
  Command.withDescription(
    "Boot a machine from an ISO, or with --resume from its minted disk; consumes a reservation held for --agent-id; prints the session id",
  ),
);

const reserveFlags = { ...Flags.shared, server: Flags.server };

const reserve = Command.make("reserve", reserveFlags, Actions.reserve).pipe(
  Command.withDescription(
    "Hold a slot for --agent-id that its next start consumes, on the best-ranked server or the one --server names",
  ),
);

const relinquish = Command.make("relinquish", Flags.shared, Actions.relinquish).pipe(
  Command.withDescription(
    "Give back what --agent-id holds: an unused reservation, or its running machine, stopped as aborted",
  ),
);

const getImageFlags = { ...Flags.shared, sessionId: Flags.sessionId, output: Flags.output("PNG") };

const getImage = Command.make("get-image", getImageFlags, Actions.getImage).pipe(
  Command.withDescription("Screenshot the machine as a PNG"),
);

const getSerialFlags = {
  ...Flags.shared,
  sessionId: Flags.sessionId,
  output: Flags.output("serial log"),
};

const getSerial = Command.make("get-serial", getSerialFlags, Actions.getSerial).pipe(
  Command.withDescription("Read the machine's serial console log"),
);

const sendKeysFlags = {
  ...Flags.shared,
  sessionId: Flags.sessionId,
  keys: Flags.keys,
  encoding: Flags.encoding,
};

const sendKeys = Command.make("send-keys", sendKeysFlags, Actions.sendKeys).pipe(
  Command.withDescription("Type a key string into the machine"),
);

const pointFlags = { ...Flags.shared, sessionId: Flags.sessionId, x: Flags.x, y: Flags.y };

const mouseMove = Command.make("move", pointFlags, Actions.mouseMove).pipe(
  Command.withDescription("Move the pointer to a point on the screenshot"),
);

const clickFlags = { ...pointFlags, button: Flags.button, modifier: Flags.modifier };

const mouseClick = Command.make("click", clickFlags, Actions.mouseClick).pipe(
  Command.withDescription("Click --button at a point, with --modifier keys held"),
);

const mouseDoubleClick = Command.make("double-click", clickFlags, Actions.mouseDoubleClick).pipe(
  Command.withDescription("Double-click --button at a point, with --modifier keys held"),
);

const scrollFlags = { ...pointFlags, direction: Flags.direction, ticks: Flags.ticks };

const mouseScroll = Command.make("scroll", scrollFlags, Actions.mouseScroll).pipe(
  Command.withDescription("Turn the wheel --ticks clicks in --direction at a point"),
);

const dragFlags = {
  ...Flags.shared,
  sessionId: Flags.sessionId,
  fromX: Flags.fromX,
  fromY: Flags.fromY,
  toX: Flags.toX,
  toY: Flags.toY,
  button: Flags.button,
  modifier: Flags.modifier,
};

const mouseDrag = Command.make("drag", dragFlags, Actions.mouseDrag).pipe(
  Command.withDescription(
    "Press --button at --from-x --from-y, move to --to-x --to-y and release, with --modifier keys held",
  ),
);

const buttonFlags = { ...pointFlags, button: Flags.button };

const mouseHold = Command.make("hold", buttonFlags, Actions.mouseHold).pipe(
  Command.withDescription("Press --button at a point and leave it held"),
);

const mouseRelease = Command.make("release", buttonFlags, Actions.mouseRelease).pipe(
  Command.withDescription("Let a held --button go at a point"),
);

const mouse = Command.make("mouse").pipe(
  Command.withDescription("Move, click, double-click, scroll, drag, hold or release the mouse"),
  Command.withSubcommands([
    mouseMove,
    mouseClick,
    mouseDoubleClick,
    mouseScroll,
    mouseDrag,
    mouseHold,
    mouseRelease,
  ]),
);

const intentStartFlags = {
  ...Flags.shared,
  sessionId: Flags.sessionId,
  testResultId: Flags.testResultId,
  message: Flags.message,
};

const intentStart = Command.make("start", intentStartFlags, Actions.intentStart).pipe(
  Command.withDescription("Announce what you are about to do"),
);

const intentEndFlags = { ...Flags.shared, sessionId: Flags.sessionId };

const intentEnd = Command.make("end", intentEndFlags, Actions.intentEnd).pipe(
  Command.withDescription("Close the open intent"),
);

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

const stop = Command.make("stop", stopFlags, Actions.stop).pipe(
  Command.withDescription("Stop the machine, with a verdict when the test is over"),
);

const saveFlags = { ...Flags.shared, sessionId: Flags.sessionId };

const save = Command.make("save", saveFlags, Actions.save).pipe(
  Command.withDescription(
    "Power the machine off and keep its disk as the minted disk of the iso it booted; ends the session",
  ),
);

const followFlags = { ...Flags.shared, sessionId: Flags.sessionId };

const follow = Command.make("follow", followFlags, Actions.follow).pipe(
  Command.withDescription("Stream the session's event lines until it ends"),
);

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
      mouse,
      intent,
      stop,
      save,
      follow,
    ]),
    EnvFile.withEnvFile,
  );
