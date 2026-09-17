/** @jsxImportSource @opentui/solid */
import { BorderChars, type CliRenderer } from "@opentui/core";
import { render, useTerminalDimensions } from "@opentui/solid";
import { Option } from "effect";
import { type Accessor, createMemo, For, Index, Show } from "solid-js";
import * as View from "./view.ts";

// What the runner hands the screen: the view as it changes, and the clock the ages tick on.
export type Props = {
  readonly view: Accessor<View.View>;
  readonly now: Accessor<number>;
};

const MUTED = View.PALETTE.muted;

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
const Line = (props: { readonly row: View.Row }) => (
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

// The machines box is as tall as its tabs and cards, the queue's box takes every row left above
// the footer, and a terminal that shrank below the minimum shows the one sentence saying so
// until it grows back.
export const App = (props: Props) => {
  const dimensions = useTerminalDimensions();
  const fits = () => dimensions().width >= View.MIN_COLUMNS && dimensions().height >= View.MIN_ROWS;
  const screen = createMemo(() =>
    View.screen(props.view(), props.now(), dimensions().width, dimensions().height),
  );
  return (
    <Show
      when={fits()}
      fallback={
        <text fg={View.PALETTE.love} wrapMode="none">
          {View.tooSmall(dimensions().width, dimensions().height)}
        </text>
      }
    >
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
      </box>
    </Show>
  );
};

// Mounts the screen on an open renderer; the renderer's destroy disposes it.
export const mount = (renderer: CliRenderer, props: Props): Promise<void> =>
  render(() => <App view={props.view} now={props.now} />, renderer);
