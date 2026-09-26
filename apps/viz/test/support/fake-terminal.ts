import { type Cause, Effect, Layer, Option, type PlatformError, Queue, Terminal } from "effect";

export type FakeTerminal = {
  readonly layer: Layer.Layer<Terminal.Terminal>;
  // One entry per display call, in order, whether or not the scripted display accepted it.
  readonly frames: Array<string>;
  readonly written: () => string;
  // What readInput hands out: the test offers keys, or ends it as ctrl-c does.
  readonly keys: Queue.Queue<Terminal.UserInput, Cause.Done>;
  readonly resize: (columns: number, rows: number) => void;
  // One keypress, as readline parses a typed character.
  readonly press: (character: string) => Effect.Effect<void>;
  // One named key without a character, as readline reports tab and the arrows.
  readonly key: (name: string, shift?: boolean) => Effect.Effect<void>;
};

// A Terminal whose size the test sets, whose keys the test types and whose frames it reads back.
// `display` may be scripted to fail, as a closed stdout would; 0×0 is what a pipe reports.
export const fakeTerminal = (
  options: {
    readonly columns?: number;
    readonly rows?: number;
    readonly display?: (text: string) => Effect.Effect<void, PlatformError.PlatformError>;
  } = {},
): Effect.Effect<FakeTerminal> =>
  Effect.gen(function* () {
    const keys = yield* Queue.make<Terminal.UserInput, Cause.Done>();
    const size = { columns: options.columns ?? 135, rows: options.rows ?? 37 };
    const frames: Array<string> = [];
    const display = options.display ?? (() => Effect.void);
    const terminal = Terminal.make({
      columns: Effect.sync(() => size.columns),
      rows: Effect.sync(() => size.rows),
      readInput: Effect.succeed(keys),
      readLine: Effect.die("Unexpected Terminal.readLine"),
      display: (text) =>
        Effect.sync(() => {
          frames.push(text);
        }).pipe(Effect.andThen(display(text))),
    });
    return {
      layer: Layer.succeed(Terminal.Terminal)(terminal),
      frames,
      written: () => frames.join(""),
      keys,
      resize: (columns, rows) => {
        size.columns = columns;
        size.rows = rows;
      },
      press: (character) =>
        Effect.asVoid(
          Queue.offer(keys, {
            input: Option.some(character),
            key: {
              name: character.toLowerCase(),
              ctrl: false,
              meta: false,
              shift: character !== character.toLowerCase(),
            },
          }),
        ),
      key: (name, shift = false) =>
        Effect.asVoid(
          Queue.offer(keys, {
            input: Option.none(),
            key: { name, ctrl: false, meta: false, shift },
          }),
        ),
    };
  });
