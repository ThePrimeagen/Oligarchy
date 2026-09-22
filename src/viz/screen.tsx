/** @jsxImportSource @opentui/solid */
import { BorderChars, type CliRenderer, RGBA } from "@opentui/core";
import { render, useTerminalDimensions } from "@opentui/solid";
import { Option } from "effect";
import { type Accessor, createMemo, For, Index, type ParentProps, Show } from "solid-js";
import * as Image from "../session/image.ts";
import * as Follow from "./follow.ts";
import * as Text from "./text.ts";
import * as View from "./view.ts";

// What the runner hands the screen: the view as it changes, and the clock the ages tick on.
// imageProtocol says whether a direct kitty placement may follow each frame. place writes it;
// omitted, nothing is written. The widgets themselves draw blocks, so OpenTUI's own kitty
// placement (which sits under the text) never goes out.
export type Props = {
  readonly view: Accessor<View.View>;
  readonly now: Accessor<number>;
  readonly imageProtocol?: "kitty" | "auto";
  readonly place?: (text: string) => void;
};

const MUTED = Text.PALETTE.muted;

// A one-row box whose top border stands in for a divider between cards: its margins reach back
// over the machines box's padding and border on both sides, and its corners are the junctions,
// so it reads as one line through the frame.
const DIVIDER_CHARS = { ...BorderChars.rounded, topLeft: "├", topRight: "┤" };

// A border title as OpenTUI draws it, a space either side of the text; nothing when there is
// no text to draw.
const title = (text: Option.Option<string>): string =>
  Option.match(text, { onNone: () => "", onSome: (found) => ` ${found} ` });

// One row of pieces, each its own span; a blank piece inherits the row's colour. The pieces of
// a changed row are new objects, and a span's style only ever gains bits, so each gets a fresh
// span rather than a reused one.
const Line = (props: { readonly row: Text.Row }) => (
  <text wrapMode="none">
    <For each={props.row}>
      {(piece) => <span style={{ fg: piece.color, bold: piece.bold === true }}>{piece.text}</span>}
    </For>
  </text>
);

const Divider = () => (
  <box
    height={1}
    marginLeft={-2}
    marginRight={-2}
    border={["top", "left", "right"]}
    borderColor={MUTED}
    customBorderChars={DIVIDER_CHARS}
  />
);

// The peek sits over the bottom of the board, above the footer: its own background so the
// rows beneath do not show through its blanks, the commands in their column and the last image
// in what is left.
const Peek = (props: { readonly follow: Follow.Peek; readonly now: number }) => (
  <box
    position="absolute"
    left={0}
    right={0}
    bottom={1}
    height={Follow.PEEK_FRAME_ROWS}
    border
    borderStyle="rounded"
    borderColor={MUTED}
    backgroundColor={RGBA.defaultBackground()}
    title={` ${Follow.title(props.follow)} `}
    titleColor={Text.PALETTE.text}
    bottomTitle={` ${Follow.PEEK_HINT} `}
    bottomTitleAlignment="right"
    paddingLeft={1}
    paddingRight={1}
    flexDirection="row"
  >
    <box width={Follow.LEFT_COLS} flexDirection="column">
      <Index each={Follow.peekRows(props.follow, props.now)}>{(row) => <Line row={row()} />}</Index>
    </box>
    <Show when={Option.getOrUndefined(props.follow.png)}>
      {(png: Accessor<Uint8Array>) => (
        <image
          source={png()}
          fit="fit"
          protocol="blocks"
          flexGrow={1}
          height={Follow.PEEK_IMAGE_ROWS}
          marginLeft={2}
        />
      )}
    </Show>
  </box>
);

