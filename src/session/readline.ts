import { type AsyncCompleter, createInterface, type Interface } from "node:readline";
import { type Cause, Effect, Option, Queue, Schema, type Scope, Stream } from "effect";

// The one file of the session that touches node:readline and the process: everything the REPL
// does to the terminal goes through the functions below.

export type Key = {
  readonly name?: string | undefined;
  readonly ctrl?: boolean | undefined;
  readonly shift?: boolean | undefined;
  readonly meta?: boolean | undefined;
  readonly sequence?: string | undefined;
};

export type Keypress = { readonly text: string | undefined; readonly key: Key };

export type Input = NodeJS.ReadableStream & { readonly isTTY?: boolean | undefined };

export type Output = NodeJS.WritableStream & {
  readonly isTTY?: boolean | undefined;
  readonly columns?: number | undefined;
  readonly rows?: number | undefined;
};

export type Handle = Interface;

export type Completion = readonly [ReadonlyArray<string>, string];

export type CompletionRequest = {
  readonly line: string;
  readonly complete: (completion: Completion) => void;
};

export type Terminal = {
  readonly handle: Handle;
  // Every submitted line; ends when the interface closes (stdin gone, or `close`).
  readonly lines: Stream.Stream<string>;
  // One element per Ctrl-C readline saw.
  readonly sigints: Stream.Stream<void>;
  // One request per Tab; the REPL answers each through `complete`.
  readonly completions: Stream.Stream<CompletionRequest>;
};

type Listener = (...args: Array<unknown>) => void;

const isListener = (candidate: Function): candidate is Listener => typeof candidate === "function";

// Readline's keypress listeners taken off `input`, with what was typed since held back.
type Capture = {
  readonly buffered: Array<Keypress>;
  readonly restore: () => void;
};

// Synchronous on purpose: called from readline's completer, before it goes on to the next
// character of the same input chunk, so a Tab and Enter typed together still submit the line.
const startCapture = (input: Input): Capture => {
  const previous = input.listeners("keypress").filter(isListener);
  const buffered: Array<Keypress> = [];
  const raw = (text: string | undefined, key: Key) => {
    buffered.push({ text, key });
  };
  const restore = () => {
    input.removeListener("keypress", raw);
    for (const attached of previous) {
      input.on("keypress", attached);
    }
  };
  for (const attached of previous) {
    input.removeListener("keypress", attached);
  }
  input.on("keypress", raw);
  input.resume();
  return { buffered, restore };
};

// The listeners go on before anything else runs: readline starts reading its input at once,
// and a line piped in ahead of the first prompt would otherwise be emitted to nobody.
export const open = (input: Input, output: Output): Effect.Effect<Terminal, never, Scope.Scope> =>
  Effect.gen(function* () {
    const requests = yield* Queue.unbounded<CompletionRequest, Cause.Done>();
    const lines = yield* Queue.unbounded<string, Cause.Done>();
    const sigints = yield* Queue.unbounded<void, Cause.Done>();
    const completer: AsyncCompleter = (line, callback) => {
      const capture = startCapture(input);
      Queue.offerUnsafe(requests, {
        line,
        complete: ([candidates, word]) => {
          callback(null, [Array.from(candidates), word]);
          capture.restore();
          for (const keypress of capture.buffered) {
            input.emit("keypress", keypress.text, keypress.key);
          }
        },
      });
    };
    const end = () => {
      Queue.endUnsafe(lines);
      Queue.endUnsafe(sigints);
      Queue.endUnsafe(requests);
    };
    const handle = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const rl = createInterface({ input, output, completer });
        rl.on("line", (line) => {
          Queue.offerUnsafe(lines, line);
        });
        rl.on("SIGINT", () => {
          Queue.offerUnsafe(sigints, undefined);
        });
        rl.on("close", end);
        return rl;
      }),
      (rl) =>
        Effect.sync(() => {
          rl.close();
          end();
        }),
    );
    return {
      handle,
      lines: Stream.fromQueue(lines),
      sigints: Stream.fromQueue(sigints),
      completions: Stream.fromQueue(requests),
    };
  });

const closedFlag = Schema.decodeUnknownOption(Schema.Struct({ closed: Schema.Literal(true) }));

// Nothing to prompt on once the interface has closed: Node throws ERR_USE_AFTER_CLOSE.
export const prompt = (handle: Handle, text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (Option.isNone(closedFlag(handle))) {
      handle.setPrompt(text);
      handle.prompt();
    }
  });

export const close = (handle: Handle): Effect.Effect<void> =>
  Effect.sync(() => {
    handle.close();
  });

export const write = (output: Output, text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    output.write(text);
  });

// Resolves on the first of the named signals; the listeners come off when the effect ends.
export const signals = (names: ReadonlyArray<NodeJS.Signals>): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    const onSignal = () => {
      resume(Effect.void);
    };
    for (const name of names) {
      process.on(name, onSignal);
    }
    return Effect.sync(() => {
      for (const name of names) {
        process.off(name, onSignal);
      }
    });
  });
