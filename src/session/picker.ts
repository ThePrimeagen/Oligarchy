import { Effect, Option, Ref, Result, Schema, type Scope, Stream } from "effect";
import * as Errors from "../shared/errors.ts";
import * as Children from "./children.ts";
import * as FollowView from "./follow-view.ts";
import * as Readline from "./readline.ts";
import * as State from "./state.ts";

export const SessionListItem = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["downloading", "running"]),
  startedAt: Schema.String,
}).annotate({ identifier: "@oligarchy/session/picker/SessionListItem" });
export type SessionListItem = typeof SessionListItem.Type;

const SessionList = Schema.fromJsonString(Schema.toCodecJson(Schema.Array(SessionListItem)));
const decodeSessionList = Schema.decodeUnknownEffect(SessionList);

const RESET = "\x1b[0m";
const MARKER = "\x1b[36m›\x1b[0m";
const HEADER = "  active sessions";
const FOOTER = "  ↑/↓ or tab navigate • enter select • esc/ctrl-c cancel";

export const LOADING = "\x1b[?25l\r\n\x1b[2K  loading sessions...";

// ---------------------------------------------------------------------------
// View: pure
// ---------------------------------------------------------------------------

export type View = {
  readonly sessions: Option.Option<ReadonlyArray<SessionListItem>>;
  readonly selected: number;
  readonly visibleCount: number;
  readonly lineCount: number;
};

export const initialView: View = {
  sessions: Option.none(),
  selected: 0,
  visibleCount: 1,
  lineCount: 1,
};

export type Action = "up" | "down" | "select" | "cancel" | "ignore";

export const keyAction = (key: Readline.Key): Action => {
  if (key.name === "escape" || (key.ctrl === true && key.name === "c")) {
    return "cancel";
  }
  if (key.name === "up" || (key.name === "tab" && key.shift === true)) {
    return "up";
  }
  if (key.name === "down" || key.name === "tab") {
    return "down";
  }
  if (key.name === "return" || key.name === "enter") {
    return "select";
  }
  return "ignore";
};

// The header and the footer take two rows; one more stays clear for the prompt.
export const loaded = (
  view: View,
  sessions: ReadonlyArray<SessionListItem>,
  rows: number,
): View => {
  const visibleCount = Math.max(1, Math.min(sessions.length, rows - 3));
  return { ...view, sessions: Option.some(sessions), visibleCount, lineCount: visibleCount + 2 };
};

export const apply = (view: View, action: "up" | "down"): View =>
  Option.match(view.sessions, {
    onNone: () => view,
    onSome: (sessions) => ({
      ...view,
      selected:
        action === "up"
          ? (view.selected - 1 + sessions.length) % sessions.length
          : (view.selected + 1) % sessions.length,
    }),
  });

export const draw = (view: View, columns: number, redraw: boolean): string => {
  const sessions = Option.getOrElse(view.sessions, (): ReadonlyArray<SessionListItem> => []);
  let out = redraw ? `\x1b[${String(view.lineCount - 1)}A\r` : "\r";
  const first = Math.min(view.selected, sessions.length - view.visibleCount);
  out += `\x1b[2K${HEADER.slice(0, columns)}\r\n`;
  for (const [offset, session] of sessions.slice(first, first + view.visibleCount).entries()) {
    const index = first + offset;
    const marker = index === view.selected ? MARKER : " ";
    const label = session.status === "running" ? "running" : "pending";
    const id = session.id.slice(0, Math.max(0, columns - 11));
    out += `\x1b[2K${marker} ${FollowView.STATUS_COLOR[label]}${label}${RESET}  ${id}\r\n`;
  }
  return `${out}\x1b[2K${FOOTER.slice(0, columns)}`;
};

