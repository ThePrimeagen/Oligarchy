import { Effect, Encoding, Option, Result, Schema } from "effect";
import * as Actions from "../db/actions.ts";
import * as Render from "../observability/render.ts";
import * as Image from "../session/image.ts";
import * as Domain from "../shared/domain.ts";
import type * as Errors from "../shared/errors.ts";

// The action column; the image takes every column to its right, three rows in a peek and the
// rest of the screen when follow is full.
export const LEFT_COLS = 40;
export const PEEK_IMAGE_ROWS = 3;
export const PEEK_FRAME_ROWS = 5;
export const MAX_ENTRIES = 200;
export const SPINNER: ReadonlyArray<string> = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const PALETTE = Render.ROSE_PINE_MAIN;
const FG_RESET = "\x1b[39m";
const BOLD = "\x1b[1m";
const UNBOLD = "\x1b[22m";

const paint = (hex: string, text: string): string => `${Render.foreground(hex)}${text}${FG_RESET}`;
const bold = (text: string): string => `${BOLD}${text}${UNBOLD}`;
const muted = (text: string): string => paint(PALETTE.muted, text);

export const STATUS_COLOR: Record<Domain.FollowStatus, string> = {
  pending: PALETTE.muted,
  running: PALETTE.gold,
  succeeded: PALETTE.pine,
  failed: PALETTE.love,
  aborted: PALETTE.love,
  timed_out: PALETTE.iris,
};

const Execute = Schema.Struct({ execute: Schema.String }).annotate({
  identifier: "@oligarchy/viz/follow/Execute",
});
const decodeExecute = Schema.decodeUnknownOption(Execute);

export const commandName = (request: unknown): string =>
  Option.getOrElse(
    Option.map(decodeExecute(request), (body) => body.execute),
    () => "?",
  );

const age = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${String(seconds)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)} h`;
  }
  return `${String(Math.floor(hours / 24))} d`;
};

export type Command = {
  readonly name: string;
  readonly at: Date;
};

export type Peek = {
  readonly _tag: "peek";
  readonly ticket: string;
  readonly sessionId: string;
  readonly serverUrl: Option.Option<string>;
  readonly commands: ReadonlyArray<Command>;
  readonly png: Option.Option<Uint8Array>;
};

export type Entry = {
  readonly id: number | "intent";
  readonly indent: 0 | 2;
  readonly name: string;
  readonly state: "running" | "completed" | "failed";
};

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

const markOf = (state: Entry["state"], glyph: string): string => {
  if (state === "running") {
    return paint(PALETTE.muted, glyph);
  }
  if (state === "completed") {
    return paint(PALETTE.pine, "✓");
  }
  return paint(PALETTE.love, "✗");
};

const boxed = (content: string): string => `${muted("│")} ${content} ${muted("│")}`;

const clean = (text: string): string =>
  Array.from(text, (character) =>
    character < " " || (character >= "\u007f" && character <= "\u009f") ? " " : character,
  ).join("");

const fit = (text: string, width: number): string => {
  const plain = clean(text);
  return plain.length > width ? `${plain.slice(0, width - 1)}…` : plain.padEnd(width);
};

const titleOf = (ticket: string, sessionId: string): string =>
  `follow ${ticket} · ${sessionId.slice(0, 8)}`;

export const drawPeek = (
  peek: Peek,
  now: number,
  columns: number,
): { readonly lines: ReadonlyArray<string>; readonly imageRow: number } => {
  const usable = columns - 4;
  const title = titleOf(peek.ticket, peek.sessionId);
  const top = `${muted("╭─┤ ")}${bold(paint(PALETTE.text, title))}${muted(` ├${"─".repeat(Math.max(0, columns - 7 - title.length))}╮`)}`;
  const hint = "F full screen   esc close";
  const bottom = muted(`╰${"─".repeat(Math.max(0, columns - 7 - hint.length))}┤ ${hint} ├─╯`);
  const commandWidth = Math.min(LEFT_COLS, usable);
  const rows = Array.from({ length: PEEK_IMAGE_ROWS }, (_, index) => {
    const command = peek.commands[index];
    if (command === undefined) {
      const empty =
        index === 0 && peek.commands.length === 0
          ? muted(fit("no commands yet", commandWidth))
          : "";
      return boxed(`${empty}${" ".repeat(usable - (empty === "" ? 0 : commandWidth))}`);
    }
    const ago = `${age(now - command.at.getTime())} ago`;
    const name = fit(command.name, commandWidth - ago.length - 2);
    const line = `${paint(PALETTE.text, name)}  ${paint(PALETTE.subtle, ago)}`;
    return boxed(`${line}${" ".repeat(Math.max(0, usable - commandWidth))}`);
  });
  return { lines: [top, ...rows, bottom], imageRow: 2 };
};

export const peekImageBox = (columns: number, startRow: number): Option.Option<Image.ImageBox> => {
  const col = LEFT_COLS + 3;
  const cols = columns - col;
  return cols < 1
    ? Option.none()
    : Option.some({ col, row: startRow, cols, rows: PEEK_IMAGE_ROWS });
};

export const drawPeekImage = (peek: Peek, columns: number, startRow: number): string =>
  Option.match(Option.all([peek.png, peekImageBox(columns, startRow)]), {
    onNone: () => "",
    onSome: ([png, box]) => Image.placeImage(png, box),
  });

export const drawFull = (view: Full, columns: number, rows: number): string => {
  const glyph = SPINNER[view.frame % SPINNER.length];
  const header = `following ${view.ticket} · ${view.sessionId.slice(0, 8)} `;
  const status = view.status;
  let out = `\x1b[1;2H${header}${paint(STATUS_COLOR[status], status)}${" ".repeat(
    Math.max(0, LEFT_COLS - 1 - header.length - status.length),
  )}`;
  const visible = view.entries.slice(-(rows - 2));
  for (let row = 2; row < rows; row++) {
    const entry = visible[row - 2];
    out += `\x1b[${String(row)};2H`;
    if (entry === undefined) {
      out += " ".repeat(LEFT_COLS - 1);
      continue;
    }
    const width = LEFT_COLS - 3 - entry.indent;
    const label = entry.name.length > width ? `${entry.name.slice(0, width - 1)}…` : entry.name;
    const mark = markOf(entry.state, glyph);
    out += `${" ".repeat(entry.indent)}${mark} ${label}${" ".repeat(width - label.length)}`;
  }
  return `${out}\x1b[${String(rows)};2H${paint(PALETTE.muted, "esc closes")}`;
};

export const fullImageBox = (columns: number, rows: number): Option.Option<Image.ImageBox> =>
  columns - LEFT_COLS - 1 < 1
    ? Option.none()
    : Option.some({ col: LEFT_COLS + 2, row: 2, cols: columns - LEFT_COLS - 1, rows: rows - 1 });

export const drawFullImage = (view: Full, columns: number, rows: number): string =>
  Option.match(Option.all([view.png, fullImageBox(columns, rows)]), {
    onNone: () => "",
    onSome: ([png, box]) => Image.placeImage(png, box),
  });

export const loadPeek = (
  ticket: string,
  sessionId: string,
  serverUrl: string | null,
): Effect.Effect<Peek, Errors.DatabaseError, Actions.ActionStore> =>
  Effect.gen(function* () {
    const actions = yield* Actions.ActionStore;
    const rows = yield* actions.listActions(sessionId);
    const images = yield* actions.listImages(sessionId);
    const last = images.at(-1);
    const png = last === undefined ? Option.none<Uint8Array>() : yield* actions.getImage(last.id);
    return peekFromActions(ticket, sessionId, serverUrl, rows, png);
  });
