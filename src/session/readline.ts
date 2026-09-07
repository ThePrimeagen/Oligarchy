import { type AsyncCompleter, createInterface, type Interface } from "node:readline";
import { type Cause, Deferred, Effect, Option, Queue, Schema, type Scope, Stream } from "effect";

// The one file of the session that touches node:readline and the process: everything the REPL,
// the picker and the follow view do to the terminal goes through the functions below.

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

export type Takeover = {
  readonly keys: Stream.Stream<Keypress>;
  // Leave the previous listeners detached when the scope closes; the holder restores them
  // itself through `restoreAfterEnter`.
  readonly deferRestore: Effect.Effect<void>;
  // Wait CRLF_DELAY for the LF of the Enter that ended the takeover, drop it, put the previous
  // listeners back, and pass any other key on to them.
  readonly restoreAfterEnter: Effect.Effect<void>;
};

export type Terminal = {
  readonly handle: Handle;
  // Every submitted line; ends when the interface closes (stdin gone, or `close`).
  readonly lines: Stream.Stream<string>;
  // One element per Ctrl-C readline saw.
  readonly sigints: Stream.Stream<void>;
  // One request per Tab; the REPL answers each through `complete`.
  readonly completions: Stream.Stream<CompletionRequest>;
  // Owns the keyboard until the scope closes, continuing the hold a Tab began.
  readonly takeKeypresses: Effect.Effect<Takeover, never, Scope.Scope>;
};

export const CRLF_DELAY = "100 millis";

type Listener = (...args: Array<unknown>) => void;

const isListener = (candidate: Function): candidate is Listener => typeof candidate === "function";

// Readline's keypress listeners taken off `input`, with what was typed since held back.
type Capture = {
  readonly buffered: Array<Keypress>;
  sink: ((keypress: Keypress) => void) | undefined;
  adopted: boolean;
  readonly detach: () => void;
  readonly restore: () => void;
};

// Synchronous on purpose: called from readline's completer, before it goes on to the next
// character of the same input chunk, so a Tab and Enter typed together both reach the picker.
const startCapture = (input: Input): Capture => {
  const previous = input.listeners("keypress").filter(isListener);
  const buffered: Array<Keypress> = [];
  const raw = (text: string | undefined, key: Key) => {
    const keypress = { text, key };
    if (capture.sink === undefined) {
      buffered.push(keypress);
    } else {
      capture.sink(keypress);
    }
  };
  const detach = () => {
    input.removeListener("keypress", raw);
  };
  const capture: Capture = {
    buffered,
    sink: undefined,
    adopted: false,
    detach,
    restore: () => {
      detach();
      for (const attached of previous) {
        input.on("keypress", attached);
      }
    },
  };
  for (const attached of previous) {
    input.removeListener("keypress", attached);
  }
  input.on("keypress", raw);
  input.resume();
  return capture;
};

const isLineFeed = (keypress: Keypress): boolean =>
  keypress.text === "\n" && keypress.key.name === "enter";

const adopt = (input: Input, capture: Capture): Effect.Effect<Takeover, never, Scope.Scope> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<Keypress, Cause.Done>();
    const held = yield* Deferred.make<Keypress>();
    let deferred = false;
    capture.adopted = true;
    for (const keypress of capture.buffered) {
      Queue.offerUnsafe(queue, keypress);
    }
    capture.buffered.length = 0;
    capture.sink = (keypress) => {
      Queue.offerUnsafe(queue, keypress);
    };
    const hold = (text: string | undefined, key: Key) => {
      input.removeListener("keypress", hold);
      Deferred.doneUnsafe(held, Effect.succeed({ text, key }));
    };
    const restore = Effect.sync(() => {
      input.removeListener("keypress", hold);
      capture.restore();
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        input.pause();
        capture.detach();
        Queue.endUnsafe(queue);
        if (deferred) {
          input.on("keypress", hold);
        } else {
          capture.restore();
        }
      }),
    );
    // One terminal Enter can parse as CR and LF keypresses. Restore readline after that pair
    // so the LF cannot submit the completed command.
    const restoreAfterEnter = Effect.gen(function* () {
      const next = yield* Effect.raceFirst(
        Effect.map(Deferred.await(held), Option.some),
        Effect.as(Effect.sleep(CRLF_DELAY), Option.none<Keypress>()),
      );
      yield* restore;
      if (Option.isSome(next) && !isLineFeed(next.value)) {
        input.emit("keypress", next.value.text, next.value.key);
      }
    });
    return {
      keys: Stream.fromQueue(queue),
      deferRestore: Effect.sync(() => {
        deferred = true;
      }),
      restoreAfterEnter,
    };
  }).pipe(Effect.uninterruptible);