// Clears the picker's lines from the bottom up and puts the cursor back where the prompt was.
export const leaveText = (lineCount: number, cursorColumn: number): string => {
  let out = "\r";
  for (let line = 0; line < lineCount; line++) {
    out += "\x1b[2K";
    if (line < lineCount - 1) {
      out += "\x1b[1A";
    }
  }
  return `${out}\x1b[1A\x1b[${String(cursorColumn + 1)}G\x1b[?25h`;
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type Tty = {
  readonly takeKeypresses: Effect.Effect<Readline.Takeover, never, Scope.Scope>;
  readonly output: Readline.Output;
};

type Outcome<E> =
  | { readonly _tag: "selected"; readonly id: string }
  | { readonly _tag: "cancelled" }
  | { readonly _tag: "failed"; readonly error: E | Errors.CommandError };

type Event<E> =
  | { readonly _tag: "key"; readonly keypress: Readline.Keypress }
  | { readonly _tag: "rows"; readonly rows: Result.Result<ReadonlyArray<SessionListItem>, E> };

const failed = <E>(error: E | Errors.CommandError): Option.Option<Outcome<E>> =>
  Option.some({ _tag: "failed", error });

// Owns the keyboard from the first moment, so an Enter typed before the list arrives waits for
// the list instead of submitting `follow` with nothing behind it.
export const run = <E, R>(
  rows: Effect.Effect<ReadonlyArray<SessionListItem>, E, R>,
  tty: Tty,
  cursorColumn: number,
): Effect.Effect<Option.Option<string>, E | Errors.CommandError, R | Scope.Scope> =>
  Effect.gen(function* () {
    const view = yield* Ref.make(initialView);
    const columns = tty.output.columns ?? 80;
    const terminalRows = tty.output.rows ?? 24;

    const step = (event: Event<E>): Effect.Effect<Option.Option<Outcome<E>>> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(view);
        switch (event._tag) {
          case "rows": {
            if (Result.isFailure(event.rows)) {
              return failed<E>(event.rows.failure);
            }
            if (event.rows.success.length === 0) {
              return failed<E>(
                Errors.CommandError.make({ message: "no running or pending sessions" }),
              );
            }
            const next = loaded(current, event.rows.success, terminalRows);
            yield* Ref.set(view, next);
            yield* Readline.write(tty.output, draw(next, columns, false));
            return Option.none();
          }
          case "key": {
            const action = keyAction(event.keypress.key);
            if (action === "cancel") {
              return Option.some<Outcome<E>>({ _tag: "cancelled" });
            }
            if (Option.isNone(current.sessions) || action === "ignore") {
              return Option.none();
            }
            if (action === "select") {
              const id = current.sessions.value[current.selected]?.id;
              return id === undefined
                ? Option.none()
                : Option.some<Outcome<E>>({ _tag: "selected", id });
            }
            const next = apply(current, action);
            yield* Ref.set(view, next);
            yield* Readline.write(tty.output, draw(next, columns, true));
            return Option.none();
          }
        }
        return event satisfies never;
      });

    const { outcome, restoreAfterEnter } = yield* Effect.scoped(
      Effect.gen(function* () {
        const takeover = yield* tty.takeKeypresses;
        yield* Effect.acquireRelease(Readline.write(tty.output, LOADING), () =>
          Effect.flatMap(Ref.get(view), (current) =>
            Readline.write(tty.output, leaveText(current.lineCount, cursorColumn)),
          ),
        );
        const events: Stream.Stream<Event<E>, never, R> = Stream.merge(
          Stream.map(takeover.keys, (keypress): Event<E> => ({ _tag: "key", keypress })),
          Stream.fromEffect(
            Effect.map(Effect.result(rows), (result): Event<E> => ({ _tag: "rows", rows: result })),
          ),
        );
        const last = yield* events.pipe(
          Stream.mapEffect(step),
          Stream.takeUntil(Option.isSome),
          Stream.runLast,
        );
        const ended: Outcome<E> = Option.getOrElse(Option.flatten(last), (): Outcome<E> => ({
          _tag: "cancelled",
        }));
        if (ended._tag === "selected") {
          yield* takeover.deferRestore;
        }
        return { outcome: ended, restoreAfterEnter: takeover.restoreAfterEnter };
      }),
    );

    switch (outcome._tag) {
      case "selected":
        yield* Effect.forkScoped(restoreAfterEnter);
        return Option.some(outcome.id);
      case "cancelled":
        return Option.none();
      case "failed":
        return yield* Effect.fail(outcome.error);
    }
    return outcome satisfies never;
  });

// `ctrl session list` for the picker: running sessions first, narrowed by the typed prefix.
export const listSessions = Effect.fn("Picker.listSessions")(function* (
  serverUrl: string,
  prefix: string,
) {
  const result = yield* Children.runCtrl(serverUrl, [
    "session",
    "list",
    "--count",
    "10",
    "--active",
    "--json",
  ]);
  if (result.code !== 0) {
    return yield* Errors.ChildExit.make({
      command: "ctrl session list",
      code: result.code,
      stderr: result.stderr,
    });
  }
  const items = yield* decodeSessionList(new TextDecoder().decode(result.stdout)).pipe(
    Effect.mapError((error) => Errors.CommandError.make({ message: error.message })),
  );
  const matching = items.filter((row) => row.id.startsWith(prefix));
  if (prefix !== "" && matching.length === 0) {
    return yield* Errors.CommandError.make({ message: "no matching running or pending sessions" });
  }
  return matching;
});

// The completer's answer for `follow <prefix>`: the picked id, or nothing after printing why.
export const completeFollow = Effect.fn("Picker.completeFollow")(function* (
  session: State.Session,
  terminal: Readline.Terminal,
  prefix: string,
) {
  const host = yield* State.Host;
  const cursorColumn = yield* Readline.cursorColumn(terminal.handle);
  return yield* run(
    listSessions(session.serverUrl, prefix),
    { takeKeypresses: terminal.takeKeypresses, output: host.output },
    cursorColumn,
  ).pipe(
    Effect.map((selected): Readline.Completion => [
      Option.match(selected, { onNone: () => [], onSome: (id) => [id] }),
      prefix,
    ]),
    Effect.catch((error) =>
      Readline.write(host.output, `\r\n${error.message}\r\n`).pipe(
        Effect.andThen(Readline.repaintPrompt(terminal.handle)),
        Effect.as<Readline.Completion>([[], prefix]),
      ),
    ),
  );
});