// The full follow is the whole screen: the ticket and the session's status on top, the entries
// down the left, the newest that fit between the header and the last row, the live image in the
// rest, and the last row for the way out or a notice.
const FullFollow = (props: {
  readonly follow: Follow.Full;
  readonly notice: Option.Option<string>;
  readonly rows: number;
}) => (
  <box flexDirection="column" width="100%" height="100%" paddingLeft={1} paddingRight={1}>
    <Line row={Follow.fullHeader(props.follow)} />
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      <box width={Follow.LEFT_COLS - 1} flexShrink={0} flexDirection="column">
        <Index each={Follow.fullEntries(props.follow, props.rows - 2)}>
          {(row) => <Line row={row()} />}
        </Index>
      </box>
      <Show when={Option.getOrUndefined(props.follow.png)}>
        {(png: Accessor<Uint8Array>) => (
          <image source={png()} fit="fit" protocol="blocks" flexGrow={1} marginLeft={1} />
        )}
      </Show>
    </box>
    <text fg={MUTED} wrapMode="none">
      {Option.getOrElse(props.notice, () => Follow.FULL_FOOT)}
    </text>
  </box>
);

// The whole screen, painting nothing, with its one child in the middle: what a box that lies
// over whatever is up sits in.
const Centered = (props: ParentProps) => (
  <box
    position="absolute"
    left={0}
    top={0}
    width="100%"
    height="100%"
    justifyContent="center"
    alignItems="center"
  >
    {props.children}
  </box>
);

// The pop-up: one sentence boxed in the middle of the screen, with its own background so
// nothing shows through.
const Popup = (props: { readonly text: string }) => (
  <Centered>
    <box
      border
      borderStyle="rounded"
      borderColor={Text.PALETTE.love}
      backgroundColor={RGBA.defaultBackground()}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <text fg={Text.PALETTE.text} wrapMode="none">
        {props.text}
      </text>
    </box>
  </Centered>
);

// d's definition or enter's ticket information, boxed in the middle so the board stays put
// underneath. j and k have already scrolled the lines.
const Sheet = (props: { readonly sheet: View.Sheet }) => (
  <Centered>
    <box
      width={View.SHEET_WIDTH}
      height={View.SHEET_ROWS + 4}
      border
      borderStyle="rounded"
      borderColor={Text.PALETTE.foam}
      backgroundColor={RGBA.defaultBackground()}
      title={` ${props.sheet.title} `}
      titleColor={Text.PALETTE.text}
      bottomTitle={` ${View.SHEET_HINT} `}
      bottomTitleAlignment="right"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      flexDirection="column"
    >
      <Index each={View.sheetRows(props.sheet)}>{(row) => <Line row={row()} />}</Index>
    </box>
  </Centered>
);

// A's question: the job on the top border, the keys on the bottom one, the question and the
// two answers between, as wide as the view says so the borders hold their words.
const Confirm = (props: { readonly asked: View.Confirm }) => (
  <Centered>
    <box
      width={View.CONFIRM_WIDTH}
      border
      borderStyle="rounded"
      borderColor={Text.PALETTE.gold}
      backgroundColor={RGBA.defaultBackground()}
      title={` ${View.confirmTitle(props.asked)} `}
      titleColor={Text.PALETTE.text}
      bottomTitle={` ${View.CONFIRM_HINT} `}
      bottomTitleAlignment="right"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      flexDirection="column"
    >
      <Index each={View.confirmRows(props.asked)}>{(row) => <Line row={row()} />}</Index>
    </box>
  </Centered>
);

