import { Aborted } from "@oligarchy/async";
import { writeSync } from "node:fs";
import * as jarl from "jarl";
import type {
  AnyService,
  ExitReason,
  Io,
  NamesOf,
  Needs,
  NotAService,
  OnClose,
  OnExit,
  OnlyServices,
  Outcome,
  Provided,
  Provides,
  Signal,
} from "./types.ts";

type Main<Environment, Wants extends AnyService> = (
  app: App<Environment, Wants>,
) => Promise<jarl.Result<void, unknown>>;

// What an app has done so far. Each registration is its own entry, so a remover takes off only
// its own. `drained` settles once every handler queued so far has run. `reason` is why main
// ended; `exiting` is set once the app's turn to exit has come, when its handlers start.
// `errors` is only ever filled on the top app of a tree.
export type State = {
  started: boolean;
  main: () => Promise<Outcome>;
  running: Promise<void>;
  reason: ExitReason;
  exiting: ExitReason | undefined;
  readonly handlers: Array<{ readonly handler: OnExit }>;
  drained: Promise<void>;
  readonly aborter: AbortController;
  readonly services: Record<string, unknown>;
  parent: State | undefined;
  readonly children: Array<State>;
  readonly errors: Array<unknown>;
};

// SIGHUP is the terminal closing; left alone it kills the process before any handler runs.
const SIGNALS: ReadonlyArray<Signal> = ["SIGINT", "SIGTERM", "SIGHUP"];

const processIo: Io = {
  onSignal: (handler) => {
    const listeners = SIGNALS.map((signal) => ({ signal, listener: () => handler(signal) }));
    for (const { signal, listener } of listeners) {
      process.on(signal, listener);
    }
    return () => {
      for (const { signal, listener } of listeners) {
        process.off(signal, listener);
      }
    };
  },
  exit: (code) => {
    process.exit(code);
  },
  // Written before this returns: a second signal's process.exit does not wait for stderr.
  stderr: (text) => {
    writeSync(process.stderr.fd, text);
  },
};

// A C-c in the terminal is a person waiting on the exit handlers; the second one kills at once.
const PRESS_AGAIN = "press again to kill the application right away\n";

const PARENT: ExitReason = { kind: "parent" };

const topOf = (state: State): State => (state.parent === undefined ? state : topOf(state.parent));

const report = (state: State, error: unknown): void => {
  topOf(state).errors.push(error);
};

// A handler may hand back nothing; only a returned Err is a failure.
const failure = (
  returned: void | Outcome,
): returned is { readonly ok: false; readonly error: unknown } =>
  typeof returned === "object" && !returned.ok;

const call = async (state: State, handler: OnExit, reason: ExitReason): Promise<void> => {
  try {
    const returned = await handler(reason);
    if (failure(returned)) {
      report(state, returned.error);
    }
  } catch (caught) {
    report(state, caught);
  }
};

// Newest first, one at a time, until none are left: a handler added meanwhile runs next.
const drain = async (state: State, reason: ExitReason): Promise<void> => {
  for (let entry = state.handlers.pop(); entry !== undefined; entry = state.handlers.pop()) {
    await call(state, entry.handler, reason);
  }
};

const schedule = (state: State, reason: ExitReason): void => {
  state.drained = state.drained.then(() => drain(state, reason));
};

// A handler added while the others run extends `drained`; wait until it stops growing.
const settled = async (state: State): Promise<void> => {
  let current: Promise<void>;
  do {
    current = state.drained;
    await current;
  } while (current !== state.drained);
};

// The signal aborts before main returns only on a stop, so Aborted then is a stop, not a failure.
const stopped = (signal: AbortSignal, error: unknown): boolean =>
  signal.aborted && jarl.error.is(error, Aborted);

// Once main has returned the app's signal aborts, and every sub-app under it stops with it.
const runMain = async (state: State): Promise<void> => {
  const { signal } = state.aborter;
  try {
    const result = await state.main();
    if (!result.ok && !stopped(signal, result.error)) {
      report(state, result.error);
    }
  } catch (caught) {
    if (!stopped(signal, caught)) {
      report(state, caught);
    }
  }
  state.aborter.abort(new Aborted("main returned"));
};

// A sub-app runs on its parent's services and stops when its parent does; one added after its
// parent stopped never runs its main, though its handlers still run.
const start = (state: State): void => {
  if (state.started) {
    return;
  }
  state.started = true;
  const { parent } = state;
  if (parent !== undefined) {
    Object.assign(state.services, parent.services);
    const stop = () => {
      if (!state.aborter.signal.aborted) {
        state.reason = PARENT;
        state.aborter.abort(new Aborted("parent stopped"));
      }
    };
    if (parent.aborter.signal.aborted) {
      stop();
    } else {
      parent.aborter.signal.addEventListener("abort", stop, { once: true });
    }
  }
  if (!state.aborter.signal.aborted) {
    state.running = runMain(state);
  }
  for (const child of state.children) {
    start(child);
  }
};

