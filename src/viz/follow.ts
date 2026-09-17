import { Encoding, Option, Result, Schema } from "effect";
import type * as Domain from "../shared/domain.ts";
import * as Text from "./text.ts";

// The commands or entries take the left column; the image takes every column to its right,
// three rows in a peek and the rest of the screen when the follow is full.
export const LEFT_COLS = 40;
export const PEEK_IMAGE_ROWS = 3;
// A peek's box: its border rows around the image rows.
export const PEEK_FRAME_ROWS = PEEK_IMAGE_ROWS + 2;
// A long session's entries are bounded: the newest two hundred are what is worth scrolling.
export const MAX_ENTRIES = 200;
export const SPINNER: ReadonlyArray<string> = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const PEEK_HINT = "F full screen   esc close";
export const FULL_FOOT = "esc closes";

export const STATUS_COLOR: Readonly<Record<Domain.FollowStatus, string>> = {
  pending: Text.PALETTE.muted,
  running: Text.PALETTE.gold,
  succeeded: Text.PALETTE.pine,
  failed: Text.PALETTE.love,
  aborted: Text.PALETTE.love,
  timed_out: Text.PALETTE.iris,
};

// An action's request is the QMP command as sent; `execute` names it.
const Execute = Schema.Struct({ execute: Schema.String }).annotate({
  identifier: "@oligarchy/viz/follow/Execute",
});
const decodeExecute = Schema.decodeUnknownOption(Execute);

export const commandName = (request: unknown): string =>
  Option.getOrElse(
    Option.map(decodeExecute(request), (body) => body.execute),
    () => "?",
  );

export type Command = {
  readonly name: string;
  readonly at: Date;
};

// What F shows first: the selected job's last three commands and its last screenshot, read
// from the database, and the qemu server a second F would follow it on.
export type Peek = {
  readonly _tag: "peek";
  readonly ticket: string;
  readonly sessionId: string;
  readonly serverUrl: Option.Option<string>;
  readonly commands: ReadonlyArray<Command>;
  readonly png: Option.Option<Uint8Array>;
};

// One row of the live follow: an intent the agent announced, or an action it sent, indented
// under the intent it belongs to. The peek's commands come first with negative ids.
export type Entry = {
  readonly id: number | "intent";
  readonly indent: 0 | 2;
  readonly name: string;
  readonly state: "running" | "completed" | "failed";
};

// The whole screen following one session as the qemu server streams it; frame turns the
// spinner on the running entries.
export type Full = {
  readonly _tag: "full";
  readonly ticket: string;
  readonly sessionId: string;
  readonly serverUrl: string;
  readonly status: Domain.FollowStatus;
  readonly entries: ReadonlyArray<Entry>;
  readonly png: Option.Option<Uint8Array>;
  readonly frame: number;
};

export type Follow = Peek | Full;

export const peekFromActions = (
  ticket: string,
  sessionId: string,
  serverUrl: string | null,
  actions: ReadonlyArray<{ readonly request: unknown; readonly createdAt: Date }>,
  png: Option.Option<Uint8Array>,
): Peek => ({
  _tag: "peek",
  ticket,
  sessionId,
  serverUrl: Option.fromNullishOr(serverUrl),
  commands: actions.slice(-3).map((action) => ({
    name: commandName(action.request),
    at: action.createdAt,
  })),
  png,
});

export const expand = (peek: Peek, serverUrl: string): Full => ({
  _tag: "full",
  ticket: peek.ticket,
  sessionId: peek.sessionId,
  serverUrl,
  status: "pending",
  entries: peek.commands.map((command, index) => ({
    id: -(index + 1),
    indent: 0,
    name: command.name,
    state: "completed",
  })),
  png: peek.png,
  frame: 0,
});

const bounded = (entries: ReadonlyArray<Entry>): ReadonlyArray<Entry> =>
  entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;

const withState = (
  entries: ReadonlyArray<Entry>,
  index: number,
  state: Entry["state"],
): ReadonlyArray<Entry> =>
  index === -1 ? entries : entries.map((entry, at) => (at === index ? { ...entry, state } : entry));

export const apply = (view: Full, event: Domain.FollowEvent): Full => {
  switch (event.type) {
    case "session":
      return { ...view, status: event.status };
    case "intent":
      if (event.state === "started") {
        return {
          ...view,
          entries: bounded([
            ...view.entries,
            { id: "intent", indent: 0, name: event.message, state: "running" },
          ]),
        };
      }
      return {
        ...view,
        entries: withState(
          view.entries,
          view.entries.findLastIndex((entry) => entry.id === "intent" && entry.state === "running"),
          event.state === "completed" ? "completed" : "failed",
        ),
      };
    case "action":
      if (event.state === "running") {
        const intent = view.entries.findLast((entry) => entry.id === "intent");
        return {
          ...view,
          entries: bounded([
            ...view.entries,
            {
              id: event.id,
              indent: intent?.state === "running" ? 2 : 0,
              name: event.name,
              state: "running",
            },
          ]),
        };
      }
      return {
        ...view,
        entries: withState(
          view.entries,
          view.entries.findIndex((entry) => entry.id === event.id),
          event.state,
        ),
      };
    case "image":
      return { ...view, png: Option.some(Result.getOrThrow(Encoding.decodeBase64(event.png))) };
  }
  return event satisfies never;
};

export const tick = (view: Full): Full => ({ ...view, frame: view.frame + 1 });

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const session8 = (sessionId: string): string => sessionId.slice(0, 8);

export const title = (peek: Peek): string => `follow ${peek.ticket} · ${session8(peek.sessionId)}`;

// The peek's three rows: each command with its age at the column's right edge, the column
// blank where there are fewer, and one muted sentence when there are none.
export const peekRows = (peek: Peek, now: number): ReadonlyArray<Text.Row> =>
  Array.from({ length: PEEK_IMAGE_ROWS }, (_, index): Text.Row => {
    const command = peek.commands[index];
    if (command === undefined) {
      return index === 0 && peek.commands.length === 0 ? [Text.muted("no commands yet")] : [];
    }
    const ago = `${Text.age(now - command.at.getTime())} ago`;
    return [
      Text.value(Text.fit(command.name, LEFT_COLS - ago.length - Text.GAP.text.length)),
      Text.GAP,
      Text.label(ago),
    ];
  });

export const fullHeader = (view: Full): Text.Row => [
  Text.value(`following ${view.ticket} · ${session8(view.sessionId)} `),
  Text.paint(STATUS_COLOR[view.status], view.status),
];

// A running entry turns the spinner, a completed one is a pine tick, a failed one a red cross.
const mark = (state: Entry["state"], glyph: string): Text.Piece => {
  if (state === "running") {
    return Text.muted(glyph);
  }
  if (state === "completed") {
    return Text.paint(Text.PALETTE.pine, "✓");
  }
  return Text.paint(Text.PALETTE.love, "✗");
};

// The newest entries that fit in `height` rows, each its mark and its name cut to the column.
export const fullEntries = (view: Full, height: number): ReadonlyArray<Text.Row> => {
  const glyph = SPINNER[view.frame % SPINNER.length];
  return view.entries
    .slice(-height)
    .map((entry): Text.Row => [
      { text: " ".repeat(entry.indent) },
      mark(entry.state, glyph),
      Text.SPACE,
      Text.value(Text.cut(entry.name, LEFT_COLS - 3 - entry.indent)),
    ]);
};
