import { Encoding, Option, Result, Schema } from "effect";
import type * as Domain from "@oligarchy/shared/domain";
import * as Steps from "@oligarchy/shared/steps";
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
  completed: Text.PALETTE.foam,
  errored: Text.PALETTE.rose,
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
  readonly finishedAt: Option.Option<Date>;
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
// under the intent it belongs to. The peek's commands come first with negative ids. The stamps
// are the viz's clock when the start and the verdict arrived (the stream carries no times, and
// it sends each event as it happens); a peek's commands carry the database's.
export type Entry = {
  readonly id: number | "intent";
  readonly indent: 0 | 2;
  readonly name: string;
  readonly state: "running" | "completed" | "failed";
  readonly startedAt: number;
  readonly finishedAt: Option.Option<number>;
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
  actions: ReadonlyArray<{
    readonly request: unknown;
    readonly createdAt: Date;
    readonly finishedAt: Date | null;
  }>,
  png: Option.Option<Uint8Array>,
): Peek => ({
  _tag: "peek",
  ticket,
  sessionId,
  serverUrl: Option.fromNullishOr(serverUrl),
  commands: actions.slice(-3).map((action) => ({
    name: commandName(action.request),
    at: action.createdAt,
    finishedAt: Option.fromNullishOr(action.finishedAt),
  })),
  png,
});

const peekEntries = (peek: Peek): ReadonlyArray<Entry> =>
  peek.commands.map((command, index) => ({
    id: -(index + 1),
    indent: 0,
    name: command.name,
    state: "completed",
    startedAt: command.at.getTime(),
    finishedAt: Option.map(command.finishedAt, (at) => at.getTime()),
  }));

export const expand = (peek: Peek, serverUrl: string): Full => ({
  _tag: "full",
  ticket: peek.ticket,
  sessionId: peek.sessionId,
  serverUrl,
  status: "pending",
  entries: peekEntries(peek),
  png: peek.png,
  frame: 0,
});

const bounded = (entries: ReadonlyArray<Entry>): ReadonlyArray<Entry> =>
  entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;

// What comes next sits under the newest intent while that intent is open.
const underIntent = (entries: ReadonlyArray<Entry>): Entry["indent"] =>
  entries.findLast((entry) => entry.id === "intent")?.state === "running" ? 2 : 0;

const withState = (
  entries: ReadonlyArray<Entry>,
  index: number,
  state: Entry["state"],
  at: number,
): ReadonlyArray<Entry> =>
  index === -1
    ? entries
    : entries.map((entry, position) =>
        position === index ? { ...entry, state, finishedAt: Option.some(at) } : entry,
      );

