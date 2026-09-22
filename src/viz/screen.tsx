/** @jsxImportSource @opentui/solid */
import { BorderChars, type CliRenderer, RGBA } from "@opentui/core";
import { render, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { Option } from "effect";
import {
  type Accessor,
  createEffect,
  createMemo,
  For,
  Index,
  onCleanup,
  type ParentProps,
  Show,
} from "solid-js";
import * as Follow from "./follow.ts";
import * as Placeholder from "./placeholder.ts";
import * as Text from "./text.ts";
import * as View from "./view.ts";

// What the runner hands the screen: the view as it changes, and the clock the ages tick on.
// imageProtocol omitted leaves the choice to OpenTUI.
export type Props = {
  readonly view: Accessor<View.View>;
  readonly now: Accessor<number>;
  readonly imageProtocol?: "kitty" | "auto";
  // Writes a graphics sequence. Omitted, a kitty host still lays the cells out and nothing is sent.
  readonly place?: (sequence: string) => void;
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

// OpenTUI's kitty placement moves the cursor and then tells the host to draw there. tmux consumes
// the cursor move, so the host draws at its own cursor, the corner, and that graphic is not a
// cell: it stays up when the pane is no longer the one on screen. A placeholder cell is text
// OpenTUI lays out, and the host paints the image on it, so the picture sits in the pane and
// leaves with it. A grid the diacritics cannot name falls back to blocks, which are cells too.
const Shot = (props: {
  readonly png: Uint8Array;
  readonly columns: number;
  readonly rows: number;
  readonly id: number;
  readonly protocol: "kitty" | "auto" | undefined;
  readonly place: ((sequence: string) => void) | undefined;
  readonly marginLeft?: number;
}) => {
  const renderer = useRenderer();
  const pinned = () => props.protocol === "kitty" && Placeholder.fits(props.columns, props.rows);
  createEffect(() => {
    const place = props.place;
    if (!pinned() || place === undefined) {
      return;
    }
    place(Placeholder.show(props.png, props.id, props.columns, props.rows));
    onCleanup(() => {
      // destroy() is already restoring the terminal; a delete written into that would split it.
      if (!renderer.isDestroyed) {
        place(Placeholder.hide(props.id));
      }
    });
  });
  return (
    <Show
      when={pinned()}
      fallback={
        <image
          source={props.png}
          fit="fit"
          protocol={props.protocol === "kitty" ? "blocks" : (props.protocol ?? "auto")}
          flexGrow={1}
          height={props.rows}
          marginLeft={props.marginLeft ?? 0}
        />
      }
    >
      <box
        marginLeft={props.marginLeft ?? 0}
        width={props.columns}
        height={props.rows}
        flexShrink={0}
        flexDirection="column"
      >
        <Index each={Placeholder.lines(props.columns, props.rows)}>
          {(line) => (
            <text wrapMode="none" fg={Placeholder.color(props.id)} width={props.columns} height={1}>
              {line()}
            </text>
          )}
        </Index>
      </box>
    </Show>
  );
};

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
  readonly columns: number;
  readonly imageProtocol: "kitty" | "auto" | undefined;
  readonly place: ((sequence: string) => void) | undefined;
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
        <Shot
          png={png()}
          columns={props.columns - Follow.LEFT_COLS - 6}
          rows={Follow.PEEK_IMAGE_ROWS}
          id={Placeholder.PEEK}
          protocol={props.imageProtocol}
          place={props.place}
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
  readonly columns: number;
  readonly rows: number;
  readonly imageProtocol: "kitty" | "auto" | undefined;
  readonly place: ((sequence: string) => void) | undefined;
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
          <Shot
            png={png()}
            columns={props.columns - Follow.LEFT_COLS - 2}
            rows={props.rows - 2}
            id={Placeholder.FULL}
            protocol={props.imageProtocol}
            place={props.place}
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
                }>,
              ) => (
                <box
                  position="absolute"
                  top={found().top}
                  left={View.SESSION_IMAGE_LEFT}
                  right={2}
                  height={found().height}
                >
                  <Shot
                    png={found().png}
                    columns={dimensions().width - View.SESSION_IMAGE_LEFT - 2}
                    rows={found().height}
                    id={Placeholder.SESSION}
                    protocol={props.imageProtocol}
                    place={props.place}
                  />
                </box>
              )}
            </Show>
            <Show when={peek()}>
              {(found: Accessor<Follow.Peek>) => (
                <Peek
                  follow={found()}
                  now={props.now()}
                  columns={dimensions().width}
                  imageProtocol={props.imageProtocol}
                  place={props.place}
                />
              )}
            </Show>
          </box>
        }
      >
        {(found: Accessor<Follow.Full>) => (
          <FullFollow
            follow={found()}
            notice={props.view().notice}
            columns={dimensions().width}
            rows={dimensions().height}
            imageProtocol={props.imageProtocol}
            place={props.place}
          />
        )}
      </Show>
      <Show when={sheet()}>{(found: Accessor<View.Sheet>) => <Sheet sheet={found()} />}</Show>
      <Show when={asked()}>{(found: Accessor<View.Confirm>) => <Confirm asked={found()} />}</Show>
      <Show when={popup()}>{(text: Accessor<string>) => <Popup text={text()} />}</Show>
    </Show>
  );
};

// Mounts the screen on an open renderer; the renderer's destroy disposes it.
export const mount = (renderer: CliRenderer, props: Props): Promise<void> =>
  render(() => <App {...props} />, renderer);