// The machines box is as tall as its tabs and cards, the queue's box takes every row left above
// the footer, and a terminal that shrank below the minimum shows the one sentence saying so
// until it grows back. A full follow replaces the board; a peek lies over its bottom rows; A's
// question lies over either, and a pop-up over everything.
export const App = (props: Props) => {
  const dimensions = useTerminalDimensions();
  const fits = () => dimensions().width >= View.MIN_COLUMNS && dimensions().height >= View.MIN_ROWS;
  const screen = createMemo(() =>
    View.screen(props.view(), props.now(), dimensions().width, dimensions().height),
  );
  const peek = (): Follow.Peek | undefined => {
    const follow = Option.getOrUndefined(props.view().follow);
    return follow?._tag === "peek" ? follow : undefined;
  };
  const full = (): Follow.Full | undefined => {
    const follow = Option.getOrUndefined(props.view().follow);
    return follow?._tag === "full" ? follow : undefined;
  };
  const asked = (): View.Confirm | undefined => Option.getOrUndefined(props.view().confirm);
  const sheet = (): View.Sheet | undefined => Option.getOrUndefined(props.view().sheet);
  const image = () => Option.getOrUndefined(screen().image);
  const popup = (): string | undefined => Option.getOrUndefined(props.view().popup)?.text;
  return (
    <Show
      when={fits()}
      fallback={
        <text fg={Text.PALETTE.love} wrapMode="none">
          {View.tooSmall(dimensions().width, dimensions().height)}
        </text>
      }
    >
      <Show
        when={full()}
        fallback={
          <box flexDirection="column" width="100%" height="100%">
            <box
              border
              borderStyle="rounded"
              borderColor={MUTED}
              titleColor={MUTED}
              title={` ${screen().status} `}
              titleAlignment="right"
              bottomTitle={title(screen().machines.place)}
              bottomTitleAlignment="right"
              paddingLeft={1}
              paddingRight={1}
              flexDirection="column"
              flexGrow={screen().tab === "servers" ? 0 : 1}
              flexShrink={screen().tab === "servers" ? 0 : 1}
            >
              <Line row={screen().tabs} />
              <Index each={screen().pages}>{(row) => <Line row={row()} />}</Index>
              <Show when={screen().tab !== "servers"}>
                <Index each={screen().body}>{(row) => <Line row={row()} />}</Index>
              </Show>
              <Show when={Option.getOrUndefined(screen().machines.empty)}>
                {(text: Accessor<string>) => (
                  <text fg={MUTED} wrapMode="none">
                    {text()}
                  </text>
                )}
              </Show>
              <Index each={screen().machines.cards}>
                {(card, index) => (
                  <>
                    <Show when={index > 0}>
                      <Divider />
                    </Show>
                    <Line row={card().header} />
                    <Line row={card().upper} />
                    <Line row={card().lower} />
                    <Index each={card().jobs}>{(job) => <Line row={job()} />}</Index>
                  </>
                )}
              </Index>
            </box>
            <Show when={screen().tab === "servers"}>
              <box
                border
                borderStyle="rounded"
                borderColor={MUTED}
                titleColor={MUTED}
                title={` ${screen().queue.title} `}
                bottomTitle={title(screen().queue.place)}
                bottomTitleAlignment="right"
                paddingLeft={1}
                paddingRight={1}
                flexDirection="column"
                flexGrow={1}
                flexShrink={1}
                minHeight={0}
              >
                <Line row={screen().queue.header} />
                <Show when={Option.getOrUndefined(screen().queue.empty)}>
                  {(text: Accessor<string>) => (
                    <text fg={MUTED} wrapMode="none">
                      {text()}
                    </text>
                  )}
                </Show>
                <Index each={screen().queue.jobs}>{(job) => <Line row={job()} />}</Index>
              </box>
            </Show>
            <box
              flexDirection="row"
              justifyContent="space-between"
              height={1}
              paddingLeft={1}
              paddingRight={1}
            >
              <Line row={screen().footer.left} />
              <text fg={MUTED} wrapMode="none">
                {screen().footer.right}
              </text>
            </box>
            <Show when={image()}>
              {(
                found: Accessor<{
                  readonly png: Uint8Array;
                  readonly top: number;
                  readonly height: number;
                  readonly left: number;
                  readonly width: number;
                }>,
              ) => (
                <box
                  position="absolute"
                  top={found().top}
                  left={found().left}
                  width={found().width}
                  height={found().height}
                >
                  <image
                    source={found().png}
                    fit="fit"
                    protocol="blocks"
                    width={found().width}
                    height={found().height}
                  />
                </box>
              )}
            </Show>
            <Show when={peek()}>
              {(found: Accessor<Follow.Peek>) => <Peek follow={found()} now={props.now()} />}
            </Show>
          </box>
        }
      >
        {(found: Accessor<Follow.Full>) => (
          <FullFollow follow={found()} notice={props.view().notice} rows={dimensions().height} />
        )}
      </Show>
      <Show when={sheet()}>{(found: Accessor<View.Sheet>) => <Sheet sheet={found()} />}</Show>
      <Show when={asked()}>{(found: Accessor<View.Confirm>) => <Confirm asked={found()} />}</Show>
      <Show when={popup()}>{(text: Accessor<string>) => <Popup text={text()} />}</Show>
    </Show>
  );
};

