import { Aborted } from "@oligarchy/async";
import { writeSync } from "node:fs";
import * as jarl from "jarl";
import type {
  AnyService,
  ExitReason,
  Io,
  NamesOf,
  NotAService,
  OnExit,
  OnlyServices,
  Provided,
  Provides,
  ServicesOf,
  Signal,
} from "./types.ts";

export const MainCalledTwice = jarl.error.define("MainCalledTwice");
export type MainCalledTwice = InstanceType<typeof MainCalledTwice>;

type Main<Environment, Wants extends AnyService> = (
  app: App<Environment, Wants>,
) => Promise<jarl.Result<unknown, unknown>>;

// What an app has done so far. Each registration is its own entry, so a remover takes off only
// its own. `drained` settles once every handler queued so far has run. `exiting` is set once main
// has settled, when the handlers start.
export type State = {
  started: boolean;
  exiting: ExitReason | undefined;
  failed: boolean;
  readonly handlers: Array<{ readonly handler: OnExit }>;
  drained: Promise<void>;
  readonly aborter: AbortController;
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

const call = async (state: State, handler: OnExit, reason: ExitReason): Promise<void> => {
  try {
    await handler(reason);
  } catch (caught) {
    state.failed = true;
    console.error(caught);
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

// While main runs the signal aborts only on a signal, so Aborted then is a stop, not a failure.
const stopped = (signal: AbortSignal, error: unknown): boolean =>
  signal.aborted && jarl.error.is(error, Aborted);

const run = async <Environment, S extends Provided | AnyService>(
  app: App<Environment, S>,
  main: (app: App<Environment, S>) => Promise<jarl.Result<unknown, unknown>>,
): Promise<boolean> => {
  try {
    const result = await main(app);
    return result.ok || stopped(app.signal, result.error);
  } catch (caught) {
    if (stopped(app.signal, caught)) {
      return true;
    }
    console.error(caught);
    return false;
  }
};

export class App<const Environment, const S extends Provided | AnyService> {
  readonly environment: Environment;
  readonly services: ServicesOf<S>;
  readonly state: State = {
    started: false,
    exiting: undefined,
    failed: false,
    handlers: [],
    drained: Promise.resolve(),
    aborter: new AbortController(),
  };
  // Aborts on the first signal, or once main returns. The exit handlers run after it aborts, so
  // what they send takes a deadline of its own, not this.
  readonly signal: AbortSignal = this.state.aborter.signal;

  // The overloads are the typed face; the bodies below take what they already checked.
  constructor(environment: Environment, services: S & NotAService & OnlyServices<S>);
  constructor(environment: Environment, services: ServicesOf<S>) {
    this.environment = environment;
    this.services = services;
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

  main<Wants extends AnyService = never>(
    main: Main<Environment, Wants> & Provides<Wants, NamesOf<S>>,
    io?: Io,
  ): Promise<jarl.Result<void, MainCalledTwice>>;
  async main(
    main: (app: App<Environment, S>) => Promise<jarl.Result<unknown, unknown>>,
    io: Io = processIo,
  ): Promise<jarl.Result<void, MainCalledTwice>> {
    if (this.state.started) {
      return jarl.err(new MainCalledTwice("main was already called"));
    }
    this.state.started = true;
    let signals = 0;
    let signalled: ExitReason | undefined;
    const stopListening = io.onSignal((signal) => {
      signals += 1;
      if (signals === 1 && signal === "SIGINT") {
        io.stderr(PRESS_AGAIN);
      }
      if (signals === 2) {
        io.exit(1);
      }
      // Main settles before any handler runs, so nothing is closed under a request in flight.
      if (signalled === undefined && this.state.exiting === undefined) {
        signalled = { kind: "signal", signal };
        this.state.aborter.abort(new Aborted(`${signal} received`));
      }
    });
    const ok = await run(this, main);
    this.state.aborter.abort(new Aborted("main returned"));
    this.state.exiting = signalled ?? { kind: "returned" };
    schedule(this.state, this.state.exiting);
    await settled(this.state);
    stopListening();
    if (signals < 2) {
      io.exit(ok && !this.state.failed ? 0 : 1);
    }
    return jarl.ok(undefined);
  }
}