// Owns every keypress on `input` until the scope closes: readline's own listeners are removed
// so a Tab or Enter meant for the picker cannot edit or submit the line underneath.
export const takeKeypresses = (input: Input): Effect.Effect<Takeover, never, Scope.Scope> =>
  Effect.suspend(() => adopt(input, startCapture(input)));

// The listeners go on before anything else runs: readline starts reading its input at once,
// and a line piped in ahead of the first prompt would otherwise be emitted to nobody.
export const open = (input: Input, output: Output): Effect.Effect<Terminal, never, Scope.Scope> =>
  Effect.gen(function* () {
    const requests = yield* Queue.unbounded<CompletionRequest, Cause.Done>();
    const lines = yield* Queue.unbounded<string, Cause.Done>();
    const sigints = yield* Queue.unbounded<void, Cause.Done>();
    let pending: Capture | undefined;
    const completer: AsyncCompleter = (line, callback) => {
      const capture = startCapture(input);
      pending = capture;
      Queue.offerUnsafe(requests, {
        line,
        complete: ([candidates, word]) => {
          callback(null, [Array.from(candidates), word]);
          if (!capture.adopted) {
            // Nobody took the keys: readline gets them back, after the completed text.
            if (pending === capture) {
              pending = undefined;
            }
            capture.restore();
            for (const keypress of capture.buffered) {
              input.emit("keypress", keypress.text, keypress.key);
            }
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
      takeKeypresses: Effect.suspend(() => {
        const capture = pending ?? startCapture(input);
        pending = undefined;
        return adopt(input, capture);
      }),
    };
  });

const completionFlag = Schema.decodeUnknownOption(
  Schema.Struct({ isCompletionEnabled: Schema.Boolean }),
);

export const enableFollowPickerCompletion = (handle: Handle): Effect.Effect<void> =>
  Effect.sync(() => {
    let enabled = Option.match(completionFlag(handle), {
      onNone: () => true,
      onSome: (flag) => flag.isCompletionEnabled,
    });
    // Node disables completion before the final character of an input chunk. Keep it
    // enabled for follow so a Tab and Enter received together still enter the picker.
    Object.defineProperty(handle, "isCompletionEnabled", {
      get: () => enabled || /^\s*follow\s+/.test(handle.line),
      set: (value: boolean) => {
        enabled = value;
      },
    });
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

export const repaintPrompt = (handle: Handle): Effect.Effect<void> =>
  Effect.sync(() => {
    if (Option.isNone(closedFlag(handle))) {
      handle.prompt(true);
    }
  });

export const cursorColumn = (handle: Handle): Effect.Effect<number> =>
  Effect.sync(() => handle.getCursorPos().cols);

export const close = (handle: Handle): Effect.Effect<void> =>
  Effect.sync(() => {
    handle.close();
  });

export const write = (output: Output, text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    output.write(text);
  });

export const resizes = (output: Output): Stream.Stream<void> =>
  Stream.callback<void>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const onResize = () => {
          Queue.offerUnsafe(queue, undefined);
        };
        output.on("resize", onResize);
        return onResize;
      }),
      (onResize) =>
        Effect.sync(() => {
          output.off("resize", onResize);
        }),
    ),
  );

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
