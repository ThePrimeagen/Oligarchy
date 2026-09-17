/** @jsxImportSource @opentui/solid */
import { BorderChars, type CliRenderer, RGBA } from "@opentui/core";
import { render, useTerminalDimensions } from "@opentui/solid";
import { Option } from "effect";
import { type Accessor, createMemo, For, Index, Show } from "solid-js";
import * as Follow from "./follow.ts";
import * as Text from "./text.ts";
import * as View from "./view.ts";

// What the runner hands the screen: the view as it changes, and the clock the ages tick on.
export type Props = {
  readonly view: Accessor<View.View>;
  readonly now: Accessor<number>;
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

type PeekScreen = Extract<View.FollowScreen, { readonly _tag: "peek" }>;
type FullScreen = Extract<View.FollowScreen, { readonly _tag: "full" }>;

// The peek sits over the bottom of the board, above the footer: its own background so the
// rows beneath do not show through its blanks, the commands in their column and the last image
// in what is left, drawn by the terminal's graphics when it has them and as blocks otherwise.
const Peek = (props: { readonly follow: PeekScreen }) => (
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
    title={` ${props.follow.title} `}
    titleColor={Text.PALETTE.text}
    bottomTitle={` ${Follow.PEEK_HINT} `}
    bottomTitleAlignment="right"
    paddingLeft={1}
    paddingRight={1}
    flexDirection="row"
  >
    <box width={Follow.LEFT_COLS} flexDirection="column">
      <Index each={props.follow.commands}>{(row) => <Line row={row()} />}</Index>
    </box>
    <Show when={Option.getOrUndefined(props.follow.png)}>
      {(png: Accessor<Uint8Array>) => (
        <image
          source={png()}
          fit="fit"
          flexGrow={1}
          height={Follow.PEEK_IMAGE_ROWS}
          marginLeft={2}
        />
      )}
    </Show>
  </box>
);

// The full follow is the whole screen: the ticket and the session's status on top, the entries
// down the left, the live image in the rest, and the last row for the way out or a notice.
const FullFollow = (props: { readonly follow: FullScreen }) => (
  <box flexDirection="column" width="100%" height="100%" paddingLeft={1} paddingRight={1}>
    <Line row={props.follow.header} />
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      <box width={Follow.LEFT_COLS - 1} flexShrink={0} flexDirection="column">
        <Index each={props.follow.entries}>{(row) => <Line row={row()} />}</Index>
      </box>
      <Show when={Option.getOrUndefined(props.follow.png)}>
        {(png: Accessor<Uint8Array>) => (
          <image source={png()} fit="fit" flexGrow={1} marginLeft={1} />
        )}
      </Show>
    </box>
    <text fg={MUTED} wrapMode="none">
      {props.follow.foot}
    </text>
  </box>
);

// The machines box is as tall as its tabs and cards, the queue's box takes every row left above
// the footer, and a terminal that shrank below the minimum shows the one sentence saying so
// until it grows back. A full follow replaces the board; a peek lies over its bottom rows.
export const App = (props: Props) => {
  const dimensions = useTerminalDimensions();
  const fits = () => dimensions().width >= View.MIN_COLUMNS && dimensions().height >= View.MIN_ROWS;
  const screen = createMemo(() =>
    View.screen(props.view(), props.now(), dimensions().width, dimensions().height),
  );
  const peek = (): PeekScreen | undefined => {
    const follow = Option.getOrUndefined(screen().follow);
    return follow?._tag === "peek" ? follow : undefined;
  };
  const full = (): FullScreen | undefined => {
    const follow = Option.getOrUndefined(screen().follow);
    return follow?._tag === "full" ? follow : undefined;
  };
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
              flexShrink={0}
            >
              <Line row={screen().tabs} />
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
            <Show when={peek()}>{(found: Accessor<PeekScreen>) => <Peek follow={found()} />}</Show>
          </box>
        }
      >
        {(found: Accessor<FullScreen>) => <FullFollow follow={found()} />}
      </Show>
    </Show>
  );
};

// Mounts the screen on an open renderer; the renderer's destroy disposes it.
export const mount = (renderer: CliRenderer, props: Props): Promise<void> =>
  render(() => <App view={props.view} now={props.now} />, renderer);
