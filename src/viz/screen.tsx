/** @jsxImportSource @opentui/solid */
import { BorderChars, type CliRenderer, RGBA } from "@opentui/core";
import { render, useTerminalDimensions } from "@opentui/solid";
import { Option } from "effect";
import { type Accessor, createMemo, For, Index, type ParentProps, Show } from "solid-js";
import * as Follow from "./follow.ts";
import * as Text from "./text.ts";
import * as View from "./view.ts";

// What the runner hands the screen: the view as it changes, and the clock the ages tick on.
// imageProtocol omitted leaves the choice to OpenTUI.
export type Props = {
  readonly view: Accessor<View.View>;
  readonly now: Accessor<number>;
  readonly imageProtocol?: "kitty" | "auto";
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
const Peek = (props: {
  readonly follow: Follow.Peek;
  readonly now: number;
  readonly imageProtocol: "kitty" | "auto" | undefined;
}) => (
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
          protocol={props.imageProtocol ?? "auto"}
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
  readonly imageProtocol: "kitty" | "auto" | undefined;
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
          <image
            source={png()}
            fit="fit"
            protocol={props.imageProtocol ?? "auto"}
            flexGrow={1}
            marginLeft={1}
          />
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
            <Show when={peek()}>
              {(found: Accessor<Follow.Peek>) => (
                <Peek follow={found()} now={props.now()} imageProtocol={props.imageProtocol} />
              )}
            </Show>
          </box>
        }
      >
        {(found: Accessor<Follow.Full>) => (
          <FullFollow
            follow={found()}
            notice={props.view().notice}
            rows={dimensions().height}
            imageProtocol={props.imageProtocol}
          />
        )}
      </Show>
      <Show when={asked()}>{(found: Accessor<View.Confirm>) => <Confirm asked={found()} />}</Show>
      <Show when={popup()}>{(text: Accessor<string>) => <Popup text={text()} />}</Show>
    </Show>
  );
};

// Mounts the screen on an open renderer; the renderer's destroy disposes it.
export const mount = (renderer: CliRenderer, props: Props): Promise<void> =>
  render(() => <App {...props} />, renderer);