// `at` is the viz's clock when the event arrived.
export const apply = (view: Full, event: Domain.FollowEvent, at: number): Full => {
  switch (event.type) {
    case "session":
      return { ...view, status: event.status };
    case "intent":
      if (event.state === "started") {
        return {
          ...view,
          entries: bounded([
            ...view.entries,
            {
              id: "intent",
              indent: 0,
              name: event.message,
              state: "running",
              startedAt: at,
              finishedAt: Option.none(),
            },
          ]),
        };
      }
      return {
        ...view,
        entries: withState(
          view.entries,
          view.entries.findLastIndex((entry) => entry.id === "intent" && entry.state === "running"),
          event.state === "completed" ? "completed" : "failed",
          at,
        ),
      };
    case "action":
      if (event.state === "running") {
        return {
          ...view,
          entries: bounded([
            ...view.entries,
            {
              id: event.id,
              indent: underIntent(view.entries),
              name: event.name,
              state: "running",
              startedAt: at,
              finishedAt: Option.none(),
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
          at,
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
export const mark = (state: Entry["state"], glyph: string): Text.Piece => {
  if (state === "running") {
    return Text.muted(glyph);
  }
  if (state === "completed") {
    return Text.paint(Text.PALETTE.pine, "✓");
  }
  return Text.paint(Text.PALETTE.love, "✗");
};

export const wrap = (text: string, width: number): ReadonlyArray<string> => {
  const plain = Text.clean(text).trim();
  if (plain.length === 0) {
    return [];
  }
  const lines: Array<string> = [];
  let rest = plain;
  while (rest.length > width) {
    const at = rest.lastIndexOf(" ", width);
    const cut = at > 0 ? at : width;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(at > 0 ? at + 1 : cut);
  }
  if (rest.length > 0) {
    lines.push(rest);
  }
  return lines;
};

const intentPiece = (text: string, failed: boolean): Text.Piece => ({
  text,
  color: failed ? Text.PALETTE.love : Text.PALETTE.foam,
  bold: true,
});

// On a ticket the pane is the open step, not the session's history: the place of that line in
// the ActionList, the line itself, and only the actions started under it. The place walks the
// intents still in the follow.
export const ticketRows = (
  view: Full,
  steps: ReadonlyArray<string>,
  height: number,
): ReadonlyArray<Text.Row> => {
  const glyph = SPINNER[view.frame % SPINNER.length];
  const at = view.entries.findLastIndex((entry) => entry.id === "intent");
  const intent = at === -1 ? undefined : view.entries[at];
  const actions =
    at === -1
      ? view.entries.filter((entry) => typeof entry.id === "number" && entry.id > 0)
      : view.entries.slice(at + 1);
  const saidSteps: Array<string> = [];
  for (const entry of view.entries) {
    if (entry.id === "intent") {
      saidSteps.push(entry.name);
    }
  }
  const place = Steps.placeOf(steps, saidSteps);
  const indexText =
    intent !== undefined && place === 0
      ? `—/${String(steps.length)}`
      : `${String(place)}/${String(steps.length)}`;
  const indexRow: Text.Row =
    place > 0
      ? [{ text: indexText, color: Text.PALETTE.gold, bold: true }]
      : [Text.muted(indexText)];
  const said = intent === undefined ? "no intent yet" : intent.name;
  const failed = intent?.state === "failed";
  const lines = wrap(said, LEFT_COLS - 2);
  const intentRows: Array<Text.Row> =
    intent === undefined
      ? [[Text.muted(Text.cut(said, LEFT_COLS))]]
      : lines.map((line, index) =>
          index === 0
            ? [mark(intent.state, glyph), Text.SPACE, intentPiece(line, failed)]
            : [{ text: "  " }, intentPiece(line, failed)],
        );
  const actionRows = actions.map((entry): Text.Row => [
    { text: " ".repeat(entry.indent) },
    mark(entry.state, glyph),
    Text.SPACE,
    Text.value(Text.cut(entry.name, LEFT_COLS - 3 - entry.indent)),
  ]);
  const budget = Math.max(0, height - 2);
  // One row stays with the step, so a short pane still says which line this is.
  let actionBudget = Math.min(actionRows.length, budget);
  if (budget > 0 && intentRows.length > 0) {
    actionBudget = Math.min(actionRows.length, budget - 1);
  }
  const intentBudget = budget - actionBudget;
  return [
    fullHeader(view),
    indexRow,
    ...intentRows.slice(0, intentBudget),
    ...actionRows.slice(actionRows.length - actionBudget),
  ].slice(0, Math.max(0, height));
};

// A row of the timeline: an entry with how long it took (an action that finished, or one still
// running, up to now), or processing: the time from one action's end to the next one's start,
// which the harness and its model spent deciding what to send.
export type Line =
  | { readonly _tag: "entry"; readonly entry: Entry; readonly took: Option.Option<number> }
  | { readonly _tag: "processing"; readonly indent: Entry["indent"]; readonly took: number };

// Processing sits just before the action it led to, so a gap that crosses into a new step is
// under that step. An action without an end (a command the peek read mid-flight) starts no
// processing. While the session runs, the time since the last action ended counts up at the end.
export const timeline = (
  entries: ReadonlyArray<Entry>,
  now: number,
  live: boolean,
): ReadonlyArray<Line> => {
  const lines: Array<Line> = [];
  let last: Entry | undefined;
  for (const entry of entries) {
    if (entry.id === "intent") {
      lines.push({ _tag: "entry", entry, took: Option.none() });
      continue;
    }
    if (last !== undefined && Option.isSome(last.finishedAt)) {
      lines.push({
        _tag: "processing",
        indent: entry.indent,
        took: entry.startedAt - last.finishedAt.value,
      });
    }
    const started = entry.startedAt;
    lines.push({
      _tag: "entry",
      entry,
      took:
        entry.state === "running"
          ? Option.some(now - started)
          : Option.map(entry.finishedAt, (end) => end - started),
    });
    last = entry;
  }
  if (live && last !== undefined && Option.isSome(last.finishedAt)) {
    lines.push({
      _tag: "processing",
      indent: underIntent(entries),
      took: now - last.finishedAt.value,
    });
  }
  return lines;
};

export const indentOf = (line: Line): number =>
  line._tag === "processing" ? line.indent : line.entry.indent;

// One timeline row after `indent` spaces: the mark and the name, and the time at the right edge
// of `width` columns when there is one, gold while the action runs and muted once it is done.
// Processing is muted from end to end.
export const timelineRow = (line: Line, glyph: string, width: number, indent: number): Text.Row => {
  const lead: Text.Piece = { text: " ".repeat(indent) };
  if (line._tag === "processing") {
    const took = Text.elapsed(line.took);
    return [
      lead,
      Text.muted(`· ${Text.fit("processing", width - indent - 3 - took.length)} ${took}`),
    ];
  }
  const { entry } = line;
  const room = width - indent - 2;
  return Option.match(line.took, {
    onNone: (): Text.Row => [
      lead,
      mark(entry.state, glyph),
      Text.SPACE,
      Text.value(Text.cut(entry.name, room)),
    ],
    onSome: (ms): Text.Row => {
      const took = Text.elapsed(ms);
      return [
        lead,
        mark(entry.state, glyph),
        Text.SPACE,
        Text.value(Text.fit(entry.name, room - took.length - 1)),
        Text.SPACE,
        entry.state === "running" ? Text.paint(Text.PALETTE.gold, took) : Text.muted(took),
      ];
    },
  });
};

// The newest timeline rows that fit in `height`, each cut to the column.
export const fullEntries = (view: Full, height: number, now: number): ReadonlyArray<Text.Row> => {
  const glyph = SPINNER[view.frame % SPINNER.length];
  return timeline(view.entries, now, view.status === "running")
    .slice(-height)
    .map((line) => timelineRow(line, glyph, LEFT_COLS - 1, indentOf(line)));
};