// A peek's image: inside its border and padding, to the right of the commands.
const peekBox = (columns: number, rows: number): Image.ImageBox | undefined => {
  const top = rows - 1 - Follow.PEEK_FRAME_ROWS;
  const left = 1 + 1 + Follow.LEFT_COLS + 2;
  const width = columns - left - 2;
  if (width <= 0) {
    return undefined;
  }
  return { col: left + 1, row: top + 2, cols: width, rows: Follow.PEEK_IMAGE_ROWS };
};

// A full follow's image: under the header, to the right of the entries, above the last row.
const fullBox = (columns: number, rows: number): Image.ImageBox | undefined => {
  const left = 1 + (Follow.LEFT_COLS - 1) + 1;
  const width = columns - left - 1;
  const height = rows - 2;
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { col: left + 1, row: 2, cols: width, rows: height };
};

const placeable = (png: Uint8Array): boolean => png.length >= 24;

// The sharp screenshot, for a terminal that speaks kitty. The widgets draw blocks in the same
// boxes; this placement sits on top of them (z = 1) instead of under the whole screen.
export const imageOverlay = (
  view: View.View,
  now: number,
  columns: number,
  rows: number,
  kitty: boolean,
): string => {
  if (!kitty) {
    return "";
  }
  const placements: Array<Image.Placement> = [];
  const follow = Option.getOrNull(view.follow);
  if (follow?._tag === "full") {
    const png = Option.getOrNull(follow.png);
    const box = fullBox(columns, rows);
    if (png !== null && placeable(png) && box !== undefined) {
      placements.push({ png, box, id: 1 });
    }
  } else {
    const image = Option.getOrNull(View.screen(view, now, columns, rows).image);
    if (image !== null && placeable(image.png)) {
      placements.push({
        png: image.png,
        id: 1,
        box: {
          col: image.left + 1,
          row: image.top + 1,
          cols: image.width,
          rows: image.height,
        },
      });
    }
    if (follow?._tag === "peek") {
      const png = Option.getOrNull(follow.png);
      const box = peekBox(columns, rows);
      if (png !== null && placeable(png) && box !== undefined) {
        placements.push({ png, box, id: 2 });
      }
    }
  }
  return Image.overlayImages(placements);
};

// Mounts the screen on an open renderer; the renderer's destroy disposes it. After each
// flushed frame, a kitty host gets the direct placement. An unchanged photo is not sent again,
// so the spinner's frames do not retransmit it.
export const mount = (renderer: CliRenderer, props: Props): Promise<void> => {
  let previous = "";
  const place = props.place ?? (() => {});
  const write = () => {
    const kitty = props.imageProtocol === "kitty" || renderer.capabilities?.kitty_graphics === true;
    const next = imageOverlay(props.view(), props.now(), renderer.width, renderer.height, kitty);
    if (next === previous) {
      return;
    }
    previous = next;
    if (next.length > 0) {
      place(next);
    }
  };
  renderer.on("frame", write);
  renderer.on("destroy", () => {
    renderer.off("frame", write);
  });
  return render(() => <App {...props} />, renderer);
};
