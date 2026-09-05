import { Effect, Encoding, Option, Ref, Result, Schedule, Scope, Stream } from "effect";
import * as Domain from "../shared/domain.ts";
import * as Image from "./image.ts";
import * as Readline from "./readline.ts";

// The action column; the image takes every column to its right.
export const LEFT_COLS = 40;
// More rows than any terminal shows: lines that scroll off the top are gone for good.
export const MAX_ENTRIES = 200;
export const SPINNER: ReadonlyArray<string> = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = "80 millis";
const GRAY = "\x1b[90m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

export const STATUS_COLOR: Record<Domain.FollowStatus, string> = {
  pending: GRAY,
  running: "\x1b[33m",
  succeeded: GREEN,
  failed: RED,
  aborted: "\x1b[91m",
  timed_out: "\x1b[35m",
};

export const ENTER_SCREEN = "\x1b[?1049h\x1b[?25l\x1b[2J";
export const LEAVE_SCREEN = "\x1b[?25h\x1b[?1049l";

// ---------------------------------------------------------------------------
// View: pure
// ---------------------------------------------------------------------------

export type Entry = {
  readonly id: number | "intent";
  readonly indent: 0 | 2;
  readonly name: string;
  readonly state: "running" | "completed" | "failed";
};

export type View = {
  readonly id: string;
  readonly status: Domain.FollowStatus;
  readonly entries: ReadonlyArray<Entry>;
  readonly png: Option.Option<Uint8Array>;
  readonly frame: number;
};

export const initialView = (id: string): View => ({
  id,
  status: "pending",
  entries: [],
  png: Option.none(),
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

export const apply = (view: View, event: Domain.FollowEvent): View => {
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
      return {
        ...view,
        png: Result.match(Encoding.decodeBase64(event.png), {
          onFailure: () => view.png,
          onSuccess: Option.some,
        }),
      };
  }
  return event satisfies never;
};

export const tick = (view: View): View => ({ ...view, frame: view.frame + 1 });

// Every line is written over in full at a fixed width and nothing ever wraps or writes a
// newline, so the screen never scrolls and the image placement to the right stays put.
export const draw = (view: View, rows: number): string => {
  const glyph = SPINNER[view.frame % SPINNER.length] ?? "";
  const header = `following ${view.id.slice(0, 8)} `;
  let out = `\x1b[1;2H${header}${STATUS_COLOR[view.status]}${view.status}${RESET}${" ".repeat(
    LEFT_COLS - 1 - header.length - view.status.length,
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
    const mark =
      entry.state === "running"
        ? `${GRAY}${glyph}`
        : entry.state === "completed"
          ? `${GREEN}✓`
          : `${RED}✗`;
    out += `${" ".repeat(entry.indent)}${mark} ${label}${RESET}${" ".repeat(width - label.length)}`;
  }
  return `${out}\x1b[${String(rows)};2H${GRAY}ctrl-c detaches${RESET}`;
};

export const imageBox = (columns: number, rows: number): Option.Option<Image.ImageBox> =>
  columns - LEFT_COLS - 1 < 1
    ? Option.none()
    : Option.some({ col: LEFT_COLS + 2, row: 2, cols: columns - LEFT_COLS - 1, rows: rows - 1 });

export const drawImage = (view: View, columns: number, rows: number): string =>
  Option.match(Option.all([view.png, imageBox(columns, rows)]), {
    onNone: () => "",
    onSome: ([png, box]) => Image.placeImage(png, box),
  });

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

// Folds the child's lines into the view and owns the alternate screen while there is
// something to show; returns the final view once the lines end.
export const run = (
  id: string,
  lines: Stream.Stream<string>,
  output: Readline.Output,
): Effect.Effect<View> =>
  Effect.gen(function* () {
    const view = yield* Ref.make(initialView(id));
    const paint = Effect.flatMap(Ref.get(view), (current) =>
      Readline.write(output, draw(current, output.rows ?? 24)),
    );
    const paintImage = Effect.flatMap(Ref.get(view), (current) =>
      Readline.write(output, drawImage(current, output.columns ?? 80, output.rows ?? 24)),
    );
    const redraw = Readline.write(output, `\x1b[2J${Image.clearImages}`).pipe(
      Effect.andThen(paint),
      Effect.andThen(paintImage),
    );
    const spinner = Effect.schedule(
      Ref.update(view, tick).pipe(Effect.andThen(paint)),
      Schedule.spaced(SPINNER_INTERVAL),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        const onScreen = yield* Ref.make(false);
        // The screen is taken on the first event, not before: a refused follow never flashes it.
        const takeScreen = Effect.gen(function* () {
          yield* Effect.acquireRelease(Readline.write(output, ENTER_SCREEN), () =>
            Readline.write(output, `${Image.clearImages}${LEAVE_SCREEN}`),
          ).pipe(Scope.provide(scope));
          yield* Effect.forkIn(spinner, scope);
          yield* Effect.forkIn(
            Stream.runForEach(Readline.resizes(output), () => redraw),
            scope,
          );
        });
        yield* Stream.runForEach(lines, (line) =>
          Effect.gen(function* () {
            const event = yield* Domain.decodeFollowLine(line).pipe(Effect.orDie);
            if (!(yield* Ref.getAndSet(onScreen, true))) {
              yield* takeScreen;
            }
            yield* Ref.update(view, (current) => apply(current, event));
            yield* paint;
            if (event.type === "image") {
              yield* paintImage;
            }
          }),
        );
      }),
    );
    return yield* Ref.get(view);
  });