// Every main in the tree, including those of sub-apps added while it waits.
const mains = async (state: State): Promise<void> => {
  await state.running;
  for (const child of state.children) {
    await mains(child);
  }
};

// Post-order, left to right: every sub-app, in the order it was added, exits before its parent.
const exits = async (state: State): Promise<void> => {
  for (const child of state.children) {
    await exits(child);
  }
  if (state.exiting === undefined) {
    state.exiting = state.reason;
    schedule(state, state.reason);
  }
  await settled(state);
};

// A sub-app an exit handler added after its parent's turn still has its turn to come.
const pending = (state: State): boolean =>
  state.exiting === undefined || state.handlers.length > 0 || state.children.some(pending);

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Nothing is left to hand onClose's own failure to, so it goes to stderr.
const close = async (
  onClose: OnClose,
  errors: ReadonlyArray<unknown>,
): Promise<string | undefined> => {
  try {
    const returned = await onClose(errors);
    return failure(returned) ? describe(returned.error) : undefined;
  } catch (caught) {
    return describe(caught);
  }
};

export class App<const Environment, const Wants extends AnyService = never> {
  readonly environment: Environment;
  readonly state: State = {
    started: false,
    main: async () => jarl.ok(undefined),
    running: Promise.resolve(),
    reason: { kind: "returned" },
    exiting: undefined,
    handlers: [],
    drained: Promise.resolve(),
    aborter: new AbortController(),
    services: {},
    parent: undefined,
    children: [],
    errors: [],
  };
  // Filled when the tree runs: the top app's from run, a sub-app's from its parent. Run and sub
  // are what check that the object holds every service main wants.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  readonly services: Needs<Wants> = this.state.services as Needs<Wants>;
  // Aborts on the first signal, when the parent stops, or once main returns. The exit handlers
  // run after it aborts, so what they send takes a deadline of its own, not this.
  readonly signal: AbortSignal = this.state.aborter.signal;

  constructor(environment: Environment) {
    this.environment = environment;
  }

  // A new app on the same environment, typed by what `main` wants; this one is left as it was.
  main<W extends AnyService = never>(main: Main<Environment, W>): App<Environment, W> {
    const app = new App<Environment, W>(this.environment);
    app.state.main = () => main(app);
    return app;
  }

  // A sub-app may want only services this app's main wants. It runs with this app, or at once if
  // this app is already running; one already under a parent stays there.
  sub<E, W extends AnyService>(child: App<E, W> & Provides<W, Wants["service"]>): this {
    const { state } = child;
    if (state.parent !== undefined || state.started || topOf(this.state) === state) {
      return this;
    }
    state.parent = this.state;
    this.state.children.push(state);
    if (this.state.started) {
      start(state);
    }
    return this;
  }

  onExit(handler: OnExit): () => void {
    const entry = { handler };
    this.state.handlers.push(entry);
    if (this.state.exiting !== undefined) {
      schedule(this.state, this.state.exiting);
    }
    return () => {
      const at = this.state.handlers.indexOf(entry);
      if (at !== -1) {
        this.state.handlers.splice(at, 1);
      }
    };
  }

  // Runs the tree: every main, then every exit handler, then onClose with the errors, then exits
  // 1 if there were any. Only a top app runs, and only once.
  run<P extends Provided>(
    services: P & NotAService & OnlyServices<P> & Provides<Wants, NamesOf<P>>,
    onClose: OnClose,
    io?: Io,
  ): Promise<void>;
  async run(services: Provided, onClose: OnClose, io: Io = processIo): Promise<void> {
    const { state } = this;
    if (state.started || state.parent !== undefined) {
      return;
    }
    Object.assign(state.services, services);
    let signals = 0;
    const stopListening = io.onSignal((signal) => {
      signals += 1;
      if (signals === 1 && signal === "SIGINT") {
        io.stderr(PRESS_AGAIN);
      }
      if (signals === 2) {
        io.exit(1);
      }
      // Main settles before any handler runs, so nothing is closed under a request in flight.
      if (!state.aborter.signal.aborted) {
        state.reason = { kind: "signal", signal };
        state.aborter.abort(new Aborted(`${signal} received`));
      }
    });
    start(state);
    await mains(state);
    do {
      await exits(state);
    } while (pending(state));
    const failed = await close(onClose, state.errors);
    if (failed !== undefined) {
      io.stderr(`onClose failed: ${failed}\n`);
    }
    stopListening();
    if (signals < 2) {
      io.exit(failed === undefined && state.errors.length === 0 ? 0 : 1);
    }
  }
}
